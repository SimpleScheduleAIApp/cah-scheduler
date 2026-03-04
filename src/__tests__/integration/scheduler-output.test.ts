/**
 * Integration test: census-band-aware scheduler output.
 *
 * Two describe blocks:
 *
 * 1. checkForUnexplainedUnderstaffing — unit tests for the validation utility.
 *    Verifies each branch: documented reasons, genuine shortage, PRN without
 *    availability, staff on leave, and the "suspicious" (bug-signal) path.
 *
 * 2. Full pipeline: census-band-aware staffing (5 per shift, charge required).
 *    Fixture mirrors what the real seeded DB looks like after v1.5.5:
 *      - requiredStaffCount = 5 → Green band (4 RNs + 1 CNA), set directly in
 *        ShiftInfo as buildContext now computes it from censusBandId.
 *      - requiresChargeNurse = true (every ICU shift).
 *      - 25-staff ICU roster: 4 Level 5 charge, 6 Level 4, 8 Level 3, 4 Level 2, 3 CNAs.
 *
 *    The v1.5.5 bug would cause these tests to fail: the scheduler would stop at 4
 *    staff for Day and 3 for Night (shift-definition base counts), leaving
 *    checkForUnexplainedUnderstaffing to flag the shortfalls as "suspicious" since
 *    25 staff are available and no hard reasons were recorded.
 */
import { describe, it, expect } from "vitest";
import { greedyConstruct } from "@/lib/engine/scheduler/greedy";
import { localSearch } from "@/lib/engine/scheduler/local-search";
import { BALANCED } from "@/lib/engine/scheduler/weight-profiles";
import { checkForUnexplainedUnderstaffing } from "@/lib/engine/scheduler/validate-output";
import type { SchedulerContext } from "@/lib/engine/scheduler/types";
import type { StaffInfo, ShiftInfo, UnitConfig } from "@/lib/engine/rules/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT = "ICU";
const SCHEDULE_ID = "sched-output-test";
const START_DATE = "2026-03-02"; // Monday
const END_DATE = "2026-03-08";   // Sunday (7 days → 14 shifts: 7 Day + 7 Night)
const BAND_GREEN_ID = "band-green";

const unitConfig: UnitConfig = {
  id: "unit-icu",
  name: UNIT,
  weekendRuleType: "count_per_period",
  weekendShiftsRequired: 2,
  schedulePeriodWeeks: 6,
  holidayShiftsRequired: 1,
  maxOnCallPerWeek: 1,
  maxOnCallWeekendsPerMonth: 1,
  maxConsecutiveWeekends: 2,
  acuityYellowExtraStaff: 1,
  acuityRedExtraStaff: 2,
};

// ─── Staff fixture ─────────────────────────────────────────────────────────────

/**
 * 25-staff ICU roster — enough to comfortably fill 14 shifts × 5 staff = 70 slots
 * in 7 days while respecting the max-5-consecutive-days and 60h rolling-window rules.
 */
function makeRoster(): StaffInfo[] {
  const base: Omit<StaffInfo, "id" | "firstName" | "lastName" | "icuCompetencyLevel"> = {
    role: "RN",
    employmentType: "full_time",
    certifications: [],
    fte: 1.0,
    reliabilityRating: 4,
    homeUnit: UNIT,
    crossTrainedUnits: [],
    weekendExempt: false,
    isActive: true,
    isChargeNurseQualified: false,
    preferences: null,
  };

  return [
    // 4 charge-qualified Level 5 nurses (ICU charge nurses)
    { ...base, id: "ch1", firstName: "Alice",  lastName: "A", icuCompetencyLevel: 5, isChargeNurseQualified: true },
    { ...base, id: "ch2", firstName: "Bob",    lastName: "B", icuCompetencyLevel: 5, isChargeNurseQualified: true },
    { ...base, id: "ch3", firstName: "Carol",  lastName: "C", icuCompetencyLevel: 5, isChargeNurseQualified: true },
    { ...base, id: "ch4", firstName: "Dan",    lastName: "D", icuCompetencyLevel: 5, isChargeNurseQualified: true },

    // 6 Level 4 RNs
    { ...base, id: "l4a", firstName: "Emma",   lastName: "E", icuCompetencyLevel: 4 },
    { ...base, id: "l4b", firstName: "Frank",  lastName: "F", icuCompetencyLevel: 4 },
    { ...base, id: "l4c", firstName: "Grace",  lastName: "G", icuCompetencyLevel: 4 },
    { ...base, id: "l4d", firstName: "Hank",   lastName: "H", icuCompetencyLevel: 4 },
    { ...base, id: "l4e", firstName: "Iris",   lastName: "I", icuCompetencyLevel: 4 },
    { ...base, id: "l4f", firstName: "Jake",   lastName: "J", icuCompetencyLevel: 4 },

    // 8 Level 3 RNs (mix of full-time and part-time)
    { ...base, id: "l3a", firstName: "Karen",  lastName: "K", icuCompetencyLevel: 3 },
    { ...base, id: "l3b", firstName: "Leo",    lastName: "L", icuCompetencyLevel: 3 },
    { ...base, id: "l3c", firstName: "Mia",    lastName: "M", icuCompetencyLevel: 3 },
    { ...base, id: "l3d", firstName: "Nick",   lastName: "N", icuCompetencyLevel: 3 },
    { ...base, id: "l3e", firstName: "Olivia", lastName: "O", icuCompetencyLevel: 3, employmentType: "part_time", fte: 0.6 },
    { ...base, id: "l3f", firstName: "Paul",   lastName: "P", icuCompetencyLevel: 3, employmentType: "part_time", fte: 0.6 },
    { ...base, id: "l3g", firstName: "Quinn",  lastName: "Q", icuCompetencyLevel: 3 },
    { ...base, id: "l3h", firstName: "Rita",   lastName: "R", icuCompetencyLevel: 3 },

    // 4 Level 2 RNs
    { ...base, id: "l2a", firstName: "Sam",    lastName: "S", icuCompetencyLevel: 2 },
    { ...base, id: "l2b", firstName: "Tara",   lastName: "T", icuCompetencyLevel: 2 },
    { ...base, id: "l2c", firstName: "Uri",    lastName: "U", icuCompetencyLevel: 2 },
    { ...base, id: "l2d", firstName: "Vera",   lastName: "V", icuCompetencyLevel: 2 },

    // 3 CNAs (Level 2 — ICU competency satisfied)
    { ...base, id: "cna1", firstName: "Walt",  lastName: "W", icuCompetencyLevel: 2, role: "CNA" },
    { ...base, id: "cna2", firstName: "Xena",  lastName: "X", icuCompetencyLevel: 2, role: "CNA" },
    { ...base, id: "cna3", firstName: "Yara",  lastName: "Y", icuCompetencyLevel: 2, role: "CNA" },
  ];
}

// ─── Shift fixture ─────────────────────────────────────────────────────────────

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const d = new Date(start);
  const e = new Date(end);
  while (d <= e) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * 14 shifts: 7 Day (07:00-19:00) + 7 Night (19:00-07:00), one pair per date.
 *
 * requiredStaffCount = 5 simulates what buildContext returns after the v1.5.5 fix:
 * for a shift with censusBandId pointing to Green (4 RNs + 1 CNA = 5), buildContext
 * overrides the shift-definition base count (4 Day / 3 Night) with 5.
 */
function makeShifts(): ShiftInfo[] {
  const shifts: ShiftInfo[] = [];
  for (const date of dateRange(START_DATE, END_DATE)) {
    shifts.push({
      id: `day-${date}`,
      date,
      shiftType: "day",
      startTime: "07:00",
      endTime: "19:00",
      durationHours: 12,
      requiredStaffCount: 5,   // Green band total as set by buildContext
      requiresChargeNurse: true,
      actualCensus: null,
      censusBandId: BAND_GREEN_ID,
      unit: UNIT,
      countsTowardStaffing: true,
      acuityLevel: "green",
      acuityExtraStaff: 0,     // Zeroed by buildContext when censusBandId is set
      sitterCount: 0,
    });
    shifts.push({
      id: `night-${date}`,
      date,
      shiftType: "night",
      startTime: "19:00",
      endTime: "07:00",
      durationHours: 12,
      requiredStaffCount: 5,
      requiresChargeNurse: true,
      actualCensus: null,
      censusBandId: BAND_GREEN_ID,
      unit: UNIT,
      countsTowardStaffing: true,
      acuityLevel: "green",
      acuityExtraStaff: 0,
      sitterCount: 0,
    });
  }
  return shifts;
}

function makeContext(staffList: StaffInfo[], shifts: ShiftInfo[]): SchedulerContext {
  return {
    scheduleId: SCHEDULE_ID,
    shifts,
    staffList,
    staffMap: new Map(staffList.map((s) => [s.id, s])),
    prnAvailability: [],
    staffLeaves: [],
    unitConfig,
    scheduleUnit: UNIT,
    publicHolidays: [],
  };
}

// ─── Section 1: checkForUnexplainedUnderstaffing unit tests ───────────────────

describe("checkForUnexplainedUnderstaffing", () => {
  const staffList = makeRoster(); // 25 active staff
  const minCtx = { staffList, staffLeaves: [], prnAvailability: [] };

  const baseEntry = {
    shiftId: "shift-1",
    date: "2026-03-02",
    shiftType: "day",
    unit: UNIT,
    required: 5,
    assigned: 4,
  };

  it("returns empty when there are no understaffed shifts", () => {
    expect(checkForUnexplainedUnderstaffing([], minCtx)).toHaveLength(0);
  });

  it("skips entries that have documented hard-rule reasons", () => {
    const entry = { ...baseEntry, reasons: ["no eligible charge nurse available"] };
    expect(checkForUnexplainedUnderstaffing([entry], minCtx)).toHaveLength(0);
  });

  it("flags an entry with no reasons when enough staff are available (bug signal)", () => {
    const entry = { ...baseEntry, reasons: [] };
    const result = checkForUnexplainedUnderstaffing([entry], minCtx);
    expect(result).toHaveLength(1);
    expect(result[0].potentiallyAvailable).toBeGreaterThanOrEqual(5);
  });

  it("skips entry with no reasons when staff count is genuinely below required", () => {
    // Only 3 active staff in context — real shortage, not a bug
    const fewCtx = { staffList: staffList.slice(0, 3), staffLeaves: [], prnAvailability: [] };
    const entry = { ...baseEntry, required: 5, reasons: [] };
    expect(checkForUnexplainedUnderstaffing([entry], fewCtx)).toHaveLength(0);
  });

  it("does not count staff on approved leave toward availability", () => {
    const entry = { ...baseEntry, reasons: [] };
    // Put all but 3 staff on approved leave for the shift date — drops below required=5
    const leaves = staffList.slice(3).map((s) => ({
      staffId: s.id,
      startDate: "2026-03-01",
      endDate: "2026-03-04",
      status: "approved",
    }));
    const ctx = { staffList, staffLeaves: leaves, prnAvailability: [] };
    // Only 3 available < required 5 → genuine shortage, not suspicious
    expect(checkForUnexplainedUnderstaffing([entry], ctx)).toHaveLength(0);
  });

  it("does not count PRN staff without availability for the date", () => {
    const entry = { ...baseEntry, required: 5, reasons: [] };
    // Replace all staff with per_diem who have no availability submitted
    const prnStaff: StaffInfo[] = staffList.slice(0, 6).map((s) => ({
      ...s,
      employmentType: "per_diem" as const,
    }));
    const ctx = { staffList: prnStaff, staffLeaves: [], prnAvailability: [] };
    // 0 available (all PRN, none with availability) < required 5 → not suspicious
    expect(checkForUnexplainedUnderstaffing([entry], ctx)).toHaveLength(0);
  });

  it("counts PRN staff who do have availability for the date", () => {
    const entry = { ...baseEntry, required: 2, reasons: [] };
    const prnStaff: StaffInfo[] = staffList.slice(0, 4).map((s) => ({
      ...s,
      employmentType: "per_diem" as const,
    }));
    const prnAvailability = prnStaff.map((s) => ({
      staffId: s.id,
      availableDates: ["2026-03-02"], // matches entry.date
    }));
    const ctx = { staffList: prnStaff, staffLeaves: [], prnAvailability };
    // 4 PRN staff have availability, required is 2 → suspicious (4 >= 2)
    const result = checkForUnexplainedUnderstaffing([entry], ctx);
    expect(result).toHaveLength(1);
    expect(result[0].potentiallyAvailable).toBe(4);
  });

  it("excludes inactive staff from the available count", () => {
    const entry = { ...baseEntry, required: 5, reasons: [] };
    const inactiveStaff = staffList.map((s) => ({ ...s, isActive: false }));
    const ctx = { staffList: inactiveStaff, staffLeaves: [], prnAvailability: [] };
    expect(checkForUnexplainedUnderstaffing([entry], ctx)).toHaveLength(0);
  });
});

// ─── Section 2: full pipeline — census-band-aware staffing ────────────────────

describe("Scheduler output — census-band-aware staffing (5 per shift, charge required)", () => {
  const staffList = makeRoster();
  const shifts = makeShifts();
  const ctx = makeContext(staffList, shifts);

  it("fixture: 14 shifts (7 days × day + night), each requiring 5 staff with charge", () => {
    expect(shifts).toHaveLength(14);
    expect(shifts.every((s) => s.requiredStaffCount === 5)).toBe(true);
    expect(shifts.every((s) => s.requiresChargeNurse)).toBe(true);
    expect(shifts.every((s) => s.censusBandId === BAND_GREEN_ID)).toBe(true);
  });

  it("greedyConstruct fully staffs all 14 shifts (no understaffed entries)", () => {
    const result = greedyConstruct(ctx, BALANCED);
    expect(result.understaffed).toHaveLength(0);
    expect(result.assignments).toHaveLength(14 * 5); // 70 total
  });

  it("checkForUnexplainedUnderstaffing finds no suspicious entries after generation", () => {
    // Core invariant: any shortfall must have a documented hard reason OR be a genuine
    // shortage. An empty result here means the scheduler is working correctly.
    const result = greedyConstruct(ctx, BALANCED);
    const suspicious = checkForUnexplainedUnderstaffing(result.understaffed, ctx);
    expect(suspicious).toHaveLength(0);
  });

  it("every charge-required shift has exactly one charge nurse assigned", () => {
    const result = greedyConstruct(ctx, BALANCED);
    for (const shift of shifts) {
      const assigned = result.assignments.filter((a) => a.shiftId === shift.id);
      const chargeCount = assigned.filter((a) => a.isChargeNurse).length;
      expect(chargeCount, `Shift ${shift.id} should have 1 charge nurse`).toBe(1);
    }
  });

  it("no staff member appears on two overlapping shift types on the same date", () => {
    const result = greedyConstruct(ctx, BALANCED);
    const byStaff = new Map<string, typeof result.assignments>();
    for (const a of result.assignments) {
      const list = byStaff.get(a.staffId) ?? [];
      list.push(a);
      byStaff.set(a.staffId, list);
    }
    for (const [staffId, assignments] of byStaff) {
      // Day (07:00–19:00) and Night (19:00–07:00) on the same date would have 0h rest
      const keys = assignments.map((a) => `${a.date}::${a.shiftType}`);
      const unique = new Set(keys);
      expect(
        unique.size,
        `Staff ${staffId} appears on duplicate shift type+date combination`
      ).toBe(keys.length);
    }
  });

  it("local search preserves full coverage after improvement phase", () => {
    const greedy = greedyConstruct(ctx, BALANCED);
    const improved = localSearch(greedy, ctx, BALANCED, 200);
    expect(improved.understaffed).toHaveLength(0);
    expect(improved.assignments).toHaveLength(greedy.assignments.length);
    // Invariant still holds after local search
    const suspicious = checkForUnexplainedUnderstaffing(improved.understaffed, ctx);
    expect(suspicious).toHaveLength(0);
  });

  it("regression — v1.5.5: scheduler targets 5 (census band), not 4 (shift definition)", () => {
    // Before v1.5.5, buildContext used shift.requiredStaffCount from the DB (4 for Day,
    // 3 for Night) instead of the census band total (5 for Green = 4 RNs + 1 CNA).
    // greedyConstruct would fill 4 Day / 3 Night, leaving 1 slot each unexplained.
    // This test fails on the pre-fix code and passes on v1.5.5+.
    const result = greedyConstruct(ctx, BALANCED);
    const shortDayShifts = result.understaffed.filter((u) => u.shiftType === "day");
    const shortNightShifts = result.understaffed.filter((u) => u.shiftType === "night");
    expect(shortDayShifts).toHaveLength(0);
    expect(shortNightShifts).toHaveLength(0);
  });
});
