import type { StaffInfo, ShiftInfo, UnitConfig } from "@/lib/engine/rules/types";
import type { AssignmentDraft, WeightProfile } from "./types";
import { SchedulerState } from "./state";
import { isICUUnit } from "./eligibility";

/**
 * Computes the soft-rule penalty score for assigning `staffInfo` to `shiftInfo`
 * given the current scheduler state.
 *
 * Lower score = better candidate.
 * Negative values are valid and used to incentivize needed assignments
 * (e.g., weekends for staff below their minimum).
 */
export function softPenalty(
  staffInfo: StaffInfo,
  shiftInfo: ShiftInfo,
  state: SchedulerState,
  weights: WeightProfile,
  currentShiftAssignments: AssignmentDraft[],
  staffMap: Map<string, StaffInfo>,
  isChargeCandidate: boolean,
  unitConfig: UnitConfig | null,
  historicalWeekendCounts: Map<string, number> = new Map()
): number {
  let penalty = 0;

  // ── 1. Overtime ─────────────────────────────────────────────────────────────
  const weekHours = state.getWeeklyHours(staffInfo.id, shiftInfo.date);
  const fteTargetHours = (staffInfo.preferences?.maxHoursPerWeek ?? 40) * staffInfo.fte;
  const newTotal = weekHours + shiftInfo.durationHours;

  if (newTotal > 40) {
    // Hours above 40 = overtime (high penalty)
    const otHours = newTotal - Math.max(40, weekHours);
    penalty += weights.overtime * (otHours / 12); // normalise per 12-h shift
  } else if (newTotal > fteTargetHours && fteTargetHours < 40) {
    // Hours above FTE target but still ≤40 = extra (low penalty)
    const extraHours = newTotal - Math.max(fteTargetHours, weekHours);
    if (extraHours > 0) penalty += weights.overtime * 0.3 * (extraHours / 12);
  }

  // Capacity-spreading bonus: give a small incentive to prefer staff who have more
  // remaining hours before hitting the 40h OT threshold. Acts as a tiebreaker that
  // mirrors real charge-nurse behaviour ("ask whoever has worked the least this week").
  // Float pool staff — typically earlier in their week when critical ICU shifts are
  // scheduled first — naturally benefit most, which prevents temporal depletion of
  // their capacity and reduces overtime on regular unit staff later in the schedule.
  // Coefficient (0.1) is intentionally small: it breaks ties without overriding
  // meaningful clinical penalties (skill mix, charge requirement, preferences).
  const remainingBeforeOT = Math.max(0, 40 - weekHours);
  penalty -= weights.overtime * 0.1 * (remainingBeforeOT / 40);

  // ── 2. Preference mismatch ──────────────────────────────────────────────────
  if (staffInfo.preferences) {
    const { preferredShift, preferredDaysOff, avoidWeekends } = staffInfo.preferences;

    if (preferredShift && preferredShift !== "any" && preferredShift !== shiftInfo.shiftType) {
      penalty += weights.preference * 0.5;
    }

    const dayName = new Date(shiftInfo.date).toLocaleDateString("en-US", { weekday: "long" });
    if (preferredDaysOff.includes(dayName)) {
      penalty += weights.preference * 0.7;
    }

    if (avoidWeekends) {
      const d = new Date(shiftInfo.date).getDay();
      if (d === 0 || d === 6) penalty += weights.preference * 0.6;
    }
  }

  // ── 3. Weekend count equity ──────────────────────────────────────────────────
  // Incentivise staff who haven't reached their required weekend count (bonus).
  // Penalise assigning MORE weekends to staff who already met or exceeded quota so
  // that the Fair variant actually produces lower weekend variance than Balanced/Cost.
  //
  // historicalWeekendCounts seeds the count with weekends worked in the prior
  // schedule period so the same nurses don't always land on weekends every run.
  // A nurse who hit their quota last period starts this period already "at quota"
  // and is penalised for more weekends, while a nurse who was light last period
  // starts below quota and gets the assignment bonus.
  const dayOfWeek = new Date(shiftInfo.date).getDay();
  const isWeekendShift = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekendShift && !staffInfo.weekendExempt) {
    const historicalWeekends = historicalWeekendCounts.get(staffInfo.id) ?? 0;
    const weekendCount = historicalWeekends + state.getWeekendCount(staffInfo.id);
    const required = unitConfig?.weekendShiftsRequired ?? 3;
    if (weekendCount < required) {
      // Below quota: give a bonus so the algorithm fills required weekends first
      penalty -= weights.weekendCount * 0.5;
    } else {
      // At or above quota: penalise; penalty grows with how far over they already are
      const excess = weekendCount - required;
      penalty += weights.weekendCount * (0.4 + excess * 0.3);
    }
  }

  // ── 4. Float penalty ────────────────────────────────────────────────────────
  if (staffInfo.homeUnit && staffInfo.homeUnit !== shiftInfo.unit) {
    const isCrossTrained = (staffInfo.crossTrainedUnits ?? []).includes(shiftInfo.unit);
    penalty += weights.float * (isCrossTrained ? 0.3 : 1.0);
  }

  // ── 5. Skill mix ────────────────────────────────────────────────────────────
  const existingLevels = currentShiftAssignments
    .map((a) => staffMap.get(a.staffId)?.icuCompetencyLevel ?? 0)
    .filter((l) => l > 0);

  if (existingLevels.length > 0) {
    const alreadyHasLevel = existingLevels.includes(staffInfo.icuCompetencyLevel);
    if (alreadyHasLevel) {
      const allSame = existingLevels.every((l) => l === staffInfo.icuCompetencyLevel);
      if (allSame) penalty += weights.skillMix * 0.6;
      else penalty += weights.skillMix * 0.1; // slight penalty for any duplicate
    }
    // else: adding a new competency level to the mix → no penalty
  }

  // ── 6. Competency pairing incentives ────────────────────────────────────────
  // Incentivise assigning a Level 5 when a Level 1 is already on the shift
  const hasLevel1 = currentShiftAssignments.some(
    (a) => staffMap.get(a.staffId)?.icuCompetencyLevel === 1
  );
  if (hasLevel1 && staffInfo.icuCompetencyLevel === 5) {
    penalty -= weights.skillMix * 0.8; // strongly incentivise preceptor
  }

  // Incentivise Level 4+ when a Level 2 is already on an ICU/ER shift
  const hasLevel2OnICU = isICUUnit(shiftInfo.unit) &&
    currentShiftAssignments.some((a) => staffMap.get(a.staffId)?.icuCompetencyLevel === 2);
  if (hasLevel2OnICU && staffInfo.icuCompetencyLevel >= 4) {
    penalty -= weights.skillMix * 0.6;
  }

  // ── 7. Charge clustering ────────────────────────────────────────────────────
  // Penalise assigning extra charge-qualified nurses to a shift that already has one
  if (!isChargeCandidate && staffInfo.isChargeNurseQualified) {
    const existingCharges = currentShiftAssignments.filter((a) => a.isChargeNurse).length;
    if (existingCharges > 0) {
      penalty += weights.chargeClustering * 0.5;
    }
  }

  // ── 8. Agency penalty ───────────────────────────────────────────────────────
  // Agency nurses cost 2–3× the base hourly rate (agency markup + premium pay).
  // Apply a flat penalty so the scheduler treats them as last resort — used only
  // when the regular, float, and PRN pools cannot fill the slot.
  if (staffInfo.employmentType === "agency") {
    penalty += weights.agency * 1.0;
  }

  return penalty;
}
