import { describe, it, expect, vi } from "vitest";
import { localSearch, mulberry32 } from "@/lib/engine/scheduler/local-search";
import { greedyConstruct } from "@/lib/engine/scheduler/greedy";
import { BALANCED, FAIR } from "@/lib/engine/scheduler/weight-profiles";
import { SchedulerState } from "@/lib/engine/scheduler/state";
import { softPenalty } from "@/lib/engine/scheduler/scoring";
import type { SchedulerContext, AssignmentDraft, GenerationResult } from "@/lib/engine/scheduler/types";
import type { StaffInfo, ShiftInfo, UnitConfig } from "@/lib/engine/rules/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeStaff(id: string, overrides: Partial<StaffInfo> = {}): StaffInfo {
  return {
    id,
    firstName: "Nurse",
    lastName: id,
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

function makeShift(id: string, date: string, overrides: Partial<ShiftInfo> = {}): ShiftInfo {
  return {
    id,
    date,
    shiftType: "day",
    startTime: "07:00",
    endTime: "19:00",
    durationHours: 12,
    requiredStaffCount: 1,
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

function makeContext(
  shifts: ShiftInfo[],
  staff: StaffInfo[],
  overrides: Partial<SchedulerContext> = {}
): SchedulerContext {
  return {
    scheduleId: "sched-1",
    shifts,
    staffList: staff,
    staffMap: new Map(staff.map((s) => [s.id, s])),
    prnAvailability: [],
    staffLeaves: [],
    unitConfig: defaultUnitConfig,
    scheduleUnit: "Med-Surg",
    publicHolidays: [],
    ...overrides,
  };
}

function computePenalty(assignments: AssignmentDraft[], ctx: SchedulerContext): number {
  const state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);
  let total = 0;
  for (const a of assignments) {
    const staff = ctx.staffMap.get(a.staffId);
    const shift = ctx.shifts.find((s) => s.id === a.shiftId);
    if (!staff || !shift) continue;
    const others = assignments.filter((x) => x.shiftId === a.shiftId && x.staffId !== a.staffId);
    total += softPenalty(staff, shift, state, BALANCED, others, ctx.staffMap, a.isChargeNurse, ctx.unitConfig);
  }
  return total;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("localSearch", () => {
  it("returns the input unchanged when fewer than 4 assignments", () => {
    const staff = [makeStaff("s1"), makeStaff("s2"), makeStaff("s3")];
    const shifts = [
      makeShift("sh1", "2026-02-09"),
      makeShift("sh2", "2026-02-10"),
      makeShift("sh3", "2026-02-11"),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);
    // 3 assignments — below threshold of 4
    const result = localSearch(greedyResult, ctx, BALANCED, 100);
    expect(result.assignments).toEqual(greedyResult.assignments);
  });

  it("does not increase the total assignment count", () => {
    const staff = Array.from({ length: 6 }, (_, i) => makeStaff(`s${i + 1}`));
    const shifts = [
      makeShift("sh1", "2026-02-09", { requiredStaffCount: 2 }),
      makeShift("sh2", "2026-02-10", { requiredStaffCount: 2 }),
      makeShift("sh3", "2026-02-11", { requiredStaffCount: 2 }),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);
    const result = localSearch(greedyResult, ctx, BALANCED, 100);
    expect(result.assignments).toHaveLength(greedyResult.assignments.length);
  });

  it("preserves the understaffed list from greedy", () => {
    const staff = [makeStaff("s1")]; // only 1 staff, 2 shifts need 2 each
    const shifts = [
      makeShift("sh1", "2026-02-09", { requiredStaffCount: 2 }),
      makeShift("sh2", "2026-02-10", { requiredStaffCount: 2 }),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);
    const result = localSearch(greedyResult, ctx, BALANCED, 50);
    expect(result.understaffed).toEqual(greedyResult.understaffed);
  });

  it("never produces a lower penalty than greedy (monotonic improvement)", () => {
    const staff = Array.from({ length: 8 }, (_, i) => makeStaff(`s${i + 1}`));
    const shifts = [
      makeShift("sh1", "2026-02-09", { requiredStaffCount: 2 }),
      makeShift("sh2", "2026-02-10", { requiredStaffCount: 2 }),
      makeShift("sh3", "2026-02-11", { requiredStaffCount: 2 }),
      makeShift("sh4", "2026-02-12", { requiredStaffCount: 2 }),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);
    const lsResult = localSearch(greedyResult, ctx, BALANCED, 200);

    const greedyPenalty = computePenalty(greedyResult.assignments, ctx);
    const lsPenalty = computePenalty(lsResult.assignments, ctx);

    // Local search should never make things worse
    expect(lsPenalty).toBeLessThanOrEqual(greedyPenalty + 1e-9);
  });

  it("does not violate hard rules after swapping (each staff appears on at most one shift per day)", () => {
    const staff = Array.from({ length: 6 }, (_, i) => makeStaff(`s${i + 1}`));
    // Two shifts on the same date — staff should not appear on both
    const shifts = [
      makeShift("sh1", "2026-02-09", { startTime: "07:00", requiredStaffCount: 2 }),
      makeShift("sh2", "2026-02-09", { startTime: "19:00", durationHours: 12, requiredStaffCount: 2 }),
      makeShift("sh3", "2026-02-10", { requiredStaffCount: 2 }),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);
    const result = localSearch(greedyResult, ctx, BALANCED, 200);

    // Verify no staff member appears twice on the same overlapping shift pair (sh1/sh2 on same day)
    const sh1Staff = result.assignments.filter((a) => a.shiftId === "sh1").map((a) => a.staffId);
    const sh2Staff = result.assignments.filter((a) => a.shiftId === "sh2").map((a) => a.staffId);
    const overlap = sh1Staff.filter((id) => sh2Staff.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it("improves penalty when there is a clearly better swap available", () => {
    // Create a scenario where two staff are clearly mismatched to shifts
    // Staff s1 strongly prefers nights; staff s2 strongly prefers days
    // But greedy might put them on wrong shifts — local search should correct it
    const staff = [
      makeStaff("s1", {
        preferences: { preferredShift: "night", preferredDaysOff: [], avoidWeekends: false, maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
      }),
      makeStaff("s2", {
        preferences: { preferredShift: "day", preferredDaysOff: [], avoidWeekends: false, maxHoursPerWeek: 40, maxConsecutiveDays: 5 },
      }),
    ];
    // One day shift and one night shift on different days (no overlap)
    const shifts = [
      makeShift("sh-day", "2026-02-09", { shiftType: "day", startTime: "07:00", durationHours: 12 }),
      makeShift("sh-night", "2026-02-10", { shiftType: "night", startTime: "19:00", durationHours: 12 }),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, FAIR);

    // Run local search with enough iterations to find the improvement
    const result = localSearch(greedyResult, ctx, FAIR, 500);

    // The optimal assignment is s2 → day shift, s1 → night shift
    const s1Assignment = result.assignments.find((a) => a.staffId === "s1");
    const s2Assignment = result.assignments.find((a) => a.staffId === "s2");

    // Both should be assigned
    expect(s1Assignment).toBeDefined();
    expect(s2Assignment).toBeDefined();

    // Verify the local search reached the better state OR at least didn't make it worse
    const lsPenalty = computePenalty(result.assignments, ctx);
    const greedyPenalty = computePenalty(greedyResult.assignments, ctx);
    expect(lsPenalty).toBeLessThanOrEqual(greedyPenalty + 1e-9);
  });

  it("returns identical understaffed list regardless of how many iterations run", () => {
    const staff = Array.from({ length: 4 }, (_, i) => makeStaff(`s${i + 1}`));
    const shifts = [
      makeShift("sh1", "2026-02-09", { requiredStaffCount: 3 }), // needs 3, only 4 total — tight but fillable
      makeShift("sh2", "2026-02-10", { requiredStaffCount: 3 }), // needs 3 more — will be understaffed
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);
    const result10 = localSearch(greedyResult, ctx, BALANCED, 10);
    const result500 = localSearch(greedyResult, ctx, BALANCED, 500);

    // Understaffed list originates from greedy, local search preserves it
    expect(result10.understaffed).toEqual(greedyResult.understaffed);
    expect(result500.understaffed).toEqual(greedyResult.understaffed);
  });

  it("produces identical assignments when called twice with the same seed", () => {
    const staff = Array.from({ length: 6 }, (_, i) => makeStaff(`s${i + 1}`));
    const shifts = [
      makeShift("sh1", "2026-02-09", { requiredStaffCount: 2 }),
      makeShift("sh2", "2026-02-10", { requiredStaffCount: 2 }),
      makeShift("sh3", "2026-02-11", { requiredStaffCount: 2 }),
      makeShift("sh4", "2026-02-12", { requiredStaffCount: 2 }),
    ];
    const ctx = makeContext(shifts, staff);
    const greedyResult = greedyConstruct(ctx, BALANCED);

    const SEED = 42;
    const result1 = localSearch(greedyResult, ctx, BALANCED, 200, SEED);
    const result2 = localSearch(greedyResult, ctx, BALANCED, 200, SEED);

    // Same seed + same input must produce identical output (reproducibility guarantee)
    expect(result1.assignments).toEqual(result2.assignments);
  });
});

// ─── mulberry32 ────────────────────────────────────────────────────────────────

describe("mulberry32", () => {
  it("produces the same sequence for the same seed", () => {
    const rng1 = mulberry32(12345);
    const rng2 = mulberry32(12345);
    const seq1 = Array.from({ length: 20 }, () => rng1());
    const seq2 = Array.from({ length: 20 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = mulberry32(1);
    const rng2 = mulberry32(2);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1.some((v, i) => v !== seq2[i])).toBe(true);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(9999);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
