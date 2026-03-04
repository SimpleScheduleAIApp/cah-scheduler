import { db } from "@/db";
import {
  assignment,
  scenario,
  generationJob,
  staffHolidayAssignment,
  exceptionLog,
  schedule,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateSchedule, buildSchedulerContext, BALANCED, FAIR, COST_OPTIMIZED } from "./index";
import { mulberry32 } from "./local-search";
import { evaluateSchedule } from "@/lib/engine/rule-engine";
import { checkForUnexplainedUnderstaffing } from "./validate-output";
import type { AssignmentDraft, UnderstaffedShift, SchedulerContext } from "./types";

// ─── Holiday grouping (mirrors weekend-holiday-fairness rule) ────────────────

const HOLIDAY_GROUPS: Record<string, string> = {
  "Christmas Eve": "Christmas",
  "Christmas Day": "Christmas",
};

function getLogicalHolidayName(name: string): string {
  return HOLIDAY_GROUPS[name] ?? name;
}

// ─── In-memory scoring (for FAIR/COST variants without writing to DB) ────────

interface ScoreBreakdown {
  overall: number;
  coverage: number;
  fairness: number;
  cost: number;
  preference: number;
  skillMix: number;
}

function scoreFromDrafts(drafts: AssignmentDraft[], context: SchedulerContext): ScoreBreakdown {
  // Coverage: filled / required slots
  let totalSlots = 0;
  let filledSlots = 0;
  let chargeSlots = 0;
  let chargesFilled = 0;
  for (const shift of context.shifts) {
    const assigned = drafts.filter((d) => d.shiftId === shift.id).length;
    totalSlots += shift.requiredStaffCount;
    filledSlots += Math.min(assigned, shift.requiredStaffCount);
    if (shift.requiresChargeNurse) {
      chargeSlots++;
      if (drafts.some((d) => d.shiftId === shift.id && d.isChargeNurse)) chargesFilled++;
    }
  }
  const staffFill = totalSlots > 0 ? filledSlots / totalSlots : 1;
  const chargeFill = chargeSlots > 0 ? chargesFilled / chargeSlots : 1;
  const coverage = 1 - (staffFill * 0.7 + chargeFill * 0.3);

  // Fairness: std dev of weekend shifts per staff
  const weekendCounts = new Map<string, number>();
  const activeIds = new Set(drafts.map((d) => d.staffId));
  for (const d of drafts) {
    const day = new Date(d.date).getDay();
    if (day === 0 || day === 6) weekendCounts.set(d.staffId, (weekendCounts.get(d.staffId) ?? 0) + 1);
  }
  for (const id of activeIds) {
    if (!weekendCounts.has(id)) weekendCounts.set(id, 0);
  }
  const counts = [...weekendCounts.values()];
  let fairness = 0;
  if (counts.length >= 2) {
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length;
    fairness = Math.min(Math.sqrt(variance) / 3, 1);
  }

  // Cost: overtime ratio
  const otCount = drafts.filter((d) => d.isOvertime).length;
  const cost = drafts.length > 0 ? Math.min(otCount / drafts.length / 0.3, 1) : 0;

  // Preference: mismatch ratio
  let prefChecks = 0;
  let mismatches = 0;
  for (const d of drafts) {
    const s = context.staffMap.get(d.staffId);
    if (!s?.preferences) continue;
    const { preferredShift, preferredDaysOff, avoidWeekends } = s.preferences;
    prefChecks++;
    if (preferredShift !== "any" && preferredShift !== d.shiftType) mismatches++;
    if (preferredDaysOff.length > 0) {
      prefChecks++;
      const dayName = new Date(d.date).toLocaleDateString("en-US", { weekday: "long" });
      if (preferredDaysOff.includes(dayName)) mismatches++;
    }
    if (avoidWeekends) {
      const day = new Date(d.date).getDay();
      if (day === 0 || day === 6) { prefChecks++; mismatches++; }
    }
  }
  const preference = prefChecks > 0 ? mismatches / prefChecks : 0;

  // Skill mix: shifts with all-same competency level
  let totalShifts = 0;
  let poorMix = 0;
  for (const shift of context.shifts) {
    const assigned = drafts.filter((d) => d.shiftId === shift.id);
    if (assigned.length < 2) continue;
    totalShifts++;
    const levels = assigned
      .map((d) => context.staffMap.get(d.staffId)?.icuCompetencyLevel ?? 0)
      .filter((l) => l > 0);
    if (levels.length >= 2 && Math.max(...levels) - Math.min(...levels) === 0) poorMix++;
  }
  const skillMix = totalShifts > 0 ? poorMix / totalShifts : 0;

  const weights = { coverage: 3, fairness: 2, cost: 2, preference: 1.5, skillMix: 1 };
  const tw = Object.values(weights).reduce((a, b) => a + b, 0);
  const overall =
    (coverage * weights.coverage + fairness * weights.fairness + cost * weights.cost +
      preference * weights.preference + skillMix * weights.skillMix) / tw;

  const r = (n: number) => Math.round(n * 100) / 100;
  return { overall: r(overall), coverage: r(coverage), fairness: r(fairness), cost: r(cost), preference: r(preference), skillMix: r(skillMix) };
}

// ─── Progress helpers ─────────────────────────────────────────────────────────

function setProgress(jobId: string, progress: number, phase: string) {
  db.update(generationJob)
    .set({ progress, currentPhase: phase })
    .where(eq(generationJob.id, jobId))
    .run();
}

// ─── Write BALANCED assignments to the assignment table ───────────────────────

function writeAssignments(
  drafts: AssignmentDraft[],
  scheduleId: string,
  context: SchedulerContext
): void {
  // Build holiday date lookup
  const holidayDateToName = new Map<string, string>();
  for (const h of context.publicHolidays) {
    holidayDateToName.set(h.date, getLogicalHolidayName(h.name));
  }

  for (const draft of drafts) {
    const id = crypto.randomUUID();

    db.insert(assignment)
      .values({
        id,
        shiftId: draft.shiftId,
        staffId: draft.staffId,
        scheduleId,
        status: "assigned",
        isChargeNurse: draft.isChargeNurse,
        isOvertime: draft.isOvertime,
        isFloat: draft.isFloat,
        floatFromUnit: draft.floatFromUnit,
        assignmentSource: "auto_generated",
      })
      .run();

    // Holiday tracking
    const logicalHoliday = holidayDateToName.get(draft.date);
    if (logicalHoliday) {
      const year = new Date(draft.date).getFullYear();
      // Upsert-style: insert only if this staff/holiday/year doesn't already exist
      try {
        db.insert(staffHolidayAssignment)
          .values({
            staffId: draft.staffId,
            holidayName: logicalHoliday,
            year,
            shiftId: draft.shiftId,
            assignmentId: id,
          })
          .run();
      } catch {
        // Ignore unique constraint violation (staff already has this holiday tracked)
      }
    }
  }
}

// ─── Main runner ──────────────────────────────────────────────────────────────

/**
 * Runs the full 3-variant generation job in the background.
 * Called via setImmediate after the API returns the job ID.
 *
 * Phases:
 *  0–10%   Setup
 *  10–40%  Balanced variant (greedy + local search)
 *  40–45%  Write Balanced to DB
 *  45–65%  Fair variant
 *  65–85%  Cost-Optimized variant
 *  85–100% Score, save scenarios, audit log
 */
export async function runGenerationJob(jobId: string, scheduleId: string): Promise<void> {
  try {
    db.update(generationJob)
      .set({ status: "running", startedAt: new Date().toISOString() })
      .where(eq(generationJob.id, jobId))
      .run();

    setProgress(jobId, 5, "Preparing schedule context");

    // ── 0. Seed generation ────────────────────────────────────────────────
    // One base seed per job; three variant seeds derived from it.
    // Record baseSeed in the audit log — sufficient to reproduce all 3 variants.
    const baseSeed = Date.now() & 0x7fffffff;
    const seedGen = mulberry32(baseSeed);
    const balancedSeed = Math.floor(seedGen() * 0x7fffffff);
    const fairSeed    = Math.floor(seedGen() * 0x7fffffff);
    const costSeed    = Math.floor(seedGen() * 0x7fffffff);

    // ── 1. Build context once (shared across all 3 variants) ──────────────
    const context = buildSchedulerContext(scheduleId);

    // ── 1. Clear existing assignments ─────────────────────────────────────
    setProgress(jobId, 8, "Clearing existing assignments");
    db.delete(assignment).where(eq(assignment.scheduleId, scheduleId)).run();
    db.delete(scenario).where(eq(scenario.scheduleId, scheduleId)).run();

    // ── 2. Generate BALANCED variant ──────────────────────────────────────
    setProgress(jobId, 10, "Building Balanced schedule");
    const balancedResult = generateSchedule(scheduleId, BALANCED, 1500, undefined, balancedSeed);

    setProgress(jobId, 38, "Writing Balanced schedule to database");
    writeAssignments(balancedResult.assignments, scheduleId, context);

    // Update schedule status to draft
    db.update(schedule)
      .set({ status: "draft", updatedAt: new Date().toISOString() })
      .where(eq(schedule.id, scheduleId))
      .run();

    setProgress(jobId, 42, "Scoring Balanced schedule");
    // Score BALANCED by reading from DB (it's now written)
    const balancedEval = evaluateSchedule(scheduleId);
    const balancedScore = scoreFromDrafts(balancedResult.assignments, context);

    // ── 3. Generate FAIR variant ──────────────────────────────────────────
    setProgress(jobId, 45, "Building Fairness-Optimized schedule");
    const fairResult = generateSchedule(scheduleId, FAIR, 1500, undefined, fairSeed);
    setProgress(jobId, 62, "Scoring Fairness-Optimized schedule");
    const fairScore = scoreFromDrafts(fairResult.assignments, context);

    // ── 4. Generate COST variant ──────────────────────────────────────────
    setProgress(jobId, 65, "Building Cost-Optimized schedule");
    // Pass BALANCED as greedyWeights: the greedy's job is to build a well-distributed
    // feasible schedule, and BALANCED does that best. A high OT penalty (3.0) during
    // greedy depletes low-hour staff early, paradoxically creating more structural OT.
    // The COST_OPTIMIZED personality (OT: 3.0, preference: 0.5) is then applied fully
    // in local search and the OT sweep, where it can make targeted improvements.
    const costResult = generateSchedule(scheduleId, COST_OPTIMIZED, 2000, BALANCED, costSeed);
    setProgress(jobId, 82, "Scoring Cost-Optimized schedule");
    const costScore = scoreFromDrafts(costResult.assignments, context);

    // ── 5. Save all 3 scenarios (Balanced as selected, Fair/Cost as draft alternatives) ──
    setProgress(jobId, 85, "Saving scenarios");

    // BALANCED — already applied to assignment table; save as a scenario so the
    // Scenarios page can display its score alongside the two alternatives.
    db.insert(scenario)
      .values({
        scheduleId,
        name: "Balanced",
        description:
          "Optimised across all dimensions (coverage, fairness, cost, preferences). " +
          `${balancedResult.understaffed.length > 0 ? balancedResult.understaffed.length + " shift(s) understaffed." : "Full coverage achieved."}`,
        overallScore: balancedScore.overall,
        coverageScore: balancedScore.coverage,
        fairnessScore: balancedScore.fairness,
        costScore: balancedScore.cost,
        preferenceScore: balancedScore.preference,
        skillMixScore: balancedScore.skillMix,
        assignmentSnapshot: balancedResult.assignments.map((a) => ({
          shiftId: a.shiftId,
          staffId: a.staffId,
          isChargeNurse: a.isChargeNurse,
          isOvertime: a.isOvertime,
        })),
        hardViolations: [],
        softViolations: [],
        status: "selected",
      })
      .run();

    db.insert(scenario)
      .values({
        scheduleId,
        name: "Fairness Optimized",
        description:
          "Maximises weekend equity, holiday fairness, and preference matching. " +
          `${fairResult.understaffed.length > 0 ? fairResult.understaffed.length + " shift(s) understaffed." : "Full coverage achieved."}`,
        overallScore: fairScore.overall,
        coverageScore: fairScore.coverage,
        fairnessScore: fairScore.fairness,
        costScore: fairScore.cost,
        preferenceScore: fairScore.preference,
        skillMixScore: fairScore.skillMix,
        assignmentSnapshot: fairResult.assignments.map((a) => ({
          shiftId: a.shiftId,
          staffId: a.staffId,
          isChargeNurse: a.isChargeNurse,
          isOvertime: a.isOvertime,
        })),
        hardViolations: [],
        softViolations: [],
        status: "draft",
      })
      .run();

    db.insert(scenario)
      .values({
        scheduleId,
        name: "Cost Optimized",
        description:
          "Minimises overtime and float/agency use. " +
          `${costResult.understaffed.length > 0 ? costResult.understaffed.length + " shift(s) understaffed." : "Full coverage achieved."}`,
        overallScore: costScore.overall,
        coverageScore: costScore.coverage,
        fairnessScore: costScore.fairness,
        costScore: costScore.cost,
        preferenceScore: costScore.preference,
        skillMixScore: costScore.skillMix,
        assignmentSnapshot: costResult.assignments.map((a) => ({
          shiftId: a.shiftId,
          staffId: a.staffId,
          isChargeNurse: a.isChargeNurse,
          isOvertime: a.isOvertime,
        })),
        hardViolations: [],
        softViolations: [],
        status: "draft",
      })
      .run();

    // ── 6. Audit log entries (one per variant) ────────────────────────────
    setProgress(jobId, 92, "Writing audit log");

    // Check for unexplained understaffing in the Balanced result: shifts that are
    // short without any documented hard-rule reason AND despite enough available staff.
    // A non-empty list indicates a scheduler logic bug (not a constraint or shortage issue).
    const suspicious = checkForUnexplainedUnderstaffing(balancedResult.understaffed, context);

    const now = new Date().toISOString();

    db.insert(exceptionLog)
      .values({
        entityType: "schedule",
        entityId: scheduleId,
        action: "schedule_auto_generated",
        description: `Balanced schedule auto-generated: ${balancedResult.assignments.length} assignments, ` +
          `${balancedResult.understaffed.length} understaffed shifts, ` +
          `${balancedEval.hardViolations.length} hard violations` +
          (suspicious.length > 0 ? `, ${suspicious.length} SUSPICIOUS understaffed (possible scheduler bug — check suspiciousUnderstaffing in newState)` : ""),
        newState: {
          variant: "balanced",
          assignmentCount: balancedResult.assignments.length,
          understaffedCount: balancedResult.understaffed.length,
          scores: balancedScore,
          baseSeed,
          seed: balancedSeed,
          // Empty array = scheduler is working correctly.
          // Non-empty = shifts were under-filled without a documented reason despite
          // having enough staff — investigate validate-output.ts for the root cause.
          suspiciousUnderstaffingCount: suspicious.length,
          suspiciousUnderstaffing: suspicious.length > 0 ? suspicious : [],
        },
        performedBy: "system",
        createdAt: now,
      })
      .run();

    db.insert(exceptionLog)
      .values({
        entityType: "schedule",
        entityId: scheduleId,
        action: "schedule_auto_generated",
        description: `Fairness-Optimized scenario generated: ${fairResult.assignments.length} assignments`,
        newState: {
          variant: "fair",
          assignmentCount: fairResult.assignments.length,
          understaffedCount: fairResult.understaffed.length,
          scores: fairScore,
          baseSeed,
          seed: fairSeed,
        },
        performedBy: "system",
        createdAt: now,
      })
      .run();

    db.insert(exceptionLog)
      .values({
        entityType: "schedule",
        entityId: scheduleId,
        action: "schedule_auto_generated",
        description: `Cost-Optimized scenario generated: ${costResult.assignments.length} assignments`,
        newState: {
          variant: "cost",
          assignmentCount: costResult.assignments.length,
          understaffedCount: costResult.understaffed.length,
          scores: costScore,
          baseSeed,
          seed: costSeed,
        },
        performedBy: "system",
        createdAt: now,
      })
      .run();

    // ── 7. Mark job complete ──────────────────────────────────────────────
    const allUnderstaffed: UnderstaffedShift[] = [
      ...balancedResult.understaffed.map((u) => ({ ...u, variant: "balanced" })),
    ];

    db.update(generationJob)
      .set({
        status: "completed",
        progress: 100,
        currentPhase: "Done",
        completedAt: new Date().toISOString(),
        warnings: allUnderstaffed,
      })
      .where(eq(generationJob.id, jobId))
      .run();
  } catch (err) {
    db.update(generationJob)
      .set({
        status: "failed",
        error: String(err),
        completedAt: new Date().toISOString(),
      })
      .where(eq(generationJob.id, jobId))
      .run();
  }
}
