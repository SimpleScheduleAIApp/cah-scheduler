import type { StaffInfo } from "@/lib/engine/rules/types";
import type { AssignmentDraft, GenerationResult, SchedulerContext, WeightProfile } from "./types";
import { SchedulerState, getWeekStart } from "./state";
import { passesHardRules, isICUUnit } from "./eligibility";
import { softPenalty } from "./scoring";

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32
//
// A minimal, fast, zero-dependency 32-bit PRNG. Produces the same sequence
// for the same seed, giving fully reproducible schedules. Used instead of
// Math.random() throughout the local search so the base seed recorded in the
// audit log is sufficient to reproduce any generated schedule.
//
// Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
// ---------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Late Acceptance buffer size (K)
//
// The LA algorithm accepts a candidate if it scores no worse than the solution
// K iterations ago. K=200 gives a look-back window large enough to escape
// shallow local optima without inflating the acceptance rate so much that
// the search becomes a random walk.
// ---------------------------------------------------------------------------
const LA_BUFFER_SIZE = 200;

/**
 * Compute a proxy total penalty from a flat list of assignments.
 * Accepts a pre-built SchedulerState — callers are responsible for keeping
 * it in sync with `assignments`. This eliminates the O(A²) rebuild on every call.
 */
function computeTotalPenalty(
  assignments: AssignmentDraft[],
  state: SchedulerState,
  context: SchedulerContext,
  weights: WeightProfile
): number {
  // Precompute shift → all assignments map once (O(n)) to avoid O(n²) filter in the loop below
  const shiftCoworkers = new Map<string, AssignmentDraft[]>();
  for (const a of assignments) {
    const list = shiftCoworkers.get(a.shiftId);
    if (list) list.push(a);
    else shiftCoworkers.set(a.shiftId, [a]);
  }

  let total = 0;
  for (const a of assignments) {
    const staffInfo = context.staffMap.get(a.staffId);
    const shiftInfo = context.shiftMap.get(a.shiftId);
    if (!staffInfo || !shiftInfo) continue;

    const currentShiftAssignments = (shiftCoworkers.get(a.shiftId) ?? [])
      .filter((x) => x.staffId !== a.staffId);

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

// ---------------------------------------------------------------------------
// Delta penalty helpers
//
// Instead of calling computeTotalPenalty(allAssignments, ...) on every swap
// candidate — which is O(A) per evaluation — these three helpers identify the
// ~15-30 assignments whose softPenalty actually changes, score only those, and
// return the net delta.  The key insight is that a staff swap only affects:
//
//   1. Coworkers on the two touched shifts (skill mix, charge clustering).
//   2. Each swapped staff member's other assignments in the affected calendar
//      weeks (OT / capacity-spreading component).
//
// All remaining assignments are unchanged and need not be rescored.
// ---------------------------------------------------------------------------

/**
 * Collect the minimal set of assignments whose softPenalty changes when `a`
 * (staffA on shiftA) and `b` (staffB on shiftB) are swapped.  Uses O(1)
 * SchedulerState lookups — no full-array scan.
 */
function buildAffectedSet(
  a: AssignmentDraft,
  b: AssignmentDraft,
  state: SchedulerState
): AssignmentDraft[] {
  const seen = new Set<string>();
  const result: AssignmentDraft[] = [];

  const add = (x: AssignmentDraft) => {
    const k = `${x.staffId}:${x.shiftId}`;
    if (!seen.has(k)) { seen.add(k); result.push(x); }
  };

  // 1. Everyone on shiftA and shiftB (coworker effects)
  for (const x of state.getShiftAssignments(a.shiftId)) add(x);
  for (const x of state.getShiftAssignments(b.shiftId)) add(x);

  // 2. StaffA's other assignments in the two affected calendar weeks (OT delta)
  const weekA = getWeekStart(a.date);
  const weekB = getWeekStart(b.date);
  for (const x of state.getStaffAssignments(a.staffId)) {
    const w = getWeekStart(x.date);
    if (w === weekA || w === weekB) add(x);
  }

  // 3. StaffB's other assignments in the same weeks
  for (const x of state.getStaffAssignments(b.staffId)) {
    const w = getWeekStart(x.date);
    if (w === weekA || w === weekB) add(x);
  }

  return result;
}

/**
 * Sum softPenalty for a subset of assignments.
 * Coworker lists are fetched from `state` so skill-mix reflects the current
 * (possibly already-mutated) full shift composition.
 */
function scoreSubset(
  subset: AssignmentDraft[],
  state: SchedulerState,
  context: SchedulerContext,
  weights: WeightProfile
): number {
  let total = 0;
  for (const x of subset) {
    const staffInfo = context.staffMap.get(x.staffId);
    const shiftInfo = context.shiftMap.get(x.shiftId);
    if (!staffInfo || !shiftInfo) continue;
    const coworkers = state.getShiftAssignments(x.shiftId).filter((c) => c.staffId !== x.staffId);
    total += softPenalty(
      staffInfo, shiftInfo, state, weights, coworkers,
      context.staffMap, x.isChargeNurse, context.unitConfig,
      context.historicalWeekendCounts ?? new Map()
    );
  }
  return total;
}

/**
 * Compute the net penalty delta of swapping `a` ↔ `b` without committing the
 * swap.  Temporarily mutates `state` (remove a & b, add newA & newB), scores
 * the affected set, then restores — safe because JS is single-threaded.
 *
 * Returns (newPenalty − oldPenalty).  Negative = improvement.
 */
function computeSwapDeltaPenalty(
  a: AssignmentDraft,
  b: AssignmentDraft,
  newA: AssignmentDraft,
  newB: AssignmentDraft,
  state: SchedulerState,
  context: SchedulerContext,
  weights: WeightProfile
): number {
  const affected = buildAffectedSet(a, b, state);
  const oldScore = scoreSubset(affected, state, context, weights);

  // Apply the swap in-place
  state.removeAssignment(a);
  state.removeAssignment(b);
  state.addAssignment(newA);
  state.addAssignment(newB);

  // Remap a → newA and b → newB within the affected list
  const newAffected = affected.map((x) => {
    if (x.staffId === a.staffId && x.shiftId === a.shiftId) return newA;
    if (x.staffId === b.staffId && x.shiftId === b.shiftId) return newB;
    return x;
  });
  const newScore = scoreSubset(newAffected, state, context, weights);

  // Restore
  state.removeAssignment(newA);
  state.removeAssignment(newB);
  state.addAssignment(a);
  state.addAssignment(b);

  return newScore - oldScore;
}

/**
 * Quick hard-rule check for a proposed swap.
 * Temporarily removes the two assignments from `currentState` in-place,
 * checks hard rules, then restores — no clone required.
 */
function isSwapValid(
  currentState: SchedulerState,
  allAssignments: AssignmentDraft[],
  indexA: number,
  indexB: number,
  context: SchedulerContext
): boolean {
  const a = allAssignments[indexA];
  const b = allAssignments[indexB];

  const staffA = context.staffMap.get(a.staffId);
  const staffB = context.staffMap.get(b.staffId);
  const shiftA = context.shiftMap.get(a.shiftId);
  const shiftB = context.shiftMap.get(b.shiftId);

  if (!staffA || !staffB || !shiftA || !shiftB) return false;

  // Temporarily remove both assignments for hard-rule evaluation.
  // JS is single-threaded — safe to mutate and restore unconditionally via finally.
  currentState.removeAssignment(a);
  currentState.removeAssignment(b);

  // Build draftA outside try so it's available for restoration in finally.
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
  let draftAAdded = false;

  try {
    // ── Collective constraint checks ──────────────────────────────────────────

    // Guard 1: Charge-slot integrity.
    if (a.isChargeNurse && (!staffB.isChargeNurseQualified || staffB.icuCompetencyLevel < 4)) return false;
    if (b.isChargeNurse && (!staffA.isChargeNurseQualified || staffA.icuCompetencyLevel < 4)) return false;

    // Guard 2: Level 2 supervision.
    if (isICUUnit(shiftA.unit)) {
      const remainingOnA = currentState.getShiftAssignments(shiftA.id);
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
      const remainingOnB = currentState.getShiftAssignments(shiftB.id);
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

    // ── Individual eligibility checks ─────────────────────────────────────────

    if (!passesHardRules(staffA, shiftB, currentState, context)) return false;
    currentState.addAssignment(draftA);
    draftAAdded = true;
    if (!passesHardRules(staffB, shiftA, currentState, context)) return false;

    return true;
  } finally {
    // Always restore — try/finally guarantees execution on every return path.
    if (draftAAdded) currentState.removeAssignment(draftA);
    currentState.addAssignment(a);
    currentState.addAssignment(b);
  }
}

/**
 * Local search: improves the greedy result via random swap moves.
 *
 * Uses Late Acceptance (Burke & Bykov, 2012) rather than plain hill climbing.
 * The acceptance criterion is: accept the candidate if its penalty is no worse
 * than the solution LA_BUFFER_SIZE iterations ago. This allows the search to
 * cross shallow local optima and neutral plateaus that hill climbing would
 * get stuck in, without the parameter sensitivity of simulated annealing.
 *
 * The working solution (subject to LA acceptance) is tracked separately from
 * the best solution seen, which is returned at the end. This ensures the
 * search can explore worse territory temporarily without losing improvements.
 *
 * Randomness is driven by a seeded mulberry32 PRNG so the same seed always
 * produces the same schedule — fully reproducible given the seed recorded in
 * the audit log.
 *
 * @param seed  32-bit integer seed for the PRNG. Record this to reproduce.
 */
export function localSearch(
  result: GenerationResult,
  context: SchedulerContext,
  weights: WeightProfile,
  maxIterations = 500,
  seed = 0
): GenerationResult {
  if (result.assignments.length < 4) return result;

  const rand = mulberry32(seed);

  let assignments = [...result.assignments];

  // Build state once — updated incrementally on every accepted swap
  const state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);

  let currentPenalty = computeTotalPenalty(assignments, state, context, weights);

  // Late Acceptance circular buffer — stores penalties of past solutions
  const laBuffer = new Array<number>(LA_BUFFER_SIZE).fill(currentPenalty);
  let laIdx = 0;

  // Track the best solution seen (LA may temporarily accept worse solutions)
  let bestPenalty = currentPenalty;
  let bestAssignments = [...assignments];

  for (let iter = 0; iter < maxIterations; iter++) {
    // Pick two distinct random assignments on different shifts
    const i = Math.floor(rand() * assignments.length);
    let j = Math.floor(rand() * assignments.length);
    let tries = 0;
    while ((j === i || assignments[i].shiftId === assignments[j].shiftId) && tries < 10) {
      j = Math.floor(rand() * assignments.length);
      tries++;
    }
    if (j === i || assignments[i].shiftId === assignments[j].shiftId) continue;

    if (!isSwapValid(state, assignments, i, j, context)) continue;

    const a = assignments[i];
    const b = assignments[j];
    const shiftA = context.shiftMap.get(a.shiftId)!;
    const shiftB = context.shiftMap.get(b.shiftId)!;
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

    // Delta penalty: only re-scores the ~15-30 affected assignments instead of
    // all ~280.  Temporarily mutates and restores state internally.
    const delta = computeSwapDeltaPenalty(a, b, newA, newB, state, context, weights);
    const newPenalty = currentPenalty + delta;

    // Late Acceptance: accept if no worse than K iterations ago
    if (newPenalty <= laBuffer[laIdx]) {
      // Commit the swap permanently
      state.removeAssignment(a);
      state.removeAssignment(b);
      state.addAssignment(newA);
      state.addAssignment(newB);
      assignments[i] = newA;
      assignments[j] = newB;
      currentPenalty = newPenalty;

      if (newPenalty < bestPenalty) {
        bestPenalty = newPenalty;
        bestAssignments = [...assignments];
      }
    }

    // Always advance the buffer with the current (post-accept/reject) solution
    laBuffer[laIdx] = currentPenalty;
    laIdx = (laIdx + 1) % LA_BUFFER_SIZE;
  }

  return { assignments: bestAssignments, understaffed: result.understaffed };
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
  const assignments = [...initialAssignments];

  // Build state once — updated incrementally on each accepted swap
  const state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);

  let currentPenalty = computeTotalPenalty(assignments, state, context, weights);
  let madeProgress = true;
  let sweepIter = 0;
  const MAX_SWEEP_ITERS = 500;

  while (madeProgress) {
    if (++sweepIter > MAX_SWEEP_ITERS) {
      console.warn(`[scheduler] overtimeReductionSweep: hit ${MAX_SWEEP_ITERS}-iteration cap`);
      break;
    }
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
        if (!isSwapValid(state, assignments, otIdx, j, context)) continue;

        const a = assignments[otIdx];
        const b = assignments[j];
        const shiftA = context.shiftMap.get(a.shiftId)!;
        const shiftB = context.shiftMap.get(b.shiftId)!;
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

        const delta = computeSwapDeltaPenalty(a, b, newA, newB, state, context, weights);
        if (delta < 0) {
          state.removeAssignment(a);
          state.removeAssignment(b);
          state.addAssignment(newA);
          state.addAssignment(newB);
          assignments[otIdx] = newA;
          assignments[j] = newB;
          currentPenalty += delta;
          madeProgress = true;
          break outer; // restart sweep with updated state
        }
      }
    }
  }

  console.log(`[scheduler] overtimeReductionSweep: ${sweepIter} iterations`);
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
  const assignments = [...initialAssignments];

  // Build state once — updated incrementally on each accepted swap
  const state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);

  let currentPenalty = computeTotalPenalty(assignments, state, context, weights);
  let madeProgress = true;
  let sweepIter = 0;
  const MAX_SWEEP_ITERS = 500;

  while (madeProgress) {
    if (++sweepIter > MAX_SWEEP_ITERS) {
      console.warn(`[scheduler] weekendRedistributionSweep: hit ${MAX_SWEEP_ITERS}-iteration cap`);
      break;
    }
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
        if (!isSwapValid(state, assignments, exIdx, j, context)) continue;

        const a = assignments[exIdx];
        const b = assignments[j];
        const shiftA = context.shiftMap.get(a.shiftId)!;
        const shiftB = context.shiftMap.get(b.shiftId)!;
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

        const delta = computeSwapDeltaPenalty(a, b, newA, newB, state, context, weights);
        if (delta < 0) {
          state.removeAssignment(a);
          state.removeAssignment(b);
          state.addAssignment(newA);
          state.addAssignment(newB);
          assignments[exIdx] = newA;
          assignments[j] = newB;
          currentPenalty += delta;
          madeProgress = true;
          break outer; // restart sweep with updated counts
        }
      }
    }
  }

  console.log(`[scheduler] weekendRedistributionSweep: ${sweepIter} iterations`);
  return assignments;
}
