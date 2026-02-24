import type { ShiftInfo, StaffInfo } from "@/lib/engine/rules/types";
import type { AssignmentDraft, GenerationResult, SchedulerContext, WeightProfile } from "./types";
import { SchedulerState, shiftEndDateTime } from "./state";
import { passesHardRules, getRejectionReasons, isICUUnit } from "./eligibility";
import { softPenalty } from "./scoring";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getShiftPriority(shift: ShiftInfo): number {
  // Most constrained first:
  //   1. Weekend ICU/ER charge  — these come at the END of the week in date order, so charge
  //      nurses accumulate too many hours Mon–Fri before the slot is reached.  Processing them
  //      FIRST guarantees they get first pick of the charge-qualified pool.
  //   2. Weekday ICU/ER charge
  //   3. ICU/ER (non-charge)
  //   4. Night
  //   5. Day / Evening
  //   6. On-call
  const icu = isICUUnit(shift.unit);
  if (icu && shift.requiresChargeNurse) {
    const dayOfWeek = new Date(shift.date).getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) return 1; // weekend ICU charge
    return 2; // weekday ICU charge
  }
  if (icu) return 3;
  if (shift.shiftType === "night") return 4;
  if (shift.shiftType === "day" || shift.shiftType === "evening") return 5;
  return 6; // on_call
}

function sortShiftsByDifficulty(shifts: ShiftInfo[]): ShiftInfo[] {
  return [...shifts].sort((a, b) => {
    const pa = getShiftPriority(a);
    const pb = getShiftPriority(b);
    if (pa !== pb) return pa - pb;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.startTime < b.startTime ? -1 : 1;
  });
}

function buildDraft(
  staff: StaffInfo,
  shift: ShiftInfo,
  isChargeNurse: boolean,
  state: SchedulerState
): AssignmentDraft {
  const weekHours = state.getWeeklyHours(staff.id, shift.date);
  const isOvertime = weekHours + shift.durationHours > 40;
  const isFloat = !!(staff.homeUnit && staff.homeUnit !== shift.unit);
  return {
    shiftId: shift.id,
    staffId: staff.id,
    date: shift.date,
    shiftType: shift.shiftType,
    startTime: shift.startTime,
    endTime: shiftEndDateTime(shift.date, shift.startTime, shift.durationHours)
      .toTimeString()
      .slice(0, 5),
    durationHours: shift.durationHours,
    unit: shift.unit,
    isChargeNurse,
    isOvertime,
    isFloat,
    floatFromUnit: isFloat ? (staff.homeUnit ?? null) : null,
  };
}

/** Pick the best candidate from `eligible` using soft penalty scoring. */
function pickBest(
  eligible: StaffInfo[],
  shift: ShiftInfo,
  state: SchedulerState,
  weights: WeightProfile,
  currentShiftAssignments: AssignmentDraft[],
  staffMap: Map<string, StaffInfo>,
  isChargeCandidate: boolean,
  context: SchedulerContext
): StaffInfo {
  return eligible.reduce((best, candidate) => {
    const score = softPenalty(
      candidate,
      shift,
      state,
      weights,
      currentShiftAssignments,
      staffMap,
      isChargeCandidate,
      context.unitConfig,
      context.historicalWeekendCounts ?? new Map()
    );
    const bestScore = softPenalty(
      best,
      shift,
      state,
      weights,
      currentShiftAssignments,
      staffMap,
      isChargeCandidate,
      context.unitConfig,
      context.historicalWeekendCounts ?? new Map()
    );
    return score < bestScore ? candidate : best;
  });
}

/**
 * Greedy schedule construction.
 *
 * Iterates through shifts ordered by constraint difficulty (most constrained
 * first). For each shift:
 *  1. Fills the charge nurse slot (if required and not yet filled)
 *  2. Fills remaining staff slots one by one
 *
 * Uses hard rules as a filter and soft rule penalty scores to rank candidates.
 * Never violates hard rules — understaffed slots are recorded for manager review.
 */
export function greedyConstruct(
  context: SchedulerContext,
  weights: WeightProfile
): GenerationResult {
  const state = new SchedulerState();
  const assignments: AssignmentDraft[] = [];
  const understaffed: GenerationResult["understaffed"] = [];

  const activeStaff = context.staffList.filter((s) => s.isActive);
  const sortedShifts = sortShiftsByDifficulty(context.shifts);

  // Pre-compute all ICU/ER charge shifts so the charge protection look-ahead
  // can reference upcoming slots without re-scanning on every iteration.
  const icuChargeShifts = sortedShifts.filter(
    (s) => isICUUnit(s.unit) && s.requiresChargeNurse
  );

  for (const shift of sortedShifts) {
    const required = shift.requiredStaffCount + shift.acuityExtraStaff;
    const slotReasons: string[] = [];

    // ── Pass 1: Fill charge nurse slot ──────────────────────────────────────
    if (shift.requiresChargeNurse) {
      const alreadyHasCharge = state.getShiftAssignments(shift.id).some((a) => a.isChargeNurse);
      if (!alreadyHasCharge) {
        const eligible = activeStaff.filter(
          (s) =>
            s.isChargeNurseQualified &&
            s.icuCompetencyLevel >= 4 && // Hard rule: charge requires Level 4+ competency
            !state.getShiftAssignments(shift.id).some((a) => a.staffId === s.id) &&
            passesHardRules(s, shift, state, context)
        );

        if (eligible.length > 0) {
          // Prefer Level 5 (primary charge) over Level 4 (stand-in charge when no Level 5 available)
          const level5Pool = eligible.filter((s) => s.icuCompetencyLevel === 5);
          const topTier = level5Pool.length > 0 ? level5Pool : eligible;
          const currentSlotAssignments = state.getShiftAssignments(shift.id);
          const best = pickBest(
            topTier,
            shift,
            state,
            weights,
            currentSlotAssignments,
            context.staffMap,
            true,
            context
          );
          const draft = buildDraft(best, shift, true, state);
          assignments.push(draft);
          state.addAssignment(draft);
        } else {
          slotReasons.push("no eligible charge nurse available");
        }
      }
    }

    // ── Pass 1.5: Ensure Level 4+ supervisor on ICU/ER shifts ───────────────
    // The competency-pairing hard rule requires Level 4+ on every ICU/ER shift.
    // We fill that slot before regular candidates so Level 2 staff can be placed safely.
    if (isICUUnit(shift.unit)) {
      const shiftAssigns1 = state.getShiftAssignments(shift.id);
      const alreadyHasLevel4 = shiftAssigns1.some(
        (a) => (context.staffMap.get(a.staffId)?.icuCompetencyLevel ?? 0) >= 4
      );
      if (!alreadyHasLevel4) {
        const supervisorEligible = activeStaff.filter(
          (s) =>
            s.icuCompetencyLevel >= 4 &&
            !shiftAssigns1.some((a) => a.staffId === s.id) &&
            passesHardRules(s, shift, state, context)
        );
        if (supervisorEligible.length > 0) {
          const currentSlotAssignments = state.getShiftAssignments(shift.id);
          const best = pickBest(
            supervisorEligible,
            shift,
            state,
            weights,
            currentSlotAssignments,
            context.staffMap,
            false,
            context
          );
          // If the shift still needs a charge nurse and this Level 4+ is charge-qualified,
          // designate them as charge — satisfies supervision AND charge requirement at once.
          const stillNeedsCharge =
            shift.requiresChargeNurse &&
            !state.getShiftAssignments(shift.id).some((a) => a.isChargeNurse);
          const assignAsCharge = stillNeedsCharge && best.isChargeNurseQualified;
          const draft = buildDraft(best, shift, assignAsCharge, state);
          assignments.push(draft);
          state.addAssignment(draft);
        } else {
          slotReasons.push("no eligible Level 4+ staff for ICU/ER supervision");
        }
      }
    }

    // ── Pass 2: Fill remaining staff slots ──────────────────────────────────
    const remaining = required - state.getShiftAssignments(shift.id).length;
    for (let slot = 0; slot < remaining; slot++) {
      const currentSlotAssignments = state.getShiftAssignments(shift.id);
      const assignedIds = new Set(currentSlotAssignments.map((a) => a.staffId));

      // Charge protection look-ahead: before allowing a Level 4+ charge-qualified
      // nurse into a regular (non-charge) slot, check whether doing so would exhaust
      // their 60h rolling-window capacity for an upcoming ICU/ER charge shift where
      // they are the last available charge nurse.  Only blocks when the nurse is
      // genuinely the final option — avoids over-constraining the candidate pool.
      const protectedChargeNurseIds = new Set<string>();
      const lookAheadCutoff = new Date(shift.date);
      lookAheadCutoff.setDate(lookAheadCutoff.getDate() + 7);
      const lookAheadCutoffStr = lookAheadCutoff.toISOString().slice(0, 10);

      for (const upcoming of icuChargeShifts) {
        // Only look ahead: shifts after the current one, within 7 days, not yet charged
        if (upcoming.date <= shift.date || upcoming.date > lookAheadCutoffStr) continue;
        if (state.getShiftAssignments(upcoming.id).some((a) => a.isChargeNurse)) continue;

        // Identify Level 4+ nurses who would still be eligible for the upcoming
        // charge shift WITHOUT today's proposed assignment consuming their hours.
        const eligibleForUpcoming = activeStaff.filter(
          (s) =>
            s.isChargeNurseQualified &&
            s.icuCompetencyLevel >= 4 &&
            !assignedIds.has(s.id) &&
            passesHardRules(s, upcoming, state, context)
        );

        // For each candidate that would become ineligible for `upcoming` after
        // being assigned to the current shift, count remaining alternatives.
        for (const candidate of eligibleForUpcoming) {
          const wouldBeBlocked = state.wouldExceed7DayHoursAfterAdding(
            candidate.id,
            shift.date,
            shift.durationHours,
            upcoming.date,
            upcoming.durationHours,
            60
          );
          if (!wouldBeBlocked) continue;

          // This candidate would be knocked out by today's assignment.
          // Count how many other Level 4+ nurses remain eligible for `upcoming`.
          const otherCount = eligibleForUpcoming.filter(
            (other) =>
              other.id !== candidate.id &&
              !state.wouldExceed7DayHoursAfterAdding(
                other.id,
                shift.date,
                shift.durationHours,
                upcoming.date,
                upcoming.durationHours,
                60
              )
          ).length;

          if (otherCount === 0) {
            // candidate is the sole remaining charge nurse for `upcoming` —
            // protect them from being consumed by the current regular slot.
            protectedChargeNurseIds.add(candidate.id);
          }
        }
      }

      const allEligible = activeStaff.filter(
        (s) =>
          !assignedIds.has(s.id) &&
          !protectedChargeNurseIds.has(s.id) &&
          passesHardRules(s, shift, state, context)
      );

      // Non-OT preference: any nurse who can cover this shift without crossing
      // the 40h overtime threshold is used before nurses who would go into OT,
      // regardless of employment type or current FTE utilisation.  This ensures
      // part-time staff working above their FTE target (extra hours, but no 1.5×
      // payroll cost) are always preferred over scheduling a full-time nurse into
      // actual overtime.  If every eligible candidate would cause OT, fall back
      // to the full eligible pool so the slot is filled rather than left empty.
      const nonOTEligible = allEligible.filter(
        (s) => state.getWeeklyHours(s.id, shift.date) + shift.durationHours <= 40
      );
      const eligible = nonOTEligible.length > 0 ? nonOTEligible : allEligible;

      if (eligible.length === 0) {
        // Collect why the top-5 staff were rejected (for reporting)
        const unassigned = activeStaff.filter((s) => !assignedIds.has(s.id));
        const reasons = collectRejectionReasonsSummary(unassigned, shift, state, context);
        slotReasons.push(...reasons);
        break; // no point checking further slots
      }

      const best = pickBest(
        eligible,
        shift,
        state,
        weights,
        currentSlotAssignments,
        context.staffMap,
        false,
        context
      );
      const draft = buildDraft(best, shift, false, state);
      assignments.push(draft);
      state.addAssignment(draft);
    }

    // Record understaffing
    const assigned = state.getShiftAssignments(shift.id).length;
    if (assigned < required) {
      understaffed.push({
        shiftId: shift.id,
        date: shift.date,
        shiftType: shift.shiftType,
        unit: shift.unit,
        required,
        assigned,
        reasons: [...new Set(slotReasons)],
      });
    }
  }

  return { assignments, understaffed };
}

/** Summarise rejection reasons from up to 5 unassigned staff (de-duped). */
function collectRejectionReasonsSummary(
  staff: StaffInfo[],
  shift: ShiftInfo,
  state: SchedulerState,
  context: SchedulerContext
): string[] {
  const reasonCounts = new Map<string, number>();
  for (const s of staff.slice(0, 10)) {
    for (const reason of getRejectionReasons(s, shift, state, context)) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  // Return the most common reasons
  return [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([r]) => r);
}
