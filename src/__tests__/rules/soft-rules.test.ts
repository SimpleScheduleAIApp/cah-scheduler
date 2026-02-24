/**
 * Tests for remaining soft rules:
 * - float-penalty
 * - skill-mix
 * - charge-clustering
 * - preference-match
 * - weekend-fairness
 * - weekend-count (from weekend-holiday-fairness)
 * - consecutive-weekends (from weekend-holiday-fairness)
 */
import { describe, it, expect } from "vitest";
import { floatPenaltyRule } from "@/lib/engine/rules/float-penalty";
import { skillMixRule } from "@/lib/engine/rules/skill-mix";
import { chargeClusteringRule } from "@/lib/engine/rules/charge-clustering";
import { preferenceMatchRule } from "@/lib/engine/rules/preference-match";
import { weekendFairnessRule } from "@/lib/engine/rules/weekend-fairness";
import { weekendCountRule, consecutiveWeekendRule } from "@/lib/engine/rules/weekend-holiday-fairness";
import { makeContext, makeAssignment, makeStaff, makeShift, defaultUnitConfig } from "../helpers/context";

// ─── float-penalty ────────────────────────────────────────────────────────────
describe("float-penalty rule", () => {
  it("passes non-float assignments", () => {
    const staff = makeStaff({ id: "staff-1" });
    const shift = makeShift({ id: "s1", unit: "ICU" });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftId: "s1", isFloat: false });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
      shiftMap: new Map([["s1", shift]]),
    });
    expect(floatPenaltyRule.evaluate(ctx)).toHaveLength(0);
  });

  it("penalizes float to a unit not cross-trained (high penalty 1.0)", () => {
    const staff = makeStaff({ id: "staff-1", homeUnit: "ICU", crossTrainedUnits: [] });
    const shift = makeShift({ id: "s1", unit: "ER" });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftId: "s1", isFloat: true, floatFromUnit: "ICU" });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
      shiftMap: new Map([["s1", shift]]),
    });
    const violations = floatPenaltyRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].penaltyScore).toBe(1.0);
    expect(violations[0].description).toContain("not cross-trained");
  });

  it("penalizes float to a cross-trained unit (low penalty 0.3)", () => {
    const staff = makeStaff({ id: "staff-1", homeUnit: "ICU", crossTrainedUnits: ["ER"] });
    const shift = makeShift({ id: "s1", unit: "ER" });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftId: "s1", isFloat: true });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
      shiftMap: new Map([["s1", shift]]),
    });
    const violations = floatPenaltyRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].penaltyScore).toBe(0.3);
    expect(violations[0].description).not.toContain("not cross-trained");
  });

  it("cross-trained check is case-insensitive", () => {
    const staff = makeStaff({ id: "staff-1", homeUnit: "ICU", crossTrainedUnits: ["er"] });
    const shift = makeShift({ id: "s1", unit: "ER" });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftId: "s1", isFloat: true });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
      shiftMap: new Map([["s1", shift]]),
    });
    const violations = floatPenaltyRule.evaluate(ctx);
    expect(violations[0].penaltyScore).toBe(0.3); // Cross-trained (case-insensitive)
  });
});

// ─── skill-mix ────────────────────────────────────────────────────────────────
describe("skill-mix rule", () => {
  it("passes with good competency range (e.g. levels 2 and 5)", () => {
    const shift = makeShift({ id: "s1" });
    const s1 = makeStaff({ id: "staff-1", icuCompetencyLevel: 2 });
    const s2 = makeStaff({ id: "staff-2", icuCompetencyLevel: 5 });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", s1], ["staff-2", s2]]),
      assignments: [a1, a2],
    });
    expect(skillMixRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags when all staff are at the same competency level (penalty 0.6)", () => {
    const shift = makeShift({ id: "s1" });
    const s1 = makeStaff({ id: "staff-1", icuCompetencyLevel: 3 });
    const s2 = makeStaff({ id: "staff-2", icuCompetencyLevel: 3 });
    const s3 = makeStaff({ id: "staff-3", icuCompetencyLevel: 3 });
    const assignments = [
      makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" }),
      makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" }),
      makeAssignment({ id: "a3", shiftId: "s1", staffId: "staff-3" }),
    ];
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", s1], ["staff-2", s2], ["staff-3", s3]]),
      assignments,
    });
    const violations = skillMixRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].penaltyScore).toBe(0.6);
    expect(violations[0].description).toContain("no experience mix");
  });

  it("flags limited range (1 level gap, max <= 3) with low penalty 0.3", () => {
    const shift = makeShift({ id: "s1" });
    const s1 = makeStaff({ id: "staff-1", icuCompetencyLevel: 2 });
    const s2 = makeStaff({ id: "staff-2", icuCompetencyLevel: 3 });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s1", staffId: "staff-2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", s1], ["staff-2", s2]]),
      assignments: [a1, a2],
    });
    const violations = skillMixRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].penaltyScore).toBe(0.3);
  });

  it("does not flag single-staff shifts (not enough to assess mix)", () => {
    const shift = makeShift({ id: "s1" });
    const s1 = makeStaff({ id: "staff-1", icuCompetencyLevel: 3 });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", s1]]),
      assignments: [a1],
    });
    expect(skillMixRule.evaluate(ctx)).toHaveLength(0);
  });
});

// ─── charge-clustering ────────────────────────────────────────────────────────
describe("charge-clustering rule", () => {
  it("passes when charge nurses are evenly distributed", () => {
    const s1 = makeShift({ id: "s1", date: "2026-02-10" });
    const s2 = makeShift({ id: "s2", date: "2026-02-11" });
    const charge1 = makeStaff({ id: "c1", isChargeNurseQualified: true });
    const charge2 = makeStaff({ id: "c2", isChargeNurseQualified: true });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "c1" });
    const a2 = makeAssignment({ id: "a2", shiftId: "s2", staffId: "c2" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", s1], ["s2", s2]]),
      staffMap: new Map([["c1", charge1], ["c2", charge2]]),
      assignments: [a1, a2],
    });
    expect(chargeClusteringRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags when too many charge nurses are clustered on one shift", () => {
    // 4 shifts, 5 charge nurses all on shift 1 → excessive clustering
    const shifts = Array.from({ length: 4 }, (_, i) =>
      makeShift({ id: `s${i}`, date: `2026-02-${10 + i}` })
    );
    const chargeStaff = Array.from({ length: 5 }, (_, i) =>
      makeStaff({ id: `c${i}`, isChargeNurseQualified: true })
    );
    // All 5 charge nurses on shift 0
    const assignments = chargeStaff.map((s, i) =>
      makeAssignment({ id: `a${i}`, shiftId: "s0", staffId: s.id })
    );
    const ctx = makeContext({
      shiftMap: new Map(shifts.map(s => [s.id, s])),
      staffMap: new Map(chargeStaff.map(s => [s.id, s])),
      assignments,
    });
    // Average = 5/4 = 1.25. Threshold = max(1.25+1, 2) = 2.25 → ceiling 3
    // Shift 0 has 5 > 3 → violation
    const violations = chargeClusteringRule.evaluate(ctx);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe("charge-clustering");
  });

  it("returns empty when no charge nurses assigned", () => {
    const shift = makeShift({ id: "s1" });
    const staff = makeStaff({ id: "staff-1", isChargeNurseQualified: false });
    const a1 = makeAssignment({ id: "a1", shiftId: "s1", staffId: "staff-1" });
    const ctx = makeContext({
      shiftMap: new Map([["s1", shift]]),
      staffMap: new Map([["staff-1", staff]]),
      assignments: [a1],
    });
    expect(chargeClusteringRule.evaluate(ctx)).toHaveLength(0);
  });
});

// ─── preference-match ─────────────────────────────────────────────────────────
describe("preference-match rule", () => {
  it("passes when staff has no preferences set", () => {
    const staff = makeStaff({ id: "staff-1", preferences: null });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftType: "night" });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(preferenceMatchRule.evaluate(ctx)).toHaveLength(0);
  });

  it("passes when staff prefers 'any' shift type", () => {
    const staff = makeStaff({
      id: "staff-1",
      preferences: { preferredShift: "any", maxHoursPerWeek: 40, maxConsecutiveDays: 3, preferredDaysOff: [], avoidWeekends: false },
    });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftType: "night", date: "2026-02-10" });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(preferenceMatchRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags when assigned to wrong shift type (penalty 0.5)", () => {
    const staff = makeStaff({
      id: "staff-1",
      preferences: { preferredShift: "day", maxHoursPerWeek: 40, maxConsecutiveDays: 3, preferredDaysOff: [], avoidWeekends: false },
    });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftType: "night", date: "2026-02-10" });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = preferenceMatchRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].penaltyScore).toBe(0.5);
    expect(violations[0].description).toContain("prefers day");
  });

  it("flags when scheduled on a preferred day off (penalty 0.7)", () => {
    const staff = makeStaff({
      id: "staff-1",
      preferences: { preferredShift: "any", maxHoursPerWeek: 40, maxConsecutiveDays: 3, preferredDaysOff: ["Tuesday"], avoidWeekends: false },
    });
    // 2026-02-10 is a Tuesday
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftType: "day", date: "2026-02-10" });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = preferenceMatchRule.evaluate(ctx);
    expect(violations.some(v => v.penaltyScore === 0.7)).toBe(true);
  });

  it("flags weekend assignment when avoidWeekends is true (penalty 0.6)", () => {
    const staff = makeStaff({
      id: "staff-1",
      preferences: { preferredShift: "any", maxHoursPerWeek: 40, maxConsecutiveDays: 3, preferredDaysOff: [], avoidWeekends: true },
    });
    // 2026-02-14 is Saturday
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", shiftType: "day", date: "2026-02-14" });
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = preferenceMatchRule.evaluate(ctx);
    expect(violations.some(v => v.penaltyScore === 0.6 && v.description.includes("no weekends"))).toBe(true);
  });
});

// ─── weekend-fairness ─────────────────────────────────────────────────────────
describe("weekend-fairness rule", () => {
  it("returns empty when only one staff member is active", () => {
    const staff = makeStaff({ id: "staff-1" });
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", date: "2026-02-14" }); // Saturday
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(weekendFairnessRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags staff significantly above average weekend count when stdDev > 1", () => {
    const staff1 = makeStaff({ id: "s1", firstName: "Alice", lastName: "A" });
    const staff2 = makeStaff({ id: "s2", firstName: "Bob", lastName: "B" });
    const staff3 = makeStaff({ id: "s3", firstName: "Carol", lastName: "C" });

    // The algorithm only counts staff who have assignments (uses activeStaff set from assignments).
    // Alice works 6 weekend shifts; Bob and Carol each work 1 weekday shift (no weekend).
    // weekendCounts: Alice=6, Bob=0, Carol=0
    // Mean = 2, variance = ((6-2)²+(0-2)²+(0-2)²)/3 = (16+4+4)/3 ≈ 8, stdDev ≈ 2.83 > 1
    // Alice = 6 > 2 + 2.83 ≈ 4.83 → flagged
    const aliceWeekends = ["2026-02-07", "2026-02-08", "2026-02-14", "2026-02-15", "2026-02-21", "2026-02-22"];
    const assignments = [
      ...aliceWeekends.map((date, i) => makeAssignment({ id: `a${i}`, staffId: "s1", date })),
      makeAssignment({ id: "b1", staffId: "s2", date: "2026-02-10" }), // weekday
      makeAssignment({ id: "c1", staffId: "s3", date: "2026-02-10" }), // weekday
    ];
    const ctx = makeContext({
      assignments,
      staffMap: new Map([["s1", staff1], ["s2", staff2], ["s3", staff3]]),
    });
    const violations = weekendFairnessRule.evaluate(ctx);
    expect(violations.some(v => v.staffId === "s1")).toBe(true);
  });

  it("does not flag when distribution is equal", () => {
    const staff1 = makeStaff({ id: "s1" });
    const staff2 = makeStaff({ id: "s2" });
    // Each works exactly 2 weekends
    const a1 = makeAssignment({ id: "a1", staffId: "s1", date: "2026-02-07" }); // Sat
    const a2 = makeAssignment({ id: "a2", staffId: "s1", date: "2026-02-08" }); // Sun
    const a3 = makeAssignment({ id: "a3", staffId: "s2", date: "2026-02-07" }); // Sat
    const a4 = makeAssignment({ id: "a4", staffId: "s2", date: "2026-02-08" }); // Sun
    const ctx = makeContext({
      assignments: [a1, a2, a3, a4],
      staffMap: new Map([["s1", staff1], ["s2", staff2]]),
    });
    expect(weekendFairnessRule.evaluate(ctx)).toHaveLength(0);
  });
});

// ─── weekend-count ────────────────────────────────────────────────────────────
describe("weekend-count rule", () => {
  it("does not flag staff below required weekend count (shortfall is not a violation)", () => {
    const staff = makeStaff({ id: "staff-1", isActive: true, weekendExempt: false });
    // Staff works only 1 weekend shift (required 3) — the rule flags EXCESS weekends, not shortfall
    const a1 = makeAssignment({ id: "a1", staffId: "staff-1", date: "2026-02-07" }); // Saturday
    const ctx = makeContext({
      assignments: [a1],
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(weekendCountRule.evaluate(ctx)).toHaveLength(0);
  });

  it("passes when staff meets required weekend count (3)", () => {
    const staff = makeStaff({ id: "staff-1", isActive: true, weekendExempt: false });
    const weekendDates = ["2026-02-07", "2026-02-14", "2026-02-21"];
    const assignments = weekendDates.map((d, i) => makeAssignment({ id: `a${i}`, staffId: "staff-1", date: d }));
    const ctx = makeContext({
      assignments,
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(weekendCountRule.evaluate(ctx)).toHaveLength(0);
  });

  it("ignores weekend-exempt staff", () => {
    const staff = makeStaff({ id: "staff-1", isActive: true, weekendExempt: true });
    const ctx = makeContext({
      assignments: [],
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(weekendCountRule.evaluate(ctx)).toHaveLength(0);
  });

  it("ignores inactive staff", () => {
    const staff = makeStaff({ id: "staff-1", isActive: false, weekendExempt: false });
    const ctx = makeContext({
      assignments: [],
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(weekendCountRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags each excess weekend shift with flat 0.5 penalty", () => {
    const staff = makeStaff({ id: "staff-1", isActive: true, weekendExempt: false });
    // 5 weekend shifts (required 3) → 2 excess → 2 violations, each penaltyScore=0.5
    const weekendDates = ["2026-02-07", "2026-02-14", "2026-02-21", "2026-02-28", "2026-03-07"];
    const assignments = weekendDates.map((d, i) => makeAssignment({ id: `a${i}`, staffId: "staff-1", date: d }));
    const ctx = makeContext({
      assignments,
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = weekendCountRule.evaluate(ctx);
    expect(violations).toHaveLength(2);
    expect(violations.every(v => v.penaltyScore === 0.5)).toBe(true);
  });
});

// ─── consecutive-weekends ─────────────────────────────────────────────────────
describe("consecutive-weekends rule", () => {
  it("passes when consecutive weekends are within limit (max 2)", () => {
    const staff = makeStaff({ id: "staff-1" });
    // Works 2 consecutive weekends (Feb 7-8 and Feb 14-15)
    const dates = ["2026-02-07", "2026-02-08", "2026-02-14", "2026-02-15"];
    const assignments = dates.map((d, i) => makeAssignment({ id: `a${i}`, staffId: "staff-1", date: d }));
    const ctx = makeContext({
      assignments,
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(consecutiveWeekendRule.evaluate(ctx)).toHaveLength(0);
  });

  it("flags 3 consecutive weekends (exceeds max of 2)", () => {
    const staff = makeStaff({ id: "staff-1" });
    // Works 3 consecutive weekends
    const dates = ["2026-02-07", "2026-02-14", "2026-02-21"];
    const assignments = dates.map((d, i) => makeAssignment({ id: `a${i}`, staffId: "staff-1", date: d }));
    const ctx = makeContext({
      assignments,
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = consecutiveWeekendRule.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("consecutive-weekends");
    expect(violations[0].description).toContain("3 consecutive weekends");
    expect(violations[0].penaltyScore).toBe(0.8); // excess=1, 1*0.8
  });

  it("does not flag non-consecutive weekends", () => {
    const staff = makeStaff({ id: "staff-1" });
    // Works weekend, skips one, works again (not consecutive)
    const dates = ["2026-02-07", "2026-02-21"]; // Skip Feb 14 weekend
    const assignments = dates.map((d, i) => makeAssignment({ id: `a${i}`, staffId: "staff-1", date: d }));
    const ctx = makeContext({
      assignments,
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(consecutiveWeekendRule.evaluate(ctx)).toHaveLength(0);
  });
});
