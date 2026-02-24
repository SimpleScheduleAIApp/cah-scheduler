import { buildContext } from "@/lib/engine/rule-engine";
import type { AssignmentDraft, GenerationResult, SchedulerContext, WeightProfile } from "./types";
import { greedyConstruct } from "./greedy";
import { repairHardViolations } from "./repair";
import { localSearch, recomputeOvertimeFlags, overtimeReductionSweep } from "./local-search";

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
 */
export function generateSchedule(
  scheduleId: string,
  weights: WeightProfile,
  localSearchIterations = 500,
  greedyWeights?: WeightProfile
): GenerationResult {
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

  // Phase 2: Local search improvement
  const improved = localSearch(repaired, context, weights, localSearchIterations);

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
  const finalAssignments = overtimeReductionSweep(improved.assignments, context, weights);
  recomputeOvertimeFlags(finalAssignments); // refresh flags after sweep

  return { assignments: finalAssignments, understaffed: improved.understaffed };
}

// Re-export types and profiles for convenience
export { BALANCED, FAIR, COST_OPTIMIZED } from "./weight-profiles";
export type { GenerationResult, AssignmentDraft, UnderstaffedShift, WeightProfile } from "./types";
