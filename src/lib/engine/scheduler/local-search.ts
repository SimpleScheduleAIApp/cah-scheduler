import type { StaffInfo } from "@/lib/engine/rules/types";
import type { AssignmentDraft, GenerationResult, SchedulerContext, WeightProfile } from "./types";
import { SchedulerState, getWeekStart } from "./state";
import { passesHardRules, isICUUnit } from "./eligibility";
import { softPenalty } from "./scoring";

/**
 * Compute a proxy total penalty from a flat list of assignments.
 * Rebuilds an in-memory state and sums individual assignment penalties.
 */
function computeTotalPenalty(
  assignments: AssignmentDraft[],
  context: SchedulerContext,
  weights: WeightProfile
): number {
  // Build state from scratch
  const state = new SchedulerState();
  for (const a of assignments) {
    state.addAssignment(a);
  }

  let total = 0;
  for (const a of assignments) {
    const staffInfo = context.staffMap.get(a.staffId);
    const shiftInfo = context.shifts.find((s) => s.id === a.shiftId);
    if (!staffInfo || !shiftInfo) continue;

    // Temporarily remove this assignment from state to compute the marginal penalty
    // (approximate: we use the full-state penalty for simplicity)
    const currentShiftAssignments = assignments.filter(
      (x) => x.shiftId === a.shiftId && x.staffId !== a.staffId
    );

    total += softPenalty(
      staffInfo,
      shiftInfo,
      state,
      weights,
      currentShiftAssignments,
      context.staffMap,
      a.isChargeNurse,
      context.unitConfig,
      context.historicalWeekendCounts ?? new Map()
    );
  }
  return total;
}

/**
 * Quick hard-rule check for a proposed swap.
 * Only checks the constraints that are affected by changing which shift a staff
 * member is assigned to — not the full SchedulerState rebuild.
 */
function isSwapValid(
  allAssignments: AssignmentDraft[],
  indexA: number,
  indexB: number,
  context: SchedulerContext
): boolean {
  const a = allAssignments[indexA];
  const b = allAssignments[indexB];

  const staffA = context.staffMap.get(a.staffId);
  const staffB = context.staffMap.get(b.staffId);
  const shiftA = context.shifts.find((s) => s.id === a.shiftId);
  const shiftB = context.shifts.find((s) => s.id === b.shiftId);

  if (!staffA || !staffB || !shiftA || !shiftB) return false;

  // Build a temporary state excluding the two assignments being swapped
  const remaining = allAssignments.filter((_, i) => i !== indexA && i !== indexB);
  const tempState = new SchedulerState();
  for (const r of remaining) tempState.addAssignment(r);

  // ── Collective constraint checks ────────────────────────────────────────────

  // Guard 1: Charge-slot integrity.
  // isChargeNurse is a SLOT property (spread via {...a}). If staffB would inherit
  // a charge slot but is not charge-qualified Level 4+, the assignment becomes
  // invalid without any individual hard-rule check catching it.
  if (a.isChargeNurse && (!staffB.isChargeNurseQualified || staffB.icuCompetencyLevel < 4)) return false;
  if (b.isChargeNurse && (!staffA.isChargeNurseQualified || staffA.icuCompetencyLevel < 4)) return false;

  // Guard 2: Level 2 supervision.
  // passesHardRules checks whether the INCOMING staff can be placed on a shift,
  // not whether REMOVING someone breaks supervision for staff already there.
  // If staffA (Level 4+) leaves shiftA and shiftA still has Level 2 nurses,
  // shiftA must retain at least one other Level 4+ or the incoming staffB must be Level 4+.
  if (isICUUnit(shiftA.unit)) {
    const remainingOnA = tempState.getShiftAssignments(shiftA.id);
    const hasLevel2OnA = remainingOnA.some(
      (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) === 2
    );
    if (hasLevel2OnA) {
      const stillHasLevel4OnA = remainingOnA.some(
        (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) >= 4
      );
      if (!stillHasLevel4OnA && staffB.icuCompetencyLevel < 4) return false;
    }
  }
  if (isICUUnit(shiftB.unit)) {
    const remainingOnB = tempState.getShiftAssignments(shiftB.id);
    const hasLevel2OnB = remainingOnB.some(
      (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) === 2
    );
    if (hasLevel2OnB) {
      const stillHasLevel4OnB = remainingOnB.some(
        (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) >= 4
      );
      if (!stillHasLevel4OnB && staffA.icuCompetencyLevel < 4) return false;
    }
  }

  // ── Individual eligibility checks ────────────────────────────────────────────

  // Check: staffA → shiftB, staffB → shiftA
  if (!passesHardRules(staffA, shiftB, tempState, context)) return false;
  // Add staffA to shiftB temporarily for staffB check
  const draftA: AssignmentDraft = {
    ...a,
    shiftId: shiftB.id,
    date: shiftB.date,
    shiftType: shiftB.shiftType,
    startTime: shiftB.startTime,
    endTime: shiftB.endTime,
    durationHours: shiftB.durationHours,
    unit: shiftB.unit,
    isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
    floatFromUnit: staffA.homeUnit && staffA.homeUnit !== shiftB.unit ? (staffA.homeUnit ?? null) : null,
  };
  tempState.addAssignment(draftA);
  if (!passesHardRules(staffB, shiftA, tempState, context)) return false;

  return true;
}

/**
 * Local search: improves the greedy result via random swap moves.
 *
 * Each iteration picks two random assignments on different shifts and tries
 * swapping their staff members. If the swap passes all hard rules and reduces
 * total penalty, it is accepted (hill-climbing / steepest-descent variant).
 *
 * This is intentionally simple — CAH scale (~300 assignments) doesn't need
 * simulated annealing or sophisticated metaheuristics.
 */
export function localSearch(
  result: GenerationResult,
  context: SchedulerContext,
  weights: WeightProfile,
  maxIterations = 500
): GenerationResult {
  if (result.assignments.length < 4) return result;

  let assignments = [...result.assignments];
  let currentPenalty = computeTotalPenalty(assignments, context, weights);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Pick two distinct random assignments on different shifts
    const i = Math.floor(Math.random() * assignments.length);
    let j = Math.floor(Math.random() * assignments.length);
    let tries = 0;
    while ((j === i || assignments[i].shiftId === assignments[j].shiftId) && tries < 10) {
      j = Math.floor(Math.random() * assignments.length);
      tries++;
    }
    if (j === i || assignments[i].shiftId === assignments[j].shiftId) continue;

    if (!isSwapValid(assignments, i, j, context)) continue;

    // Build the swapped assignment list
    const a = assignments[i];
    const b = assignments[j];
    const shiftA = context.shifts.find((s) => s.id === a.shiftId)!;
    const shiftB = context.shifts.find((s) => s.id === b.shiftId)!;
    const staffA = context.staffMap.get(a.staffId)!;
    const staffB = context.staffMap.get(b.staffId)!;

    const newA: AssignmentDraft = {
      ...a,
      staffId: b.staffId,
      unit: shiftA.unit,
      isFloat: !!(staffB.homeUnit && staffB.homeUnit !== shiftA.unit),
      floatFromUnit: staffB.homeUnit && staffB.homeUnit !== shiftA.unit ? (staffB.homeUnit ?? null) : null,
    };
    const newB: AssignmentDraft = {
      ...b,
      staffId: a.staffId,
      unit: shiftB.unit,
      isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
      floatFromUnit: staffA.homeUnit && staffA.homeUnit !== shiftB.unit ? (staffA.homeUnit ?? null) : null,
    };

    const swapped = [...assignments];
    swapped[i] = newA;
    swapped[j] = newB;

    const newPenalty = computeTotalPenalty(swapped, context, weights);
    if (newPenalty < currentPenalty) {
      assignments = swapped;
      currentPenalty = newPenalty;
    }
  }

  return { assignments, understaffed: result.understaffed };
}

/**
 * Recompute isOvertime on every draft in calendar order.
 *
 * Defined here (and re-exported from index.ts) so the overtimeReductionSweep
 * below can call it without a circular import.
 */
export function recomputeOvertimeFlags(assignments: AssignmentDraft[]): void {
  const sorted = [...assignments].sort((a, b) =>
    a.date !== b.date ? a.date.localeCompare(b.date) : a.startTime.localeCompare(b.startTime)
  );
  const weekHours = new Map<string, number>();
  for (const draft of sorted) {
    const key = `${draft.staffId}:${getWeekStart(draft.date)}`;
    const current = weekHours.get(key) ?? 0;
    draft.isOvertime = current + draft.durationHours > 40;
    weekHours.set(key, current + draft.durationHours);
  }
}

/**
 * Targeted OT-reduction pass: deterministically tries to swap every overtime
 * assignment with every other assignment on a different shift. Accepts swaps
 * that reduce total weighted penalty (using the variant's own weights — so
 * FAIR won't sacrifice weekend equity to reduce OT, while COST_OPTIMIZED will
 * aggressively accept OT-reducing swaps even at a small preference cost).
 *
 * Exhausts the 2-assignment-swap neighbourhood for OT assignments — far more
 * targeted than the random swaps in localSearch(). Converges when no improving
 * swap remains. Runs after localSearch() for all three weight profiles.
 */
export function overtimeReductionSweep(
  initialAssignments: AssignmentDraft[],
  context: SchedulerContext,
  weights: WeightProfile
): AssignmentDraft[] {
  let assignments = [...initialAssignments];
  let currentPenalty = computeTotalPenalty(assignments, context, weights);
  let madeProgress = true;

  while (madeProgress) {
    madeProgress = false;
    recomputeOvertimeFlags(assignments); // refresh flags before each pass

    const otIndices = assignments
      .map((_, i) => i)
      .filter((i) => assignments[i].isOvertime);

    if (otIndices.length === 0) break;

    outer: for (const otIdx of otIndices) {
      for (let j = 0; j < assignments.length; j++) {
        if (j === otIdx) continue;
        if (assignments[otIdx].shiftId === assignments[j].shiftId) continue;
        if (!isSwapValid(assignments, otIdx, j, context)) continue;

        const a = assignments[otIdx];
        const b = assignments[j];
        const shiftA = context.shifts.find((s) => s.id === a.shiftId)!;
        const shiftB = context.shifts.find((s) => s.id === b.shiftId)!;
        const staffA = context.staffMap.get(a.staffId)!;
        const staffB = context.staffMap.get(b.staffId)!;

        const newA: AssignmentDraft = {
          ...a,
          staffId: b.staffId,
          isFloat: !!(staffB.homeUnit && staffB.homeUnit !== shiftA.unit),
          floatFromUnit:
            staffB.homeUnit && staffB.homeUnit !== shiftA.unit
              ? (staffB.homeUnit ?? null)
              : null,
        };
        const newB: AssignmentDraft = {
          ...b,
          staffId: a.staffId,
          isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
          floatFromUnit:
            staffA.homeUnit && staffA.homeUnit !== shiftB.unit
              ? (staffA.homeUnit ?? null)
              : null,
        };

        const swapped = [...assignments];
        swapped[otIdx] = newA;
        swapped[j] = newB;

        const newPenalty = computeTotalPenalty(swapped, context, weights);
        if (newPenalty < currentPenalty) {
          assignments = swapped;
          currentPenalty = newPenalty;
          madeProgress = true;
          break outer; // restart sweep with updated state
        }
      }
    }
  }

  return assignments;
}

/**
 * Targeted weekend-redistribution pass: tries to swap weekend assignments from
 * staff with above-average weekend counts to staff with below-average counts.
 *
 * The swap is only accepted when it reduces total weighted penalty, so FAIR
 * (weekend equity weight 3.0) will aggressively redistribute while BALANCED
 * accepts only when the improvement outweighs other costs, and COST_OPTIMIZED
 * will skip swaps that would increase overtime cost.
 *
 * Deterministically exhausts the excess-weekend × deficit-staff pairing space
 * rather than sampling randomly. Converges when no improving swap exists.
 */
export function weekendRedistributionSweep(
  initialAssignments: AssignmentDraft[],
  context: SchedulerContext,
  weights: WeightProfile
): AssignmentDraft[] {
  let assignments = [...initialAssignments];
  let currentPenalty = computeTotalPenalty(assignments, context, weights);
  let madeProgress = true;

  while (madeProgress) {
    madeProgress = false;

    // Compute weekend-shift count per staff (include staff with 0 weekend shifts)
    const weekendCounts = new Map<string, number>();
    for (const id of new Set(assignments.map((a) => a.staffId))) {
      weekendCounts.set(id, 0);
    }
    for (const a of assignments) {
      const day = new Date(a.date + "T00:00:00Z").getUTCDay();
      if (day === 0 || day === 6) {
        weekendCounts.set(a.staffId, (weekendCounts.get(a.staffId) ?? 0) + 1);
      }
    }

    const counts = [...weekendCounts.values()];
    if (counts.length < 2) break;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;

    // Staff with fewer-than-average weekend assignments (targets for receiving weekends)
    const deficitStaffIds = new Set(
      [...weekendCounts.entries()]
        .filter(([, c]) => c < mean)
        .map(([id]) => id)
    );

    // Indices of weekend assignments held by staff with above-average weekend count
    const excessIndices = assignments
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => {
        const day = new Date(a.date + "T00:00:00Z").getUTCDay();
        return (day === 0 || day === 6) && (weekendCounts.get(a.staffId) ?? 0) > mean;
      })
      .map(({ i }) => i);

    if (excessIndices.length === 0) break;

    outer: for (const exIdx of excessIndices) {
      for (let j = 0; j < assignments.length; j++) {
        if (j === exIdx) continue;
        if (assignments[exIdx].shiftId === assignments[j].shiftId) continue;
        if (!deficitStaffIds.has(assignments[j].staffId)) continue;
        if (!isSwapValid(assignments, exIdx, j, context)) continue;

        const a = assignments[exIdx];
        const b = assignments[j];
        const shiftA = context.shifts.find((s) => s.id === a.shiftId)!;
        const shiftB = context.shifts.find((s) => s.id === b.shiftId)!;
        const staffA = context.staffMap.get(a.staffId)!;
        const staffB = context.staffMap.get(b.staffId)!;

        const newA: AssignmentDraft = {
          ...a,
          staffId: b.staffId,
          isFloat: !!(staffB.homeUnit && staffB.homeUnit !== shiftA.unit),
          floatFromUnit:
            staffB.homeUnit && staffB.homeUnit !== shiftA.unit
              ? (staffB.homeUnit ?? null)
              : null,
        };
        const newB: AssignmentDraft = {
          ...b,
          staffId: a.staffId,
          isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
          floatFromUnit:
            staffA.homeUnit && staffA.homeUnit !== shiftB.unit
              ? (staffA.homeUnit ?? null)
              : null,
        };

        const swapped = [...assignments];
        swapped[exIdx] = newA;
        swapped[j] = newB;

        const newPenalty = computeTotalPenalty(swapped, context, weights);
        if (newPenalty < currentPenalty) {
          assignments = swapped;
          currentPenalty = newPenalty;
          madeProgress = true;
          break outer; // restart sweep with updated counts
        }
      }
    }
  }

  return assignments;
}
