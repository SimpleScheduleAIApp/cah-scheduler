import type { RuleEvaluator, RuleContext, RuleViolation } from "./types";

/**
 * Patient-to-Nurse Ratio Rule (Hard)
 * The ratio of patients to RNs must not exceed the maximum defined in the census band.
 *
 * Per AACN standards and state law, the ICU nurse:patient ratio is RN-only (2:1).
 * LPNs are support staff and do not substitute for RNs in the ratio calculation.
 * CNAs are tracked separately and do not count toward this ratio.
 *
 * Note: this rule only fires for shifts with an actualCensus value set. Shifts using
 * the census tier system (censusBandId set, actualCensus null) satisfy the ratio
 * by band construction — the band's requiredRNs is sized to satisfy 2:1 at peak
 * census for that tier.
 */
export const patientRatioRule: RuleEvaluator = {
  id: "patient-ratio",
  name: "Patient-to-Licensed-Staff Ratio",
  type: "hard",
  category: "staffing",
  evaluate(context: RuleContext): RuleViolation[] {
    const violations: RuleViolation[] = [];

    for (const [shiftId, shift] of context.shiftMap) {
      if (shift.actualCensus === null) continue;

      const band = context.censusBands.find(
        (b) =>
          shift.actualCensus! >= b.minPatients &&
          shift.actualCensus! <= b.maxPatients
      );
      if (!band) continue;

      const shiftAssignments = context.assignments.filter(
        (a) => a.shiftId === shiftId
      );

      // Count RNs only — the 2:1 ICU ratio is RN-to-patient per AACN standard.
      // LPNs are support staff and do not count toward the clinical nurse:patient ratio.
      const rnCount = shiftAssignments.filter((a) => {
        const staff = context.staffMap.get(a.staffId);
        return staff?.role === "RN";
      }).length;

      if (rnCount === 0 && shift.actualCensus > 0) {
        violations.push({
          ruleId: "patient-ratio",
          ruleName: "Patient-to-Nurse Ratio",
          ruleType: "hard",
          shiftId,
          description: `Shift on ${shift.date} (${shift.shiftType}) has ${shift.actualCensus} patients but no RNs assigned`,
        });
        continue;
      }

      // Parse ratio like "2:1" → max 2 patients per RN
      const [maxPatients] = band.patientToNurseRatio.split(":").map(Number);
      const actualRatio = rnCount > 0 ? shift.actualCensus / rnCount : Infinity;

      if (actualRatio > maxPatients) {
        violations.push({
          ruleId: "patient-ratio",
          ruleName: "Patient-to-Nurse Ratio",
          ruleType: "hard",
          shiftId,
          description: `Shift on ${shift.date} (${shift.shiftType}): RN ratio is ${actualRatio.toFixed(1)}:1 (${shift.actualCensus} patients / ${rnCount} RNs), max allowed is ${maxPatients}:1`,
        });
      }
    }

    return violations;
  },
};
