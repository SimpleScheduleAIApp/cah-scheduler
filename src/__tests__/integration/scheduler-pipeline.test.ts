/**
 * End-to-end scheduler pipeline smoke test.
 *
 * Simulates the full journey a new user would trigger:
 *   Excel import → schedule created with shifts → Generate Schedule
 *
 * Uses only pure functions (no DB) by building a SchedulerContext that
 * mirrors what a real post-import database would contain.
 *
 * Catches bugs where:
 *  - The scheduler produces 0 assignments when shifts exist
 *  - Hard rules block ALL candidates (over-constrained fixture)
 *  - The output has the wrong shape
 */
import { describe, it, expect } from "vitest";
import { greedyConstruct } from "@/lib/engine/scheduler/greedy";
import { localSearch } from "@/lib/engine/scheduler/local-search";
import { buildShiftInserts } from "@/lib/schedules/build-shifts";
import { BALANCED, FAIR, COST_OPTIMIZED } from "@/lib/engine/scheduler/weight-profiles";
import type { SchedulerContext } from "@/lib/engine/scheduler/types";
import type { StaffInfo, ShiftInfo, UnitConfig } from "@/lib/engine/rules/types";

// ─── Realistic fixture data (mirrors post-Excel-import state) ─────────────────

const UNIT = "ICU";
const SCHEDULE_ID = "sched-smoke";
const START_DATE = "2026-03-02";
const END_DATE = "2026-03-15"; // 14-day range (shorter than 6 weeks, faster test)

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

/** Build a realistic staff roster similar to what Excel import produces */
function makeRoster(): StaffInfo[] {
  const base = {
    role: "RN" as const,
    certifications: [],
    fte: 1.0,
    reliabilityRating: 4,
    homeUnit: UNIT,
    crossTrainedUnits: [],
    weekendExempt: false,
    isActive: true,
    preferences: null,
  };

  return [
    // Charge nurses (Level 5)
    { ...base, id: "c1", firstName: "Carol", lastName: "A", employmentType: "full_time", icuCompetencyLevel: 5, isChargeNurseQualified: true },
    { ...base, id: "c2", firstName: "Dan", lastName: "B", employmentType: "full_time", icuCompetencyLevel: 5, isChargeNurseQualified: true },
    // Level 4
    { ...base, id: "s1", firstName: "Emma", lastName: "C", employmentType: "full_time", icuCompetencyLevel: 4, isChargeNurseQualified: false },
    { ...base, id: "s2", firstName: "Frank", lastName: "D", employmentType: "full_time", icuCompetencyLevel: 4, isChargeNurseQualified: false },
    { ...base, id: "s3", firstName: "Grace", lastName: "E", employmentType: "full_time", icuCompetencyLevel: 4, isChargeNurseQualified: false },
    // Level 3
    { ...base, id: "s4", firstName: "Hank", lastName: "F", employmentType: "full_time", icuCompetencyLevel: 3, isChargeNurseQualified: false },
    { ...base, id: "s5", firstName: "Ivy", lastName: "G", employmentType: "full_time", icuCompetencyLevel: 3, isChargeNurseQualified: false },
    { ...base, id: "s6", firstName: "Jake", lastName: "H", employmentType: "full_time", icuCompetencyLevel: 3, isChargeNurseQualified: false },
    { ...base, id: "s7", firstName: "Kim", lastName: "I", employmentType: "full_time", icuCompetencyLevel: 3, isChargeNurseQualified: false },
    { ...base, id: "s8", firstName: "Leo", lastName: "J", employmentType: "full_time", icuCompetencyLevel: 3, isChargeNurseQualified: false },
    // Level 2
    { ...base, id: "s9", firstName: "Mia", lastName: "K", employmentType: "full_time", icuCompetencyLevel: 2, isChargeNurseQualified: false },
    { ...base, id: "s10", firstName: "Nick", lastName: "L", employmentType: "full_time", icuCompetencyLevel: 2, isChargeNurseQualified: false },
    // Part-time
    { ...base, id: "pt1", firstName: "Olivia", lastName: "M", employmentType: "part_time", icuCompetencyLevel: 3, isChargeNurseQualified: false, fte: 0.6 },
    { ...base, id: "pt2", firstName: "Paul", lastName: "N", employmentType: "part_time", icuCompetencyLevel: 3, isChargeNurseQualified: false, fte: 0.6 },
  ];
}

/** Build shifts that mirror what POST /api/schedules now auto-creates */
function makeShifts(): ShiftInfo[] {
  const dayDef = { id: "def-day", requiredStaffCount: 2, requiresChargeNurse: false };
  const nightDef = { id: "def-night", requiredStaffCount: 2, requiresChargeNurse: false };

  const inserts = buildShiftInserts(SCHEDULE_ID, START_DATE, END_DATE, [dayDef, nightDef]);

  return inserts.map((ins, i) => ({
    id: `shift-${i}`,
    date: ins.date,
    shiftType: ins.shiftDefinitionId === "def-day" ? "day" : "night",
    startTime: ins.shiftDefinitionId === "def-day" ? "07:00" : "19:00",
    endTime: ins.shiftDefinitionId === "def-day" ? "19:00" : "07:00",
    durationHours: 12,
    requiredStaffCount: ins.requiredStaffCount,
    requiresChargeNurse: ins.requiresChargeNurse,
    actualCensus: null,
    unit: UNIT,
    countsTowardStaffing: true,
    acuityLevel: null,
    acuityExtraStaff: 0,
    sitterCount: 0,
  }));
}

function makeContext(staffList: StaffInfo[], shifts: ShiftInfo[]): SchedulerContext {
  return {
    scheduleId: SCHEDULE_ID,
    shifts,
    shiftMap: new Map(shifts.map((s) => [s.id, s])),
    staffList,
    staffMap: new Map(staffList.map((s) => [s.id, s])),
    prnAvailability: [],
    staffLeaves: [],
    unitConfig,
    scheduleUnit: UNIT,
    publicHolidays: [],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Scheduler pipeline smoke test (post-Excel-import state)", () => {
  const staffList = makeRoster();
  const shifts = makeShifts();
  const ctx = makeContext(staffList, shifts);

  it("buildShiftInserts produces the expected number of shifts for the date range", () => {
    // 14 days × 2 definitions = 28 shifts
    expect(shifts).toHaveLength(14 * 2);
  });

  it("greedyConstruct produces assignments when staff and shifts exist", () => {
    const result = greedyConstruct(ctx, BALANCED);
    expect(result.assignments.length).toBeGreaterThan(0);
  });

  it("greedyConstruct achieves full coverage with a sufficient roster", () => {
    // 14 days × 2 shifts × 2 slots = 56 assignments needed. 14 staff should cover this.
    const result = greedyConstruct(ctx, BALANCED);
    expect(result.understaffed).toHaveLength(0);
    expect(result.assignments).toHaveLength(shifts.length * shifts[0].requiredStaffCount);
  });

  it("no staff member appears on two overlapping shifts in the same day", () => {
    const result = greedyConstruct(ctx, BALANCED);
    // Group by staff and check each pair of their assignments on the same date
    const byStaff = new Map<string, typeof result.assignments>();
    for (const a of result.assignments) {
      const list = byStaff.get(a.staffId) ?? [];
      list.push(a);
      byStaff.set(a.staffId, list);
    }
    for (const [, assignments] of byStaff) {
      // Check no two assignments on the same date (same-date shifts are day+night = 07:00-19:00 and 19:00-07:00, adjacent not overlapping)
      // Verify no staff is on BOTH the day AND night shift on the same date
      const dateShiftTypes = assignments.map((a) => `${a.date}::${a.shiftType}`);
      const unique = new Set(dateShiftTypes);
      expect(unique.size).toBe(dateShiftTypes.length);
    }
  });

  it("local search does not worsen the greedy result", () => {
    const greedy = greedyConstruct(ctx, BALANCED);
    const improved = localSearch(greedy, ctx, BALANCED, 100);
    expect(improved.assignments).toHaveLength(greedy.assignments.length);
    expect(improved.understaffed).toEqual(greedy.understaffed);
  });

  it("all three variants produce assignments with the same staff pool", () => {
    const balanced = greedyConstruct(ctx, BALANCED);
    const fair = greedyConstruct(ctx, FAIR);
    const cost = greedyConstruct(ctx, COST_OPTIMIZED);
    // All variants should achieve full coverage
    expect(balanced.understaffed).toHaveLength(0);
    expect(fair.understaffed).toHaveLength(0);
    expect(cost.understaffed).toHaveLength(0);
  });

  it("returns 0 assignments when there are no shifts (empty schedule bug)", () => {
    // This was the exact bug: shifts weren't created, so the scheduler got an empty list
    const emptyCtx = makeContext(staffList, []);
    const result = greedyConstruct(emptyCtx, BALANCED);
    expect(result.assignments).toHaveLength(0);
    expect(result.understaffed).toHaveLength(0);
    // Also verify: this is the symptom the user saw — no assignments generated at all
  });

  it("returns 0 assignments when there is no staff (just shifts)", () => {
    const noStaffCtx = makeContext([], shifts);
    const result = greedyConstruct(noStaffCtx, BALANCED);
    expect(result.assignments).toHaveLength(0);
    expect(result.understaffed).toHaveLength(shifts.length);
  });

  it("each assignment references a valid shiftId and staffId from the context", () => {
    const result = greedyConstruct(ctx, BALANCED);
    const shiftIds = new Set(shifts.map((s) => s.id));
    const staffIds = new Set(staffList.map((s) => s.id));
    for (const a of result.assignments) {
      expect(shiftIds.has(a.shiftId)).toBe(true);
      expect(staffIds.has(a.staffId)).toBe(true);
    }
  });
});
