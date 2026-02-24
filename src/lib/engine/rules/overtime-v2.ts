import type { RuleEvaluator, RuleContext, RuleViolation, AssignmentInfo } from "./types";

/**
 * Overtime Rules V2 (Soft)
 *
 * Updated overtime calculation per Pradeep's feedback:
 * 1. Hours > 40 in a fixed work week = HIGH penalty (actual overtime)
 * 2. Hours > (FTE * 40) but <= 40 = LOW penalty (extra hours but not OT)
 *
 * Example: A 0.9 FTE nurse (36 hours standard) picks up 4 extra hours:
 * - Total: 40 hours
 * - This is NOT overtime (not > 40), but IS extra hours (> 36)
 * - Apply low penalty for extra hours, not high OT penalty
 *
 * It's better to pay staff extra shift premium than OT or agency rates.
 */
export const overtimeRulesV2: RuleEvaluator = {
  id: "overtime-v2",
  name: "Overtime & Extra Hours",
  type: "soft",
  category: "cost",
  evaluate: (context: RuleContext): RuleViolation[] => {
    const violations: RuleViolation[] = [];

    // Penalty weights
    const actualOtPenaltyWeight = (context.ruleParameters.actualOtPenaltyWeight as number) ?? 1.0;
    const extraHoursPenaltyWeight = (context.ruleParameters.extraHoursPenaltyWeight as number) ?? 0.3;

    // Group assignments by staff and week
    // Week is Monday-Sunday
    const getWeekStart = (dateStr: string): string => {
      const date = new Date(dateStr);
      const day = date.getDay();
      const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      const monday = new Date(date.setDate(diff));
      return monday.toISOString().split("T")[0];
    };

    // Group assignments by staff → week → list (to be sorted chronologically)
    const staffWeekAssignments = new Map<string, Map<string, AssignmentInfo[]>>();

    for (const a of context.assignments) {
      const shift = context.shiftMap.get(a.shiftId);
      // Only count shifts that count toward staffing
      if (!shift?.countsTowardStaffing) continue;

      const weekStart = getWeekStart(a.date);
      const staffWeeks = staffWeekAssignments.get(a.staffId) ?? new Map<string, AssignmentInfo[]>();
      const weekList = staffWeeks.get(weekStart) ?? [];
      weekList.push(a);
      staffWeeks.set(weekStart, weekList);
      staffWeekAssignments.set(a.staffId, staffWeeks);
    }

    // Walk through each staff member's week in chronological order.
    // For actual OT (>40h): flag only the shift that first crosses 40h (once per week).
    // For extra hours (above FTE, ≤40h): flag EVERY such shift using the marginal
    // extra hours contributed by that specific shift — not a running total — so the
    // penalty reflects what this shift alone adds rather than inflating it with hours
    // already flagged by earlier shifts.
    for (const [staffId, weekAssignmentsMap] of staffWeekAssignments) {
      const staffInfo = context.staffMap.get(staffId);
      if (!staffInfo) continue;

      // Skip agency/PRN staff with no FTE commitment (fte = 0).
      // They are scheduled on-demand and have no standard weekly hours to enforce.
      if (staffInfo.fte === 0) continue;

      const staffName = `${staffInfo.firstName} ${staffInfo.lastName}`;
      const standardHours = Math.min(staffInfo.fte * 40, 40); // cap at 40

      for (const [weekStart, assignments] of weekAssignmentsMap) {
        // Sort chronologically so we detect the exact crossing point
        const sorted = [...assignments].sort((a, b) => a.date.localeCompare(b.date));

        let cumulativeHours = 0;
        let actualOtFlagged = false;

        for (const a of sorted) {
          const prevCumulative = cumulativeHours;
          cumulativeHours += a.durationHours;

          // Case 1: This shift pushes past 40h → actual overtime (flagged once per week)
          if (!actualOtFlagged && cumulativeHours > 40) {
            const overtimeHours = cumulativeHours - 40;
            const penaltyScore = (overtimeHours / 12) * actualOtPenaltyWeight;

            violations.push({
              ruleId: "overtime-v2",
              ruleName: "Overtime",
              ruleType: "soft",
              shiftId: a.shiftId,
              staffId,
              description: `${staffName} reaches ${cumulativeHours.toFixed(1)}h in week of ${weekStart} — this shift causes ${overtimeHours.toFixed(1)}h of actual overtime (>40h)`,
              penaltyScore,
            });
            actualOtFlagged = true;
          }
          // Case 2: This shift is in the extra-hours zone (above FTE target, ≤40h).
          // Flagged on EVERY shift in this zone — not just the first crossing — so
          // managers see each shift that compounds the over-scheduling.
          // Penalty uses the marginal extra hours this shift contributes:
          //   - If already above standard before this shift: all hours are extra
          //   - If crossing the threshold: only the portion above standard is extra
          else if (standardHours < 40 && cumulativeHours > standardHours && cumulativeHours <= 40) {
            const shiftExtraHours = prevCumulative >= standardHours
              ? a.durationHours                    // already above FTE — full shift is extra
              : cumulativeHours - standardHours;   // partial crossing — only excess portion
            const penaltyScore = (shiftExtraHours / 12) * extraHoursPenaltyWeight;

            violations.push({
              ruleId: "extra-hours",
              ruleName: "Extra Hours Above FTE",
              ruleType: "soft",
              shiftId: a.shiftId,
              staffId,
              description: `${staffName} (${staffInfo.fte} FTE, ${standardHours}h/week) reaches ${cumulativeHours.toFixed(1)}h in week of ${weekStart} — this shift adds ${shiftExtraHours.toFixed(1)}h above contracted hours`,
              penaltyScore,
            });
          }
        }
      }
    }

    return violations;
  },
};
