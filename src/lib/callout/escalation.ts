import { db } from "@/db";
import { staff, staffLeave, assignment, shift, shiftDefinition, schedule } from "@/db/schema";
import { eq, and, ne, gte, lte } from "drizzle-orm";

// Role hierarchy: replacement must have equal or higher rank than the called-out nurse
const ROLE_RANK: Record<string, number> = { RN: 3, LPN: 2, CNA: 1 };

// Max candidates returned (eligible first, then ineligible for visibility)
const MAX_ELIGIBLE = 3;
const MAX_INELIGIBLE = 3;

export interface ReplacementCandidate {
  staffId: string;
  firstName: string;
  lastName: string;
  role: string;
  employmentType: string;
  icuCompetencyLevel: number;
  isChargeNurseQualified: boolean;
  reliabilityRating: number;
  source: "float" | "per_diem" | "overtime" | "agency";
  isAvailable: boolean;
  wouldBeOvertime: boolean;
  isEligible: boolean;
  ineligibilityReasons: string[];
  reasons: string[];          // why this person is a good recommendation
  score: number;              // numeric rank (higher = better)
  hoursThisWeek: number;      // hours already scheduled in the shift's calendar week
  restHoursBefore?: number;   // hours of rest between candidate's last preceding shift and this one
  weekendsThisPeriod: number; // weekend shifts already assigned in the current schedule period
  consecutiveDaysBeforeShift: number; // consecutive working days ending the day before the shift
}

function timeToMins(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Sunday-based week containing `date` */
function weekBounds(date: string): { weekStart: string; weekEnd: string } {
  const d = new Date(date + "T00:00:00Z");
  const dayOfWeek = d.getUTCDay(); // 0 = Sunday
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - dayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return {
    weekStart: weekStart.toISOString().slice(0, 10),
    weekEnd: weekEnd.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Helpers for weekend count and consecutive days
// ---------------------------------------------------------------------------

function countWeekendsInSchedulePeriod(staffId: string, scheduleId: string): number {
  const sched = db.select({ startDate: schedule.startDate, endDate: schedule.endDate })
    .from(schedule).where(eq(schedule.id, scheduleId)).get();
  if (!sched) return 0;

  const rows = db
    .select({ date: shift.date })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .where(
      and(
        eq(assignment.staffId, staffId),
        gte(shift.date, sched.startDate),
        lte(shift.date, sched.endDate),
        ne(assignment.status, "cancelled")
      )
    )
    .all();

  return rows.filter((r) => {
    const day = new Date(r.date + "T00:00:00Z").getUTCDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }).length;
}

function countConsecutiveDaysBefore(staffId: string, shiftDate: string): number {
  let count = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(shiftDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const hasShift = db
      .select({ id: assignment.id })
      .from(assignment)
      .innerJoin(shift, eq(assignment.shiftId, shift.id))
      .where(
        and(
          eq(assignment.staffId, staffId),
          eq(shift.date, dateStr),
          ne(assignment.status, "cancelled")
        )
      )
      .get();
    if (!hasShift) break;
    count++;
  }
  return count;
}

export function getEscalationOptions(
  shiftId: string,
  calledOutStaffId: string
): ReplacementCandidate[] {
  // ── 1. Shift + definition ────────────────────────────────────────────────
  const shiftRow = db
    .select({
      id: shift.id,
      date: shift.date,
      startTime: shiftDefinition.startTime,
      endTime: shiftDefinition.endTime,
      durationHours: shiftDefinition.durationHours,
      shiftType: shiftDefinition.shiftType,
      scheduleId: shift.scheduleId,
    })
    .from(shift)
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(eq(shift.id, shiftId))
    .get();
  if (!shiftRow) return [];

  // ── 2. Called-out nurse: role, competency level ──────────────────────────
  const calledOut = db
    .select({
      role: staff.role,
      icuCompetencyLevel: staff.icuCompetencyLevel,
    })
    .from(staff)
    .where(eq(staff.id, calledOutStaffId))
    .get();
  const calledOutRoleRank = ROLE_RANK[calledOut?.role ?? ""] ?? 0;
  const calledOutLevel = calledOut?.icuCompetencyLevel ?? 1;

  // ── 3. Was the called-out nurse the charge nurse on this shift? ──────────
  const calledOutAssignment = db
    .select({ isChargeNurse: assignment.isChargeNurse })
    .from(assignment)
    .where(
      and(eq(assignment.shiftId, shiftId), eq(assignment.staffId, calledOutStaffId))
    )
    .get();
  const chargeNurseRequired = calledOutAssignment?.isChargeNurse === true;

  // ── 4. All active staff (exclude called-out nurse) ───────────────────────
  const allStaff = db
    .select()
    .from(staff)
    .where(and(eq(staff.isActive, true), ne(staff.id, calledOutStaffId)))
    .all();

  // ── 5. Existing active assignments on this shift ─────────────────────────
  const existingAssignments = db
    .select({ staffId: assignment.staffId })
    .from(assignment)
    .where(eq(assignment.shiftId, shiftId))
    .all();
  const alreadyAssigned = new Set(existingAssignments.map((a) => a.staffId));

  // ── 6. Batch: assignments on D-1, D, D+1 (availability + rest check) ────
  const shiftDate = shiftRow.date;
  const prevDate = offsetDate(shiftDate, -1);
  const nextDate = offsetDate(shiftDate, 1);

  const nearbyRaw = db
    .select({
      staffId: assignment.staffId,
      status: assignment.status,
      date: shift.date,
      startTime: shiftDefinition.startTime,
      endTime: shiftDefinition.endTime,
    })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(and(gte(shift.date, prevDate), lte(shift.date, nextDate)))
    .all();

  const nearbyByStaff = new Map<string, typeof nearbyRaw>();
  for (const a of nearbyRaw) {
    if (a.status === "called_out" || a.status === "cancelled") continue;
    const list = nearbyByStaff.get(a.staffId) ?? [];
    list.push(a);
    nearbyByStaff.set(a.staffId, list);
  }

  // ── 7. Batch: weekly hours for OT determination ──────────────────────────
  const { weekStart, weekEnd } = weekBounds(shiftDate);
  const weeklyRaw = db
    .select({
      staffId: assignment.staffId,
      status: assignment.status,
      durationHours: shiftDefinition.durationHours,
    })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(and(gte(shift.date, weekStart), lte(shift.date, weekEnd)))
    .all();

  const weeklyByStaff = new Map<string, number>();
  for (const a of weeklyRaw) {
    if (a.status === "called_out" || a.status === "cancelled") continue;
    const prev = weeklyByStaff.get(a.staffId) ?? 0;
    weeklyByStaff.set(a.staffId, prev + (a.durationHours ?? 0));
  }

  // ── 8. Approved leaves covering the shift date ───────────────────────────
  const activeLeaves = db
    .select({ staffId: staffLeave.staffId })
    .from(staffLeave)
    .where(
      and(
        eq(staffLeave.status, "approved"),
        lte(staffLeave.startDate, shiftDate),
        gte(staffLeave.endDate, shiftDate)
      )
    )
    .all();
  const onLeave = new Set(activeLeaves.map((l) => l.staffId));

  // ── 9. Shift timing (minutes from shiftDate midnight) ────────────────────
  const shiftStartMins = timeToMins(shiftRow.startTime);
  const shiftEndMins =
    shiftRow.endTime <= shiftRow.startTime
      ? timeToMins(shiftRow.endTime) + 24 * 60 // overnight: end is next calendar day
      : timeToMins(shiftRow.endTime);

  const candidates: ReplacementCandidate[] = [];

  for (const s of allStaff) {
    if (alreadyAssigned.has(s.id)) continue;

    const ineligibilityReasons: string[] = [];
    const reasons: string[] = [];

    // ── Eligibility checks ─────────────────────────────────────────────────

    // Role compatibility — hard exclusion, not just ineligibility.
    // A CNA/LPN cannot perform RN duties regardless of circumstances; showing
    // them in any candidate list (even "ineligible") creates confusion for the
    // manager. Skip entirely rather than surfacing an unworkable option.
    const candidateRoleRank = ROLE_RANK[s.role] ?? 0;
    if (candidateRoleRank < calledOutRoleRank) continue;

    // Charge nurse requirement
    if (chargeNurseRequired && !s.isChargeNurseQualified) {
      ineligibilityReasons.push(
        "Not charge nurse qualified — called-out nurse held charge role"
      );
    }

    // Approved leave
    if (onLeave.has(s.id)) {
      ineligibilityReasons.push("On approved leave");
    }

    // Same-date availability
    const staffNearby = nearbyByStaff.get(s.id) ?? [];
    const isAvailable = !staffNearby.some((a) => a.date === shiftDate);

    // Adjacent-day rest (10 h minimum) + compute rest hours for display
    let restHoursBefore: number | undefined;
    if (isAvailable) {
      for (const a of staffNearby) {
        if (a.date === prevDate) {
          // Compute the gap from this D-1 assignment's end to the new shift start
          const aEndMins = timeToMins(a.endTime);
          const gap = a.endTime <= a.startTime
            ? shiftStartMins - aEndMins              // overnight D-1 shift ends on D
            : 24 * 60 - aEndMins + shiftStartMins;  // day shift ends on D-1
          if (gap < 10 * 60) {
            ineligibilityReasons.push(
              `Only ${Math.round(gap / 60)}h rest before this shift`
            );
          }
          // Track minimum rest for display on eligible candidates
          if (restHoursBefore === undefined || gap / 60 < restHoursBefore) {
            restHoursBefore = gap / 60;
          }
        }
        if (a.date === nextDate) {
          // Check rest between this shift and the next-day assignment
          const nextStartFromD = timeToMins(a.startTime) + 24 * 60;
          const restMins = nextStartFromD - shiftEndMins;
          if (restMins < 10 * 60) {
            ineligibilityReasons.push(
              `Only ${Math.round(restMins / 60)}h rest after this shift`
            );
          }
        }
      }
    }

    const isEligible = ineligibilityReasons.length === 0;

    // ── Hours + OT ────────────────────────────────────────────────────────
    const hoursThisWeek = weeklyByStaff.get(s.id) ?? 0;
    const wouldBeOvertime = hoursThisWeek + (shiftRow.durationHours ?? 12) > 40;

    // ── Source classification ─────────────────────────────────────────────
    let source: ReplacementCandidate["source"];
    switch (s.employmentType) {
      case "float":    source = "float";    break;
      case "per_diem": source = "per_diem"; break;
      case "agency":   source = "agency";   break;
      default:         source = "overtime"; break;
    }

    // ── Recommendation reasons ────────────────────────────────────────────
    switch (source) {
      case "float":
        reasons.push("Float pool — first choice for coverage");
        break;
      case "per_diem":
        reasons.push("PRN staff — available on this date");
        break;
      case "overtime":
        // Overtime/hours context is shown as a con in the UI — not a pro
        break;
      case "agency":
        reasons.push("Agency — last resort");
        break;
    }

    if (s.icuCompetencyLevel >= calledOutLevel) {
      reasons.push(
        `Level ${s.icuCompetencyLevel}/5 — matches or exceeds called-out nurse`
      );
    } else {
      reasons.push(
        `Level ${s.icuCompetencyLevel}/5 — below called-out nurse (Level ${calledOutLevel})`
      );
    }

    if (chargeNurseRequired && s.isChargeNurseQualified) {
      reasons.push("Charge nurse qualified — can cover charge role");
    }

    if (hoursThisWeek > 0) {
      reasons.push(`${hoursThisWeek}h scheduled this week`);
    } else {
      reasons.push("No other shifts this week");
    }

    if (s.reliabilityRating >= 4) {
      reasons.push(`Reliability ${s.reliabilityRating}/5`);
    }

    // ── Score ────────────────────────────────────────────────────────────
    //
    // Competency is the primary axis. A candidate's contribution from
    // competency is capped at the called-out nurse's level — there is no
    // large bonus for being significantly over-qualified. Being under-
    // qualified for the vacancy scores proportionally lower regardless of
    // employment tier, so a Level 3 float never outranks a Level 5 full-
    // timer for a Level 5 vacancy.
    //
    // Example (Level 5 called-out, available):
    //   Level 5 float:  5×10 + 30 + 50 = 130
    //   Level 4 float:  4×10 + 30 + 50 = 120   (float preferred by 10 pts)
    //   Level 5 OT:     5×10 + 10 + 50 = 110
    //   Level 3 float:  3×10 + 30 + 50 = 110   (ties with Level 5 OT)
    //
    const effectiveLevel = Math.min(s.icuCompetencyLevel, calledOutLevel);
    const overflowLevel = Math.max(0, s.icuCompetencyLevel - calledOutLevel);
    // Small overflow bonus — slight preference for over-qualified candidates
    const competencyScore = effectiveLevel * 10 + overflowLevel * 2;

    // Source preference (float still preferred when competency is equal,
    // but no longer able to dominate when there is a large level mismatch)
    const sourceBonusMap: Record<string, number> = {
      float: 30,
      per_diem: 20,
      overtime: 10,
      agency: 0,
    };

    let score = competencyScore + (sourceBonusMap[source] ?? 0);
    if (isAvailable) score += 50;
    score += s.reliabilityRating * 3;
    if (chargeNurseRequired && s.isChargeNurseQualified) score += 15;
    if (source === "overtime" && !wouldBeOvertime) score += 10;
    score += Math.max(0, 40 - hoursThisWeek) * 0.2; // prefer less-loaded staff

    candidates.push({
      staffId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      role: s.role,
      employmentType: s.employmentType,
      icuCompetencyLevel: s.icuCompetencyLevel,
      isChargeNurseQualified: s.isChargeNurseQualified,
      reliabilityRating: s.reliabilityRating,
      source,
      isAvailable,
      wouldBeOvertime,
      isEligible,
      ineligibilityReasons,
      reasons,
      score,
      hoursThisWeek,
      restHoursBefore,
      weekendsThisPeriod: countWeekendsInSchedulePeriod(s.id, shiftRow.scheduleId),
      consecutiveDaysBeforeShift: countConsecutiveDaysBefore(s.id, shiftRow.date),
    });
  }

  // ── Sort and limit ───────────────────────────────────────────────────────
  // Within each tier sort by score descending
  const eligible = candidates
    .filter((c) => c.isEligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ELIGIBLE);

  const ineligible = candidates
    .filter((c) => !c.isEligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INELIGIBLE);

  return [...eligible, ...ineligible];
}
