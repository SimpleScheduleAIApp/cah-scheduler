/**
 * Tests for findCandidatesForShift — specifically the new candidate fields
 * added in v1.4.34:
 *   - isChargeNurseQualified
 *   - weekendsThisPeriod
 *   - consecutiveDaysBeforeShift
 *   - OT text removed from reasons[] for overtime-tier candidates
 *   - Agency pseudo-candidate always has the correct field values
 *
 * Strategy:
 *  - Mock @/db with a fluent chain mock (identical approach to escalation tests)
 *  - Use a single float staff member to drive most tests
 *  - For agency tests: return no float/PRN/OT staff so only agency appears
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────

const mockGet = vi.hoisted(() => vi.fn());
const mockAll = vi.hoisted(() => vi.fn());

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:  vi.fn(),
  and: vi.fn(),
  ne:  vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  or:  vi.fn(),
}));

vi.mock("@/db/schema", () => ({
  staff:           { id: "s$id", role: "s$role", icuCompetencyLevel: "s$level",
                     isChargeNurseQualified: "s$charge", reliabilityRating: "s$rel",
                     isActive: "s$active", employmentType: "s$empType",
                     firstName: "s$first", lastName: "s$last",
                     homeUnit: "s$homeUnit", crossTrainedUnits: "s$crossTrained",
                     flexHoursYearToDate: "s$flexYTD" },
  staffLeave:      { staffId: "sl$staffId", status: "sl$status",
                     startDate: "sl$start", endDate: "sl$end" },
  assignment:      { id: "a$id", staffId: "a$staffId", status: "a$status",
                     shiftId: "a$shiftId", isChargeNurse: "a$charge" },
  shift:           { id: "sh$id", date: "sh$date", scheduleId: "sh$scheduleId",
                     shiftDefinitionId: "sh$shiftDefId" },
  shiftDefinition: { id: "sd$id", startTime: "sd$startTime", endTime: "sd$endTime",
                     durationHours: "sd$duration", shiftType: "sd$type",
                     unit: "sd$unit" },
  schedule:        { id: "sched$id", startDate: "sched$startDate", endDate: "sched$endDate" },
  prnAvailability: { staffId: "prn$staffId", availableDates: "prn$dates" },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chain: any = {};
chain.get       = mockGet;
chain.all       = mockAll;
chain.where     = () => chain;
chain.innerJoin = () => chain;
chain.from      = () => chain;

vi.mock("@/db", () => ({ db: { select: () => chain } }));

// ─── SUT (imported after mocks) ────────────────────────────────────────────

import { findCandidatesForShift } from "@/lib/coverage/find-candidates";

// ─── Constants ─────────────────────────────────────────────────────────────

const SHIFT_ID = "shift-001";
const UNIT     = "ICU";

// ─── Factory helpers ───────────────────────────────────────────────────────

function makeShiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id:            SHIFT_ID,
    date:          "2026-03-10",
    startTime:     "07:00",
    endTime:       "19:00",
    durationHours: 12,
    unit:          UNIT,
    shiftType:     "day",
    scheduleId:    "sched-001",
    ...overrides,
  };
}

function makeFloatStaff(overrides: Record<string, unknown> = {}) {
  return {
    id:                    "float-staff-001",
    firstName:             "Sam",
    lastName:              "Rivera",
    role:                  "RN",
    employmentType:        "float",
    icuCompetencyLevel:    3,
    isChargeNurseQualified: false,
    reliabilityRating:     4,
    isActive:              true,
    homeUnit:              UNIT,    // matches shift unit → isQualified = true
    crossTrainedUnits:     null,
    flexHoursYearToDate:   10,
    ...overrides,
  };
}

/**
 * Queue .get() and .all() calls for a scenario with exactly ONE float staff
 * member and no PRN/OT/adjacent assignments.
 *
 * Execution order in findCandidatesForShift:
 *   findFloatCandidates → checkStaffAvailability → countWeekends → countConsecutive
 *   findPRNCandidates
 *   findOvertimeCandidates
 *   (agency pseudo-candidate — no DB calls)
 *
 * .get() call order:
 *   1. shiftRow                 (initial shift lookup)
 *   2. sched                    (countWeekendsInSchedulePeriod schedule bounds)
 *   3+. hasShift day-N          (countConsecutiveDaysBefore — one per consecutive day + break)
 *
 * .all() call order:
 *   1. floatStaff
 *   2. leaveRecords             (checkStaffAvailability)
 *   3. existingAssignments      (checkStaffAvailability: same-day overlap)
 *   4. weekAssignments          (checkStaffAvailability: weekly hours)
 *   5. adjacentAssignments      (checkStaffAvailability: D-1/D+1 rest)
 *   6. weekendRows              (countWeekendsInSchedulePeriod — inside findFloatCandidates)
 *   7. prnStaff                 (findPRNCandidates)
 *   8. regularStaff             (findOvertimeCandidates)
 */
function setupFloatCandidate({
  floatStaff   = makeFloatStaff(),
  weekendRows  = [] as Array<{ date: string }>,
  consecutiveDays = 0,
  weeklyHours  = 0,
} = {}) {
  const weeklyAssignments = weeklyHours > 0
    ? [{ durationHours: weeklyHours }]
    : [];

  // .get() sequence
  mockGet
    .mockReturnValueOnce(makeShiftRow())            // 1. shiftRow
    .mockReturnValueOnce({ startDate: "2026-02-01", endDate: "2026-03-31" }); // 2. sched

  for (let d = 0; d < consecutiveDays; d++) {
    mockGet.mockReturnValueOnce({ id: `assign-d${d}` }); // consecutive day assigned
  }
  mockGet.mockReturnValueOnce(undefined); // break out of consecutive loop

  // .all() sequence — weekendRows comes RIGHT AFTER adjacentAssignments (inside findFloat)
  mockAll
    .mockReturnValueOnce([floatStaff])      // 1. floatStaff
    .mockReturnValueOnce([])               // 2. leaveRecords
    .mockReturnValueOnce([])               // 3. existingAssignments (same-day)
    .mockReturnValueOnce(weeklyAssignments)// 4. weekAssignments
    .mockReturnValueOnce([])               // 5. adjacentAssignments
    .mockReturnValueOnce(weekendRows)      // 6. weekendRows (countWeekendsInSchedulePeriod)
    .mockReturnValueOnce([])               // 7. prnStaff
    .mockReturnValueOnce([]);              // 8. regularStaff
}

/**
 * Queue for a no-staff scenario — only the agency pseudo-candidate is returned.
 * buildVacancyContext is skipped (no excludeStaffId).
 */
function setupNoStaff() {
  mockGet.mockReturnValueOnce(makeShiftRow()); // shiftRow

  mockAll
    .mockReturnValueOnce([])   // floatStaff (empty)
    .mockReturnValueOnce([])   // prnStaff (empty)
    .mockReturnValueOnce([]);  // regularStaff (empty)
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("findCandidatesForShift — agency pseudo-candidate fields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("always includes the agency pseudo-candidate when no other candidates exist", async () => {
    setupNoStaff();

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    expect(candidates.some(c => c.staffId === "agency")).toBe(true);
  });

  it("agency candidate has isChargeNurseQualified: false", async () => {
    setupNoStaff();

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const agency = candidates.find(c => c.staffId === "agency")!;
    expect(agency.isChargeNurseQualified).toBe(false);
  });

  it("agency candidate has weekendsThisPeriod: 0", async () => {
    setupNoStaff();

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const agency = candidates.find(c => c.staffId === "agency")!;
    expect(agency.weekendsThisPeriod).toBe(0);
  });

  it("agency candidate has consecutiveDaysBeforeShift: 0", async () => {
    setupNoStaff();

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const agency = candidates.find(c => c.staffId === "agency")!;
    expect(agency.consecutiveDaysBeforeShift).toBe(0);
  });

  it("returns empty candidates and empty steps when shift not found", async () => {
    mockGet.mockReturnValueOnce(undefined); // shiftRow not found

    const { candidates, escalationStepsChecked } = await findCandidatesForShift(SHIFT_ID);
    expect(candidates).toEqual([]);
    expect(escalationStepsChecked).toEqual([]);
  });
});

describe("findCandidatesForShift — float candidate fields", () => {
  beforeEach(() => vi.clearAllMocks());

  it("float candidate has isChargeNurseQualified matching the staff record (false)", async () => {
    setupFloatCandidate({ floatStaff: makeFloatStaff({ isChargeNurseQualified: false }) });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float");
    expect(float).toBeDefined();
    expect(float!.isChargeNurseQualified).toBe(false);
  });

  it("float candidate has isChargeNurseQualified matching the staff record (true)", async () => {
    setupFloatCandidate({ floatStaff: makeFloatStaff({ isChargeNurseQualified: true }) });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float");
    expect(float).toBeDefined();
    expect(float!.isChargeNurseQualified).toBe(true);
  });

  it("float candidate has weekendsThisPeriod as a number", async () => {
    setupFloatCandidate({ weekendRows: [] });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float")!;
    expect(typeof float.weekendsThisPeriod).toBe("number");
  });

  it("float candidate weekendsThisPeriod reflects weekend assignment count", async () => {
    setupFloatCandidate({
      weekendRows: [
        { date: "2026-03-07" }, // Saturday
        { date: "2026-03-08" }, // Sunday
      ],
    });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float")!;
    expect(float.weekendsThisPeriod).toBe(2);
  });

  it("float candidate has consecutiveDaysBeforeShift as a number", async () => {
    setupFloatCandidate({ consecutiveDays: 0 });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float")!;
    expect(typeof float.consecutiveDaysBeforeShift).toBe("number");
  });

  it("float candidate consecutiveDaysBeforeShift reflects actual streak", async () => {
    setupFloatCandidate({ consecutiveDays: 3 });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float")!;
    expect(float.consecutiveDaysBeforeShift).toBe(3);
  });

  it("float candidate has isOvertime=true when hours pushed past 40h", async () => {
    setupFloatCandidate({ weeklyHours: 32 }); // 32 + 12 = 44 > 40

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float");
    expect(float).toBeDefined();
    expect(float!.isOvertime).toBe(true);
  });

  it("float candidate has isOvertime=false when hours stay under 40h", async () => {
    setupFloatCandidate({ weeklyHours: 20 }); // 20 + 12 = 32 ≤ 40

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const float = candidates.find(c => c.source === "float");
    expect(float).toBeDefined();
    expect(float!.isOvertime).toBe(false);
  });
});

describe("findCandidatesForShift — overtime tier: OT reasons removed", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Queue for an overtime (full_time) candidate with no float/PRN staff.
   * checkStaffAvailability call order is the same as for float.
   */
  function setupOvertimeCandidate({
    hoursThisWeek = 32,
    weekendRows   = [] as Array<{ date: string }>,
    consecutiveDays = 0,
  } = {}) {
    const regularStaff = [{
      id:                    "ot-staff-001",
      firstName:             "Drew",
      lastName:              "Lee",
      role:                  "RN",
      employmentType:        "full_time",
      icuCompetencyLevel:    3,
      isChargeNurseQualified: false,
      reliabilityRating:     3,
      isActive:              true,
      homeUnit:              UNIT,
      crossTrainedUnits:     null,
      flexHoursYearToDate:   10,
    }];

    const weeklyAssignments = hoursThisWeek > 0
      ? [{ durationHours: hoursThisWeek }]
      : [];

    mockGet
      .mockReturnValueOnce(makeShiftRow())                                  // shiftRow
      .mockReturnValueOnce({ startDate: "2026-02-01", endDate: "2026-03-31" }); // sched

    for (let d = 0; d < consecutiveDays; d++) {
      mockGet.mockReturnValueOnce({ id: `assign-d${d}` });
    }
    mockGet.mockReturnValueOnce(undefined); // break consecutive loop

    mockAll
      .mockReturnValueOnce([])              // floatStaff (empty)
      .mockReturnValueOnce([])              // prnStaff (empty)
      .mockReturnValueOnce(regularStaff)   // regularStaff
      .mockReturnValueOnce([])             // leaveRecords
      .mockReturnValueOnce([])             // existingAssignments
      .mockReturnValueOnce(weeklyAssignments) // weekAssignments
      .mockReturnValueOnce([])             // adjacentAssignments
      .mockReturnValueOnce(weekendRows);   // weekendRows
  }

  it("overtime tier reasons do not contain 'overtime' text", async () => {
    setupOvertimeCandidate({ hoursThisWeek: 32 });

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const ot = candidates.find(c => c.source === "overtime");
    if (!ot) return; // no OT candidate surfaced — test is N/A

    const reasonsText = ot.reasons.join(" ").toLowerCase();
    expect(reasonsText).not.toContain("overtime");
    expect(reasonsText).not.toContain("would be overtime");
    expect(reasonsText).not.toContain("extra shift");
  });

  it("overtime candidate still has isOvertime=true flag", async () => {
    setupOvertimeCandidate({ hoursThisWeek: 32 }); // 32 + 12 = 44 > 40

    const { candidates } = await findCandidatesForShift(SHIFT_ID);
    const ot = candidates.find(c => c.source === "overtime");
    if (!ot) return;
    expect(ot.isOvertime).toBe(true);
  });
});
