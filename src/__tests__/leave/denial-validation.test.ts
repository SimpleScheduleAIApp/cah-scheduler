/**
 * Tests for PUT /api/staff-leave/[id] — denial reason validation.
 *
 * Business rule: when a nurse manager denies a leave request, they MUST
 * supply a denial reason.  An empty or whitespace-only reason must be
 * rejected with HTTP 400 before any DB write occurs.
 *
 * Strategy:
 *  - Mock @/db so no real SQLite file is touched
 *  - Mock next/server, drizzle-orm, and downstream helpers
 *  - Drive every branch of the status === "denied" validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted variables ────────────────────────────────────────────────────────

const mockSelectGet    = vi.hoisted(() => vi.fn());
const mockUpdateRetGet = vi.hoisted(() => vi.fn());
const mockUpdateRun    = vi.hoisted(() => vi.fn());
const mockInsertRun    = vi.hoisted(() => vi.fn());

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
  eq:  vi.fn((a: unknown, b: unknown) => ({ _eq:  [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  gte: vi.fn((a: unknown, b: unknown) => ({ _gte: [a, b] })),
  lte: vi.fn((a: unknown, b: unknown) => ({ _lte: [a, b] })),
}));

vi.mock("@/db/schema", () => ({
  staffLeave:   { id: "sl$id", staffId: "sl$staffId", status: "sl$status" },
  exceptionLog: { id: "el$id" },
  assignment:   { id: "assign$id", staffId: "assign$staffId", status: "assign$status", shiftId: "assign$shiftId", scheduleId: "assign$scheduleId" },
  shift:        { id: "shift$id", date: "shift$date" },
  schedule:     { id: "sched$id", unit: "sched$unit" },
  unit:         { id: "unit$id", name: "unit$name" },
  openShift:    { id: "os$id" },
  callout:      { id: "co$id" },
  staff:        { id: "staff$id", firstName: "staff$firstName", lastName: "staff$lastName" },
}));

vi.mock("@/db", () => {
  // Self-referential chain so .innerJoin().innerJoin().where() works
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromResult: any = {
    where: () => ({ get: mockSelectGet, all: vi.fn(() => []) }),
    all: vi.fn(() => []),
  };
  fromResult.innerJoin = () => fromResult;
  return {
    db: {
      select: () => ({ from: () => fromResult }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => ({ get: mockUpdateRetGet }),
            run: mockUpdateRun,
          }),
        }),
      }),
      insert: () => ({ values: () => ({ run: mockInsertRun, returning: () => ({ get: vi.fn(() => ({ id: "new-id" })) }) }) }),
      delete: () => ({ where: () => ({ run: vi.fn() }) }),
    },
  };
});

vi.mock("@/lib/coverage/find-candidates", () => ({
  findCandidatesForShift: vi.fn(async () => ({ candidates: [], escalationStepsChecked: [] })),
}));

// ─── Import SUT after mocks ───────────────────────────────────────────────────

import { PUT } from "@/app/api/staff-leave/[id]/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LEAVE_ID   = "leave-001";
const STAFF_ID   = "staff-001";

const existingLeave = {
  id: LEAVE_ID,
  staffId: STAFF_ID,
  leaveType: "vacation",
  startDate: "2026-04-01",
  endDate: "2026-04-05",
  status: "pending",
  notes: null,
  approvedAt: null,
  approvedBy: null,
  denialReason: null,
  createdAt: "2026-03-01T10:00:00Z",
};

const approvedLeave = { ...existingLeave, status: "approved" };

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/staff-leave/${LEAVE_ID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeParams() {
  return Promise.resolve({ id: LEAVE_ID });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PUT /api/staff-leave/[id] — denial reason validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: leave record found
    mockSelectGet.mockReturnValue(existingLeave);
    // Default: update succeeds
    mockUpdateRetGet.mockReturnValue({ ...existingLeave, status: "denied", denialReason: "No cover available" });
  });

  // ── 400 cases ─────────────────────────────────────────────────────────────

  it("returns 400 when status=denied and denialReason is absent", async () => {
    const res = await PUT(makeRequest({ status: "denied" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(400);
  });

  it("returns 400 when status=denied and denialReason is empty string", async () => {
    const res = await PUT(makeRequest({ status: "denied", denialReason: "" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(400);
  });

  it("returns 400 when status=denied and denialReason is whitespace only", async () => {
    const res = await PUT(makeRequest({ status: "denied", denialReason: "   " }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(400);
  });

  it("returns 400 when status=denied and denialReason is tab/newline only", async () => {
    const res = await PUT(makeRequest({ status: "denied", denialReason: "\t\n" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(400);
  });

  it("includes a descriptive error message in the 400 response", async () => {
    const res = await PUT(makeRequest({ status: "denied" }), { params: makeParams() }) as { _data: { error: string }; status: number };
    expect(res._data.error).toMatch(/denial reason/i);
  });

  it("does not call db.update when validation fails (no DB write on 400)", async () => {
    await PUT(makeRequest({ status: "denied", denialReason: "" }), { params: makeParams() });
    // mockUpdateRetGet would only be called if db.update().returning().get() ran
    expect(mockUpdateRetGet).not.toHaveBeenCalled();
  });

  // ── 200 cases ─────────────────────────────────────────────────────────────

  it("returns 200 when status=denied with a valid denialReason", async () => {
    const res = await PUT(makeRequest({ status: "denied", denialReason: "No cover available" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(200);
  });

  it("returns 200 when status=approved with no denialReason", async () => {
    mockUpdateRetGet.mockReturnValue(approvedLeave);
    const res = await PUT(makeRequest({ status: "approved", approvedBy: "manager" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(200);
  });

  it("returns 200 when status=approved even if a denialReason is accidentally supplied", async () => {
    mockUpdateRetGet.mockReturnValue(approvedLeave);
    const res = await PUT(
      makeRequest({ status: "approved", denialReason: "", approvedBy: "manager" }),
      { params: makeParams() }
    );
    expect((res as { status: number }).status).toBe(200);
  });

  it("returns 200 for a status=pending update with no denialReason", async () => {
    mockUpdateRetGet.mockReturnValue(existingLeave);
    const res = await PUT(makeRequest({ status: "pending" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(200);
  });

  // ── 404 case ──────────────────────────────────────────────────────────────

  it("returns 404 when leave record does not exist", async () => {
    mockSelectGet.mockReturnValue(undefined);
    const res = await PUT(makeRequest({ status: "denied", denialReason: "reason" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(404);
  });

  // ── Denial reason boundary values ─────────────────────────────────────────

  it("accepts a single non-whitespace character as a valid denial reason", async () => {
    const res = await PUT(makeRequest({ status: "denied", denialReason: "x" }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(200);
  });

  it("accepts a reason that is whitespace-padded but has real content", async () => {
    const res = await PUT(makeRequest({ status: "denied", denialReason: "  valid reason  " }), { params: makeParams() });
    expect((res as { status: number }).status).toBe(200);
  });
});
