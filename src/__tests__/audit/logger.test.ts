/**
 * Unit tests for src/lib/audit/logger.ts — logAuditEvent
 *
 * Strategy: mock @/db so no real SQLite file is touched.
 * Verify that logAuditEvent forwards all parameters to db.insert().values()
 * and defaults performedBy to "nurse_manager" when omitted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
// vi.hoisted runs before module imports so the factory can reference these vars.

const mockRun = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn(() => ({ run: mockRun })));
const mockInsert = vi.hoisted(() => vi.fn(() => ({ values: mockValues })));

vi.mock("@/db", () => ({ db: { insert: mockInsert } }));
vi.mock("@/db/schema", () => ({ exceptionLog: { _tag: "exceptionLog" } }));

// Import AFTER mocks are registered
import { logAuditEvent } from "@/lib/audit/logger";
import { exceptionLog } from "@/db/schema";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseParams = {
  entityType: "callout" as const,
  entityId: "callout-abc",
  action: "callout_filled" as const,
  description: "Callout filled — Alice assigned via regular",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("logAuditEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.insert with exceptionLog table", () => {
    const { exceptionLog } = await import("@/db/schema");
    logAuditEvent(baseParams);
    expect(mockInsert).toHaveBeenCalledWith(exceptionLog);
  });

  it("passes entityType, entityId, action, description to values()", () => {
    logAuditEvent(baseParams);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "callout",
        entityId: "callout-abc",
        action: "callout_filled",
        description: "Callout filled — Alice assigned via regular",
      })
    );
  });

  it("defaults performedBy to 'nurse_manager' when omitted", () => {
    logAuditEvent(baseParams);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ performedBy: "nurse_manager" })
    );
  });

  it("uses explicit performedBy when provided", () => {
    logAuditEvent({ ...baseParams, performedBy: "system" });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ performedBy: "system" })
    );
  });

  it("passes previousState when provided", () => {
    const previousState = { status: "open" };
    logAuditEvent({ ...baseParams, previousState });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ previousState })
    );
  });

  it("passes newState when provided", () => {
    const newState = { status: "filled", replacementStaffId: "staff-123" };
    logAuditEvent({ ...baseParams, newState });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ newState })
    );
  });

  it("passes overriddenRuleId when provided", () => {
    logAuditEvent({ ...baseParams, overriddenRuleId: "rule-charge-nurse" });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ overriddenRuleId: "rule-charge-nurse" })
    );
  });

  it("passes justification when provided", () => {
    logAuditEvent({ ...baseParams, justification: "No other options available" });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ justification: "No other options available" })
    );
  });

  it("calls .run() on the insert result", () => {
    logAuditEvent(baseParams);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("returns the result of .run()", () => {
    mockRun.mockReturnValueOnce("db-result");
    const result = logAuditEvent(baseParams);
    expect(result).toBe("db-result");
  });

  // ── EntityType coverage ──────────────────────────────────────────────────

  const entityTypes = [
    "assignment", "schedule", "callout", "rule", "staff",
    "scenario", "leave", "swap_request", "unit", "shift", "open_shift",
  ] as const;

  for (const entityType of entityTypes) {
    it(`accepts entityType "${entityType}"`, () => {
      logAuditEvent({ ...baseParams, entityType });
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ entityType })
      );
    });
  }

  // ── Action coverage ──────────────────────────────────────────────────────

  const actions = [
    "created", "updated", "deleted",
    "override_hard_rule", "override_soft_rule",
    "published", "archived",
    "callout_logged", "callout_filled",
    "scenario_selected", "scenario_rejected",
    "swap_requested", "swap_approved", "open_swap_approved", "swap_denied",
    "forced_overtime", "manual_assignment",
    "leave_requested", "leave_approved", "leave_denied",
    "open_shift_created", "open_shift_filled", "open_shift_cancelled",
    "schedule_auto_generated", "scenario_applied",
    "assignment_cancelled_for_leave", "callout_created_for_leave",
    "pull_back", "flex_home", "safe_harbor", "acuity_changed", "census_changed",
    "agency_called",
  ] as const;

  for (const action of actions) {
    it(`accepts action "${action}"`, () => {
      logAuditEvent({ ...baseParams, action });
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({ action })
      );
    });
  }
});
