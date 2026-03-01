/**
 * Tests for getEscalationOptions — specifically the new candidate fields
 * added in v1.4.34:
 *   - weekendsThisPeriod
 *   - consecutiveDaysBeforeShift
 *   - OT text removed from reasons[]
 *
 * Strategy:
 *  - Mock @/db with a fluent chain mock (every .from()/.innerJoin()/.where()
 *    returns the same chain so any query shape resolves to mockGet / mockAll)
 *  - Queue up return values in the order the function calls them
 *  - Assert only on the new/changed fields
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
}));

vi.mock("@/db/schema", () => ({
  staff:           { id: "s$id", role: "s$role", icuCompetencyLevel: "s$level",
                     isChargeNurseQualified: "s$charge", reliabilityRating: "s$rel",
                     isActive: "s$active", employmentType: "s$empType",
                     firstName: "s$first", lastName: "s$last" },
  staffLeave:      { staffId: "sl$staffId", status: "sl$status",
                     startDate: "sl$start", endDate: "sl$end" },
  assignment:      { id: "a$id", staffId: "a$staffId", status: "a$status",
                     shiftId: "a$shiftId", isChargeNurse: "a$charge" },
  shift:           { id: "sh$id", date: "sh$date", scheduleId: "sh$scheduleId",
                     shiftDefinitionId: "sh$shiftDefId" },
  shiftDefinition: { id: "sd$id", startTime: "sd$startTime", endTime: "sd$endTime",
                     durationHours: "sd$duration", shiftType: "sd$type" },
  schedule:        { id: "sched$id", startDate: "sched$startDate", endDate: "sched$endDate" },
}));

/**
 * Fluent chain mock.
 * Every .from() / .innerJoin() / .where() / .select() returns the same object
 * so any Drizzle query shape can resolve to mockGet / mockAll regardless of
 * how many joins or which table is queried.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chain: any = {};
chain.get      = mockGet;
chain.all      = mockAll;
chain.where    = () => chain;
chain.innerJoin = () => chain;
chain.from     = () => chain;

vi.mock("@/db", () => ({ db: { select: () => chain } }));

// ─── SUT (imported after mocks) ────────────────────────────────────────────

import { getEscalationOptions } from "@/lib/callout/escalation";

// ─── Constants ─────────────────────────────────────────────────────────────

const SHIFT_ID       = "shift-001";
const CALLED_OUT_ID  = "staff-called-001";
const CANDIDATE_ID   = "staff-cand-001";
const SCHED_ID       = "sched-001";

// ─── Factory helpers ───────────────────────────────────────────────────────

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    firstName: "Jane",
    lastName: "Doe",
    role: "RN",
    employmentType: "full_time",
    icuCompetencyLevel: 3,
    isChargeNurseQualified: false,
    reliabilityRating: 3,
    isActive: true,
    homeUnit: "ICU",
    ...overrides,
  };
}

function makeShiftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHIFT_ID,
    date: "2026-03-10",   // Tuesday
    startTime: "07:00",
    endTime: "19:00",
    durationHours: 12,
    shiftType: "day",
    scheduleId: SCHED_ID,
    ...overrides,
  };
}

/**
 * Queue up .get() and .all() return values in the exact order
 * getEscalationOptions + its helpers call them.
 *
 * .get() call order (for 1 candidate):
 *   1. shiftRow
 *   2. calledOut (called-out staff role/level)
 *   3. calledOutAssignment (isChargeNurse)
 *   4. sched (schedule period bounds — used by countWeekendsInSchedulePeriod)
 *   5+. hasShift for each consecutive day before shift (countConsecutiveDaysBefore)
 *       until the first undefined (which breaks the loop)
 *
 * .all() call order (for 1 candidate):
 *   1. allStaff
 *   2. existingAssignments
 *   3. nearbyRaw  (D-1 to D+1 assignments — availability + rest check)
 *   4. weeklyRaw  (weekly hours for OT)
 *   5. activeLeaves
 *   6. weekendRows (only if sched returned a valid object)
 */
function setupQueues({
  shiftRow          = makeShiftRow(),
  calledOut         = { role: "RN", icuCompetencyLevel: 3 },
  calledOutAssignment = { isChargeNurse: false },
  candidates        = [makeCandidate()],
  sched             = { startDate: "2026-02-01", endDate: "2026-03-31" } as Record<string, unknown> | undefined,
  weekendRows       = [] as Array<{ date: string }>,
  consecutiveDays   = 0,   // number of days BEFORE the shift that have assignments
  hoursThisWeek     = 0,
}: {
  shiftRow?:            Record<string, unknown>;
  calledOut?:           Record<string, unknown>;
  calledOutAssignment?: Record<string, unknown>;
  candidates?:          Record<string, unknown>[];
  sched?:               Record<string, unknown> | undefined;
  weekendRows?:         Array<{ date: string }>;
  consecutiveDays?:     number;
  hoursThisWeek?:       number;
} = {}) {
  // Build weeklyRaw entries with the right staffId so the Map lookup works
  const weeklyRaw = hoursThisWeek > 0
    ? candidates.map(c => ({ staffId: c.id, status: "active", durationHours: hoursThisWeek }))
    : [];

  // --- .get() sequence ---
  mockGet
    .mockReturnValueOnce(shiftRow)            // 1. shiftRow
    .mockReturnValueOnce(calledOut)           // 2. calledOut
    .mockReturnValueOnce(calledOutAssignment);// 3. calledOutAssignment

  // Per-candidate: schedule bounds (countWeekendsInSchedulePeriod)
  // Called once per candidate (after eligibility checks)
  for (let i = 0; i < candidates.length; i++) {
    mockGet.mockReturnValueOnce(sched);       // 4 (per candidate). sched
  }

  // Per-candidate: consecutive day checks (countConsecutiveDaysBefore)
  // Calls .get() consecutiveDays times (truthy), then once more (undefined = break)
  for (let i = 0; i < candidates.length; i++) {
    for (let d = 0; d < consecutiveDays; d++) {
      mockGet.mockReturnValueOnce({ id: `assign-d${d}` }); // has shift on day-(d+1)
    }
    mockGet.mockReturnValueOnce(undefined); // no shift on day-(consecutiveDays+1) → break
  }

  // --- .all() sequence ---
  mockAll
    .mockReturnValueOnce(candidates)   // 1. allStaff
    .mockReturnValueOnce([])           // 2. existingAssignments
    .mockReturnValueOnce([])           // 3. nearbyRaw (D-1/D/D+1)
    .mockReturnValueOnce(weeklyRaw)    // 4. weeklyRaw
    .mockReturnValueOnce([]);          // 5. activeLeaves

  // countWeekendsInSchedulePeriod weekend rows — only called if sched is truthy
  if (sched) {
    for (let i = 0; i < candidates.length; i++) {
      mockAll.mockReturnValueOnce(weekendRows); // 6 (per candidate). weekend assignment rows
    }
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("getEscalationOptions — weekendsThisPeriod", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes weekendsThisPeriod on every candidate", () => {
    setupQueues({ weekendRows: [] });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].weekendsThisPeriod).toBe("number");
  });

  it("counts only Saturday and Sunday assignments as weekends", () => {
    // 2026-03-07 is Saturday, 2026-03-08 is Sunday, 2026-03-09 is Monday
    setupQueues({
      weekendRows: [
        { date: "2026-03-07" }, // Saturday ✓
        { date: "2026-03-08" }, // Sunday ✓
        { date: "2026-03-09" }, // Monday — should NOT count
      ],
    });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].weekendsThisPeriod).toBe(2);
  });

  it("returns 0 when no weekend assignments in the period", () => {
    setupQueues({ weekendRows: [] });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].weekendsThisPeriod).toBe(0);
  });

  it("returns 0 when schedule record is not found", () => {
    setupQueues({ sched: undefined });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].weekendsThisPeriod).toBe(0);
  });

  it("returns a high weekend count when many weekend assignments exist", () => {
    setupQueues({
      weekendRows: [
        { date: "2026-02-07" }, // Saturday
        { date: "2026-02-08" }, // Sunday
        { date: "2026-02-14" }, // Saturday
        { date: "2026-02-21" }, // Saturday
      ],
    });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].weekendsThisPeriod).toBe(4);
  });
});

describe("getEscalationOptions — consecutiveDaysBeforeShift", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes consecutiveDaysBeforeShift on every candidate", () => {
    setupQueues({ consecutiveDays: 0 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result.length).toBeGreaterThan(0);
    expect(typeof result[0].consecutiveDaysBeforeShift).toBe("number");
  });

  it("returns 0 when no assignment the day before the shift", () => {
    setupQueues({ consecutiveDays: 0 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].consecutiveDaysBeforeShift).toBe(0);
  });

  it("counts 2 consecutive days correctly", () => {
    setupQueues({ consecutiveDays: 2 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].consecutiveDaysBeforeShift).toBe(2);
  });

  it("counts 4 consecutive days correctly", () => {
    setupQueues({ consecutiveDays: 4 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].consecutiveDaysBeforeShift).toBe(4);
  });

  it("stops counting at the first gap (does not wrap)", () => {
    // 3 consecutive days → function should stop at 3
    setupQueues({ consecutiveDays: 3 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].consecutiveDaysBeforeShift).toBe(3);
  });
});

describe("getEscalationOptions — reasons[] does not contain OT text", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not include overtime text in reasons for an overtime (full_time) candidate", () => {
    // 32h already scheduled + 12h shift = 44h → OT
    setupQueues({ hoursThisWeek: 32 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result.length).toBeGreaterThan(0);

    const candidate = result[0];
    expect(candidate.wouldBeOvertime).toBe(true);

    const reasonsText = candidate.reasons.join(" ").toLowerCase();
    expect(reasonsText).not.toContain("overtime");
    expect(reasonsText).not.toContain("extra shift");
    expect(reasonsText).not.toContain("1.5");
  });

  it("still sets wouldBeOvertime=true flag on OT candidates", () => {
    setupQueues({ hoursThisWeek: 32 });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].wouldBeOvertime).toBe(true);
  });

  it("does not include overtime text when candidate would NOT be OT", () => {
    setupQueues({ hoursThisWeek: 20 }); // 20 + 12 = 32 — not OT

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result[0].wouldBeOvertime).toBe(false);

    const reasonsText = result[0].reasons.join(" ").toLowerCase();
    expect(reasonsText).not.toContain("overtime");
  });
});

describe("getEscalationOptions — charge nurse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds charge-qualified reason when original held charge and candidate qualifies", () => {
    setupQueues({
      calledOutAssignment: { isChargeNurse: true },
      candidates: [makeCandidate({ isChargeNurseQualified: true })],
    });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    const eligible = result.filter(c => c.isEligible);
    expect(eligible.length).toBeGreaterThan(0);

    const reasonsText = eligible[0].reasons.join(" ").toLowerCase();
    expect(reasonsText).toContain("charge");
  });

  it("marks candidate ineligible when original held charge but candidate does not qualify", () => {
    setupQueues({
      calledOutAssignment: { isChargeNurse: true },
      candidates: [makeCandidate({ isChargeNurseQualified: false })],
    });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    const candidate = result.find(c => c.staffId === CANDIDATE_ID);
    expect(candidate).toBeDefined();
    expect(candidate!.isEligible).toBe(false);
    expect(candidate!.ineligibilityReasons.some(r => /charge/i.test(r))).toBe(true);
  });

  it("does not mark ineligible when original was NOT charge nurse", () => {
    setupQueues({
      calledOutAssignment: { isChargeNurse: false },
      candidates: [makeCandidate({ isChargeNurseQualified: false })],
    });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    const candidate = result.find(c => c.staffId === CANDIDATE_ID);
    expect(candidate!.isEligible).toBe(true);
  });
});

describe("getEscalationOptions — empty / edge cases", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns [] when shift is not found", () => {
    mockGet.mockReturnValueOnce(undefined); // shiftRow not found

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result).toEqual([]);
  });

  it("returns [] when no staff are in the database", () => {
    setupQueues({ candidates: [] });

    const result = getEscalationOptions(SHIFT_ID, CALLED_OUT_ID);
    expect(result).toEqual([]);
  });
});
