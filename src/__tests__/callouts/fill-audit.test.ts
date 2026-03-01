/**
 * Tests for PUT /api/callouts/[id] — the callout-fill route handler.
 *
 * Critical invariant (v1.4.31 fix): the "callout_filled" audit event MUST be
 * written even when db.insert(assignment) throws a UNIQUE constraint error
 * (replacement already on that shift).  Before the fix, both logAuditEvent
 * calls were silently skipped whenever the insert threw.
 *
 * Strategy:
 *  - Mock @/db with controllable chainable fakes
 *  - Spy on logAuditEvent from @/lib/audit/logger
 *  - Drive the UNIQUE-constraint scenario by making mockInsertRun throw
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted variables ────────────────────────────────────────────────────────

const mockUpdateRetGet = vi.hoisted(() => vi.fn());   // update().returning().get()
const mockUpdateRun    = vi.hoisted(() => vi.fn());   // update().run()
const mockSelectGet    = vi.hoisted(() => vi.fn());   // select().from().where().get()
const mockInsertRun    = vi.hoisted(() => vi.fn());   // insert().values().run()
const mockLogAuditEvent = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      _data: data,
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
}));

vi.mock("@/db/schema", () => ({
  callout:    { id: "callout$id",    staffId: "callout$staffId" },
  assignment: { id: "assign$id",     isChargeNurse: "assign$isChargeNurse" },
  shift:      { id: "shift$id",      scheduleId: "shift$scheduleId", date: "shift$date" },
  schedule:   { id: "sched$id",      unit: "sched$unit" },
  staff:      { id: "staff$id",      firstName: "staff$firstName", lastName: "staff$lastName", homeUnit: "staff$homeUnit" },
}));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => ({ get: mockUpdateRetGet }),
          run: mockUpdateRun,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ get: mockSelectGet }),
      }),
    }),
    insert: () => ({
      values: () => ({ run: mockInsertRun }),
    }),
  },
}));

vi.mock("@/lib/audit/logger", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/callout/escalation", () => ({ getEscalationOptions: vi.fn(() => []) }));

// ─── Import SUT after mocks ───────────────────────────────────────────────────

import { PUT } from "@/app/api/callouts/[id]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CALLOUT_ID = "callout-001";
const SHIFT_ID   = "shift-001";
const ASSIGN_ID  = "assign-001";
const REP_STAFF  = "staff-rep-001";
const SCHED_ID   = "sched-001";

/** Minimal callout object returned by the first db.update().returning().get() */
function makeUpdatedCallout(overrides: Record<string, unknown> = {}) {
  return {
    id: CALLOUT_ID,
    shiftId: SHIFT_ID,
    assignmentId: ASSIGN_ID,
    staffId: "staff-called-001",
    replacementStaffId: REP_STAFF,
    replacementSource: "regular",
    status: "filled",
    resolvedAt: "2026-03-10T08:00:00Z",
    resolvedBy: "nurse_manager",
    escalationStepsTaken: null,
    ...overrides,
  };
}

/**
 * Configure the mockSelectGet queue for the standard happy-path flow
 * where assignmentId is set and replacement staff are looked up.
 *
 * Call order in the route handler (when assignmentId + replacementStaffId present):
 *  1. select isChargeNurse from assignment (orig assignment)
 *  2. select firstName/lastName from staff (replacement name)
 *  3. select scheduleId/date from shift
 *  4. select unit from schedule
 *  5. select homeUnit from staff (replacement staff unit)
 */
function setupSelectQueue() {
  mockSelectGet
    .mockReturnValueOnce({ isChargeNurse: false })                         // 1
    .mockReturnValueOnce({ firstName: "Bob", lastName: "Smith" })          // 2
    .mockReturnValueOnce({ scheduleId: SCHED_ID, date: "2026-03-10" })     // 3
    .mockReturnValueOnce({ unit: "ICU" })                                  // 4
    .mockReturnValueOnce({ homeUnit: "ICU" });                             // 5
}

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/callouts/${CALLOUT_ID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams() {
  return Promise.resolve({ id: CALLOUT_ID });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PUT /api/callouts/[id] — audit trail guarantee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateRetGet.mockReturnValue(makeUpdatedCallout());
    setupSelectQueue();
    mockInsertRun.mockReturnValue(undefined);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("writes both manual_assignment and callout_filled when insert succeeds", async () => {
    await PUT(makeRequest({ replacementStaffId: REP_STAFF, replacementSource: "regular" }), { params: makeParams() });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_assignment" })
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "callout_filled" })
    );
  });

  it("callout_filled is written last (after manual_assignment)", async () => {
    await PUT(makeRequest({ replacementStaffId: REP_STAFF, replacementSource: "regular" }), { params: makeParams() });

    const calls = mockLogAuditEvent.mock.calls;
    expect(calls[0][0].action).toBe("manual_assignment");
    expect(calls[1][0].action).toBe("callout_filled");
  });

  // ── UNIQUE constraint — the critical v1.4.31 regression test ─────────────

  it("still writes callout_filled when insert throws UNIQUE constraint", async () => {
    mockInsertRun.mockImplementationOnce(() => {
      throw new Error("UNIQUE constraint failed: assignment.shiftId, assignment.staffId");
    });

    await PUT(makeRequest({ replacementStaffId: REP_STAFF, replacementSource: "regular" }), { params: makeParams() });

    // manual_assignment must NOT be written (insert failed before logAuditEvent reached)
    expect(mockLogAuditEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_assignment" })
    );

    // callout_filled MUST still be written
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "callout_filled" })
    );
  });

  it("callout_filled includes the correct entityId", async () => {
    await PUT(makeRequest({ replacementStaffId: REP_STAFF, replacementSource: "regular" }), { params: makeParams() });

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "callout", entityId: CALLOUT_ID })
    );
  });

  it("callout_filled entityType is 'callout'", async () => {
    mockInsertRun.mockImplementationOnce(() => { throw new Error("UNIQUE"); });

    await PUT(makeRequest({ replacementStaffId: REP_STAFF }), { params: makeParams() });

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "callout" })
    );
  });

  // ── No replacement staff ──────────────────────────────────────────────────

  it("writes only callout_filled (no manual_assignment) when no replacementStaffId", async () => {
    // For this path: no replacement select calls, only the orig assignment select
    vi.clearAllMocks();
    mockUpdateRetGet.mockReturnValue(makeUpdatedCallout({ replacementStaffId: null }));
    mockSelectGet.mockReturnValueOnce({ isChargeNurse: false }); // orig assignment only

    await PUT(makeRequest({ status: "unfilled" }), { params: makeParams() });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "callout_filled" })
    );
    // insert never called, so manual_assignment never logged
    expect(mockLogAuditEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_assignment" })
    );
  });

  // ── 404 path ─────────────────────────────────────────────────────────────

  it("returns 404 and logs nothing when callout not found", async () => {
    mockUpdateRetGet.mockReturnValue(undefined);

    const response = await PUT(makeRequest({ replacementStaffId: REP_STAFF }), { params: makeParams() });

    expect((response as { status: number }).status).toBe(404);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── Replacement source label ──────────────────────────────────────────────

  it("includes replacementSource in callout_filled description", async () => {
    await PUT(makeRequest({ replacementStaffId: REP_STAFF, replacementSource: "overtime" }), { params: makeParams() });

    const filledCall = mockLogAuditEvent.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "callout_filled"
    );
    expect(filledCall?.[0].description).toContain("overtime");
  });

  it("defaults replacementSource to 'unknown' when omitted", async () => {
    await PUT(makeRequest({ replacementStaffId: REP_STAFF }), { params: makeParams() });

    const filledCall = mockLogAuditEvent.mock.calls.find(
      (c: unknown[]) => (c[0] as { action: string }).action === "callout_filled"
    );
    expect(filledCall?.[0].description).toContain("unknown");
  });

  // ── isOvertime flag ───────────────────────────────────────────────────────

  it("writes callout_filled when replacementSource is 'overtime'", async () => {
    // Note: vi.mock() calls inside test bodies are hoisted and cannot reference
    // local variables, so we verify the code ran correctly via the audit event.
    setupSelectQueue();
    await PUT(makeRequest({ replacementStaffId: REP_STAFF, replacementSource: "overtime" }), { params: makeParams() });

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "callout_filled" })
    );
  });
});
