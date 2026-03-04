import { describe, it, expect } from "vitest";
import { patientRatioRule } from "@/lib/engine/rules/patient-ratio";
import { makeContext, makeShift, makeAssignment, makeStaff, defaultCensusBand } from "../helpers/context";

describe("patient-ratio rule", () => {
  const band = { ...defaultCensusBand, minPatients: 0, maxPatients: 10, patientToNurseRatio: "3:1" };

  it("skips shifts with no census data", () => {
    const shift = makeShift({ id: "s1", actualCensus: null });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      censusBands: [band],
    });
    expect(patientRatioRule.evaluate(ctx)).toHaveLength(0);
  });

  it("skips shifts where no census band matches", () => {
    const shift = makeShift({ id: "s1", actualCensus: 50 });
    // Band only covers 0-10
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      censusBands: [band],
    });
    expect(patientRatioRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags when there are patients but no RNs assigned", () => {
    // Since v1.5.1 the rule counts RNs only (AACN standard — LPNs excluded from ICU ratio).
    // A shift with only CNA staff has 0 RNs → violation.
    const shift = makeShift({ id: "s1", actualCensus: 4 });
    const cnaStaff = makeStaff({ id: "staff-1", role: "CNA" });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", cnaStaff]]),
      assignments: [a1],
      censusBands: [band],
    });
    const violations = patientRatioRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].description).toContain("no RNs");
  });

  it("passes with ratio exactly at limit (3:1 with 4 patients, 2 RNs = 2.0:1)", () => {
    const shift = makeShift({ id: "s1", actualCensus: 4 });
    const s1 = makeStaff({ id: "staff-1", role: "RN" });
    const s2 = makeStaff({ id: "staff-2", role: "RN" });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", s1], ["staff-2", s2]]),
      assignments: [a1, a2],
      censusBands: [band], // ratio 3:1
    });
    // 4 patients / 2 RNs = 2.0 <= 3.0 ✓
    expect(patientRatioRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags when ratio exceeds limit (3:1 with 7 patients, 2 RNs = 3.5:1)", () => {
    const shift = makeShift({ id: "s1", actualCensus: 7 });
    const s1 = makeStaff({ id: "staff-1", role: "RN" });
    const s2 = makeStaff({ id: "staff-2", role: "RN" });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", s1], ["staff-2", s2]]),
      assignments: [a1, a2],
      censusBands: [band], // ratio 3:1
    });
    // 7 patients / 2 RNs = 3.5 > 3.0 ✗
    const violations = patientRatioRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("patient-ratio");
    expect(violations[0].description).toContain("3.5:1");
  });

  it("does NOT count LPNs toward the RN ratio (RN-only per AACN standard, v1.5.1)", () => {
    // Before v1.5.1 the rule counted RN+LPN. It was changed to RN-only per AACN ICU
    // scope-of-practice standards. An LPN on the shift does not satisfy the ratio.
    const shift = makeShift({ id: "s1", actualCensus: 6 });
    const rnStaff = makeStaff({ id: "staff-1", role: "RN" });
    const lpnStaff = makeStaff({ id: "staff-2", role: "LPN" });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", rnStaff], ["staff-2", lpnStaff]]),
      assignments: [a1, a2],
      censusBands: [band], // 3:1
    });
    // 6 patients / 1 RN (LPN not counted) = 6.0 > 3.0 → violation
    const violations = patientRatioRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].description).toContain("6.0:1");
  });

  it("does not count CNA as licensed staff", () => {
    const shift = makeShift({ id: "s1", actualCensus: 4 });
    const rnStaff = makeStaff({ id: "staff-1", role: "RN" });
    const cnaStaff = makeStaff({ id: "staff-2", role: "CNA" });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", rnStaff], ["staff-2", cnaStaff]]),
      assignments: [a1, a2],
      censusBands: [band], // 3:1
    });
    // Only 1 RN counts as licensed, 4/1 = 4.0 > 3.0 -> violation
    const violations = patientRatioRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
  });
});
