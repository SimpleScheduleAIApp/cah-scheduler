import { describe, it, expect, beforeEach } from "vitest";
import { softPenalty } from "@/lib/engine/scheduler/scoring";
import { SchedulerState } from "@/lib/engine/scheduler/state";
import { BALANCED, FAIR, COST_OPTIMIZED } from "@/lib/engine/scheduler/weight-profiles";
import type { StaffInfo, ShiftInfo, UnitConfig } from "@/lib/engine/rules/types";
import type { AssignmentDraft } from "@/lib/engine/scheduler/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeStaff(overrides: Partial<StaffInfo> = {}): StaffInfo {
  return {
    id: "staff-1",
    firstName: "Alice",
    lastName: "Smith",
    role: "RN",
    employmentType: "full_time",
    icuCompetencyLevel: 3,
    isChargeNurseQualified: false,
    certifications: [],
    fte: 1.0,
    reliabilityRating: 4,
    homeUnit: "Med-Surg",
    crossTrainedUnits: [],
    weekendExempt: false,
    isActive: true,
    preferences: null,
    ...overrides,
  };
}

function makeShift(overrides: Partial<ShiftInfo> = {}): ShiftInfo {
  return {
    id: "shift-1",
    date: "2026-02-09", // Monday
    shiftType: "day",
    startTime: "07:00",
    endTime: "19:00",
    durationHours: 12,
    requiredStaffCount: 3,
    requiresChargeNurse: false,
    actualCensus: null,
    unit: "Med-Surg",
    countsTowardStaffing: true,
    acuityLevel: null,
    acuityExtraStaff: 0,
    sitterCount: 0,
    ...overrides,
  };
}

const defaultUnitConfig: UnitConfig = {
  id: "unit-1",
  name: "Med-Surg",
  weekendRuleType: "count_per_period",
  weekendShiftsRequired: 3,
  schedulePeriodWeeks: 6,
  holidayShiftsRequired: 1,
  maxOnCallPerWeek: 1,
  maxOnCallWeekendsPerMonth: 1,
  maxConsecutiveWeekends: 2,
  acuityYellowExtraStaff: 1,
  acuityRedExtraStaff: 2,
};

function makeDraft(overrides: Partial<AssignmentDraft> = {}): AssignmentDraft {
  return {
    shiftId: "shift-1",
    staffId: "staff-2",
    date: "2026-02-09",
    shiftType: "day",
    startTime: "07:00",
    endTime: "19:00",
    durationHours: 12,
    unit: "Med-Surg",
    isChargeNurse: false,
    isOvertime: false,
    isFloat: false,
    floatFromUnit: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("softPenalty", () => {
  let state: SchedulerState;
  let staffMap: Map<string, StaffInfo>;

  beforeEach(() => {
    state = new SchedulerState();
    staffMap = new Map([["staff-1", makeStaff()]]);
  });

  // Baseline: no positive penalties → only the capacity-spreading bonus applies,
  // producing a small negative incentive. With BALANCED overtime=1.5 and 0 prior hours:
  //   penalty -= 1.5 × 0.1 × (40/40) = −0.15
  it("returns a small negative (capacity-spreading incentive) for a clean assignment with no prior hours", () => {
    const p = softPenalty(makeStaff(), makeShift(), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeCloseTo(-0.15, 5);
  });

  // ── Overtime ────────────────────────────────────────────────────────────────

  it("adds overtime penalty when shift would push staff above 40h/week", () => {
    // Staff already has 36h this week
    ["2026-02-09", "2026-02-10", "2026-02-11"].forEach((d, i) =>
      state.addAssignment(makeDraft({ staffId: "staff-1", date: d, durationHours: 12, shiftId: `sh${i}` }))
    );
    // 3 × 12 = 36h. Adding another 12h → 48h → 8h overtime
    const p = softPenalty(makeStaff(), makeShift({ date: "2026-02-12" }), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  it("COST_OPTIMIZED has higher overtime penalty than BALANCED", () => {
    ["2026-02-09", "2026-02-10", "2026-02-11"].forEach((d, i) =>
      state.addAssignment(makeDraft({ staffId: "staff-1", date: d, durationHours: 12, shiftId: `sh${i}` }))
    );
    const shift = makeShift({ date: "2026-02-12" });
    const balanced = softPenalty(makeStaff(), shift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    const cost = softPenalty(makeStaff(), shift, state, COST_OPTIMIZED, [], staffMap, false, defaultUnitConfig);
    expect(cost).toBeGreaterThan(balanced);
  });

  it("FAIR has lower overtime penalty than BALANCED", () => {
    ["2026-02-09", "2026-02-10", "2026-02-11"].forEach((d, i) =>
      state.addAssignment(makeDraft({ staffId: "staff-1", date: d, durationHours: 12, shiftId: `sh${i}` }))
    );
    const shift = makeShift({ date: "2026-02-12" });
    const balanced = softPenalty(makeStaff(), shift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    const fair = softPenalty(makeStaff(), shift, state, FAIR, [], staffMap, false, defaultUnitConfig);
    expect(fair).toBeLessThan(balanced);
  });

  // ── Preference mismatch ──────────────────────────────────────────────────────

  it("adds penalty for shift-type mismatch", () => {
    const staff = makeStaff({
      preferences: { preferredShift: "night", preferredDaysOff: [], avoidWeekends: false, maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
    });
    const p = softPenalty(staff, makeShift({ shiftType: "day" }), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  it("adds penalty for preferred day-off", () => {
    const staff = makeStaff({
      preferences: { preferredShift: "any", preferredDaysOff: ["Monday"], avoidWeekends: false, maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
    });
    // 2026-02-09 is Monday
    const p = softPenalty(staff, makeShift({ date: "2026-02-09" }), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  it("adds penalty for weekend-avoidance on weekend shift", () => {
    const staff = makeStaff({
      preferences: { preferredShift: "any", preferredDaysOff: [], avoidWeekends: true, maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
    });
    // 2026-02-14 is Saturday
    const p = softPenalty(staff, makeShift({ date: "2026-02-14" }), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  it("FAIR weight raises preference penalty more than BALANCED", () => {
    const staff = makeStaff({
      preferences: { preferredShift: "night", preferredDaysOff: [], avoidWeekends: false, maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
    });
    const shift = makeShift({ shiftType: "day" });
    const balanced = softPenalty(staff, shift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    const fair = softPenalty(staff, shift, state, FAIR, [], staffMap, false, defaultUnitConfig);
    expect(fair).toBeGreaterThan(balanced);
  });

  // ── Weekend count incentive ──────────────────────────────────────────────────

  it("gives a negative (incentive) penalty for weekend shift when staff is below quota", () => {
    // weekendShiftsRequired=3, staff has 0 weekends so far
    // 2026-02-14 = Saturday
    const p = softPenalty(makeStaff(), makeShift({ date: "2026-02-14" }), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeLessThan(0);
  });

  it("does not give weekend incentive for weekend-exempt staff", () => {
    const staff = makeStaff({ weekendExempt: true });
    const p = softPenalty(staff, makeShift({ date: "2026-02-14" }), state, BALANCED, [], staffMap, false, defaultUnitConfig);
    // Weekend incentive is skipped for exempt staff, but capacity-spreading bonus still applies:
    //   penalty -= 1.5 × 0.1 × (40/40) = −0.15
    expect(p).toBeCloseTo(-0.15, 5);
  });

  // ── Float penalty ────────────────────────────────────────────────────────────

  it("adds float penalty when staff is assigned outside home unit", () => {
    const staff = makeStaff({ homeUnit: "Med-Surg", crossTrainedUnits: [] });
    const icuShift = makeShift({ unit: "ICU" });
    const p = softPenalty(staff, icuShift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  it("adds a lower float penalty for cross-trained staff", () => {
    const uncrossed = makeStaff({ homeUnit: "Med-Surg", crossTrainedUnits: [] });
    const crossed = makeStaff({ homeUnit: "Med-Surg", crossTrainedUnits: ["ICU"] });
    const icuShift = makeShift({ unit: "ICU" });
    const pUncrossed = softPenalty(uncrossed, icuShift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    const pCrossed = softPenalty(crossed, icuShift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    expect(pCrossed).toBeLessThan(pUncrossed);
  });

  it("COST_OPTIMIZED has higher float penalty than BALANCED", () => {
    const staff = makeStaff({ homeUnit: "Med-Surg", crossTrainedUnits: [] });
    const icuShift = makeShift({ unit: "ICU" });
    const balanced = softPenalty(staff, icuShift, state, BALANCED, [], staffMap, false, defaultUnitConfig);
    const cost = softPenalty(staff, icuShift, state, COST_OPTIMIZED, [], staffMap, false, defaultUnitConfig);
    expect(cost).toBeGreaterThan(balanced);
  });

  // ── Skill mix ────────────────────────────────────────────────────────────────

  it("adds skill-mix penalty when all staff on shift have the same competency level", () => {
    // Two staff already on the shift at level 3
    const existing: AssignmentDraft[] = [
      makeDraft({ staffId: "staff-2", shiftId: "shift-1" }),
      makeDraft({ staffId: "staff-3", shiftId: "shift-1" }),
    ];
    const level3staff2 = makeStaff({ id: "staff-2", icuCompetencyLevel: 3 });
    const level3staff3 = makeStaff({ id: "staff-3", icuCompetencyLevel: 3 });
    const localMap = new Map<string, StaffInfo>([["staff-2", level3staff2], ["staff-3", level3staff3]]);
    // Adding staff-1 also level 3 → all same → penalty
    const p = softPenalty(makeStaff({ icuCompetencyLevel: 3 }), makeShift(), state, BALANCED, existing, localMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  // ── Competency pairing incentive ─────────────────────────────────────────────

  it("gives negative penalty (incentive) when Level 5 added to shift with Level 1", () => {
    const level1draft = makeDraft({ staffId: "staff-2" });
    const level1staff = makeStaff({ id: "staff-2", icuCompetencyLevel: 1 });
    const localMap = new Map<string, StaffInfo>([["staff-2", level1staff]]);
    const p = softPenalty(makeStaff({ icuCompetencyLevel: 5 }), makeShift(), state, BALANCED, [level1draft], localMap, false, defaultUnitConfig);
    expect(p).toBeLessThan(0);
  });

  // ── Charge clustering ─────────────────────────────────────────────────────────

  it("adds charge-clustering penalty when extra charge-qualified nurse added non-as-charge", () => {
    // Shift already has a charge nurse assigned
    const chargeDraft = makeDraft({ staffId: "staff-2", isChargeNurse: true });
    const chargeStaff = makeStaff({ id: "staff-2", isChargeNurseQualified: true });
    const localMap = new Map<string, StaffInfo>([["staff-2", chargeStaff]]);
    // Staff-1 is charge-qualified but we're NOT assigning them as charge (isChargeCandidate=false)
    const p = softPenalty(makeStaff({ isChargeNurseQualified: true }), makeShift(), state, BALANCED, [chargeDraft], localMap, false, defaultUnitConfig);
    expect(p).toBeGreaterThan(0);
  });

  it("does not penalise charge clustering when assigning as charge candidate", () => {
    const chargeDraft = makeDraft({ staffId: "staff-2", isChargeNurse: true });
    const chargeStaff = makeStaff({ id: "staff-2", isChargeNurseQualified: true });
    const localMap = new Map<string, StaffInfo>([["staff-2", chargeStaff]]);
    // isChargeCandidate=true: we are filling the charge role
    const p = softPenalty(makeStaff({ isChargeNurseQualified: true }), makeShift(), state, BALANCED, [chargeDraft], localMap, true, defaultUnitConfig);
    // Should not include charge clustering penalty (may still be 0 or negative from other incentives)
    // Just verify it's ≤ the non-charge version
    const pNoCharge = softPenalty(makeStaff({ isChargeNurseQualified: true }), makeShift(), state, BALANCED, [chargeDraft], localMap, false, defaultUnitConfig);
    expect(p).toBeLessThanOrEqual(pNoCharge);
  });
});
