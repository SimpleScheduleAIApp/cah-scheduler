import { buildContext } from "@/lib/engine/rule-engine";
import type { AssignmentDraft, GenerationResult, SchedulerContext, WeightProfile } from "./types";
import { greedyConstruct } from "./greedy";
import { repairHardViolations } from "./repair";
import { localSearch, mulberry32, recomputeOvertimeFlags, overtimeReductionSweep, weekendRedistributionSweep } from "./local-search";

/**
 * Build a SchedulerContext from a schedule ID using the existing rule-engine
 * context builder. The returned context has an empty `assignments` array so
 * the scheduler starts from a blank slate.
 */
export function buildSchedulerContext(scheduleId: string): SchedulerContext {
  // Reuse the rule-engine's context builder — it fetches all schedule data
  const ruleContext = buildContext(scheduleId);

  const staffList = [...ruleContext.staffMap.values()];
  const shifts = [...ruleContext.shiftMap.values()];

  return {
    scheduleId,
    shifts,
    shiftMap: ruleContext.shiftMap,
    staffList,
    staffMap: ruleContext.staffMap,
    prnAvailability: ruleContext.prnAvailability,
    staffLeaves: ruleContext.staffLeaves,
    unitConfig: ruleContext.unitConfig,
    scheduleUnit: ruleContext.scheduleUnit,
    publicHolidays: ruleContext.publicHolidays,
    historicalWeekendCounts: ruleContext.historicalWeekendCounts,
  };
}

/**
 * Generate a complete schedule using greedy construction + local search.
 *
 * @param scheduleId           The schedule to generate for
 * @param weights              Penalty weights for local search, OT sweep, and scoring
 * @param localSearchIterations  Number of swap attempts in the improvement phase
 * @param greedyWeights        Weights to use specifically for greedy construction.
 *                             Defaults to `weights` when omitted. Pass BALANCED here
 *                             when `weights` is COST_OPTIMIZED — the greedy's job is
 *                             to build a well-distributed feasible schedule; a high OT
 *                             weight at this stage depletes low-hour staff early and
 *                             paradoxically creates more structural OT. The variant's
 *                             cost-focused personality is then applied fully in the
 *                             local search and OT sweep phases.
 * @param seed                 32-bit integer seed for the local search PRNG.
 *                             The same seed + same weights always produces the same
 *                             schedule. Defaults to a time-based value when omitted;
 *                             pass an explicit seed from the runner to record it in
 *                             the audit log and enable later reproduction.
 */
export function generateSchedule(
  scheduleId: string,
  weights: WeightProfile,
  localSearchIterations = 500,
  greedyWeights?: WeightProfile,
  seed?: number
): GenerationResult {
  // Generate a seed if not provided (time-based — not reproducible, but fine for
  // ad-hoc use; runner.ts always passes an explicit seed that it records).
  const resolvedSeed = seed ?? (Date.now() & 0x7fffffff);

  const context = buildSchedulerContext(scheduleId);

  // Phase 1: Greedy construction
  // Use greedyWeights if provided — allows the caller to separate the
  // "build a feasible schedule" objective from the "optimise for X" objective.
  const greedy = greedyConstruct(context, greedyWeights ?? weights);

  // Phase 1.5: Repair hard violations
  // Attempts to fix remaining charge / Level-4+ / understaffing violations by
  // moving specialised staff from lower-priority shifts into critical slots,
  // then back-filling the vacated slots with generalist nurses.
  const repaired = repairHardViolations(greedy, context);

  // Phase 2: Local search improvement (Late Acceptance metaheuristic)
  const improved = localSearch(repaired, context, weights, localSearchIterations, resolvedSeed);

  // Phase 3 (display fix): Recompute isOvertime in calendar order.
  // Construction uses most-constrained-first ordering, so weekend shifts are
  // built before the weekday shifts that actually trigger the 40h threshold.
  // Without this pass, the wrong shift (often a Tuesday) carries the OT badge
  // while later-in-the-week Saturday/Sunday shifts show nothing.
  recomputeOvertimeFlags(improved.assignments);

  // Phase 4: Targeted OT-reduction sweep.
  // Deterministically tries every OT assignment as a swap candidate — exhausts
  // the 2-assignment-swap neighbourhood for OT assignments (OT_count × n
  // combinations per pass) rather than sampling randomly. FAIR won't sacrifice
  // weekend equity because computeTotalPenalty uses the variant's own weights.
  const afterOTSweep = overtimeReductionSweep(improved.assignments, context, weights);
  recomputeOvertimeFlags(afterOTSweep); // refresh flags after sweep

  // Phase 5: Targeted weekend-redistribution sweep.
  // Deterministically tries to move weekend assignments from staff with above-
  // average weekend counts to staff with below-average counts. FAIR aggressively
  // accepts these swaps (weekend equity weight 3.0); BALANCED accepts only when
  // the equity improvement outweighs other soft costs; COST_OPTIMIZED skips
  // swaps that would increase overtime cost.
  const finalAssignments = weekendRedistributionSweep(afterOTSweep, context, weights);
  recomputeOvertimeFlags(finalAssignments); // refresh OT flags after potential staff moves

  return { assignments: finalAssignments, understaffed: improved.understaffed };
}

// Re-export types and profiles for convenience
export { BALANCED, FAIR, COST_OPTIMIZED } from "./weight-profiles";
export type { GenerationResult, AssignmentDraft, UnderstaffedShift, WeightProfile } from "./types";
