import { db } from "@/db";
import { exceptionLog } from "@/db/schema";

type EntityType = "assignment" | "schedule" | "callout" | "rule" | "staff" | "scenario"
  | "leave" | "swap_request" | "unit" | "shift" | "open_shift";
type Action =
  | "created" | "updated" | "deleted"
  | "override_hard_rule" | "override_soft_rule"
  | "published" | "archived"
  | "callout_logged" | "callout_filled"
  | "scenario_selected" | "scenario_rejected"
  | "swap_requested" | "swap_approved" | "open_swap_approved" | "swap_denied"
  | "forced_overtime" | "manual_assignment"
  | "leave_requested" | "leave_approved" | "leave_denied"
  | "open_shift_created" | "open_shift_filled" | "open_shift_cancelled"
  | "schedule_auto_generated" | "scenario_applied"
  | "assignment_cancelled_for_leave" | "callout_created_for_leave"
  | "pull_back" | "flex_home" | "safe_harbor" | "acuity_changed" | "census_changed"
  | "agency_called";

export function logAuditEvent(params: {
  entityType: EntityType;
  entityId: string;
  action: Action;
  description: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  overriddenRuleId?: string;
  justification?: string;
  performedBy?: string;
}) {
  return db.insert(exceptionLog).values({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    description: params.description,
    previousState: params.previousState,
    newState: params.newState,
    overriddenRuleId: params.overriddenRuleId,
    justification: params.justification,
    performedBy: params.performedBy ?? "nurse_manager",
    createdAt: new Date().toISOString(),
  }).run();
}
