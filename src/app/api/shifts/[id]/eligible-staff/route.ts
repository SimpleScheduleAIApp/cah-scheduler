import { NextResponse } from "next/server";
import { buildContext } from "@/lib/engine/rule-engine";
import { SchedulerState } from "@/lib/engine/scheduler/state";
import { passesHardRules, getRejectionReasons } from "@/lib/engine/scheduler/eligibility";
import type { SchedulerContext } from "@/lib/engine/scheduler/types";
import type { StaffInfo } from "@/lib/engine/rules/types";

/**
 * GET /api/shifts/[id]/eligible-staff?scheduleId=xxx
 *
 * Returns all active staff with an `eligible` flag, `ineligibleReasons` array,
 * and scheduling context (weekly hours, FTE target, OT risk, preferences).
 *
 * Staff already assigned to this shift are included with `alreadyAssigned: true`
 * so the assignment dialog can enrich the "Currently Assigned" section with the
 * same context shown for available staff.
 *
 * Eligible non-assigned staff are shown first, sorted by charge-qualified,
 * reliability, then competency.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: shiftId } = await params;
  const url = new URL(request.url);
  const scheduleId = url.searchParams.get("scheduleId");

  if (!scheduleId) {
    return NextResponse.json({ error: "scheduleId is required" }, { status: 400 });
  }

  // Build full rule context — fetches staff, shifts, all assignments, PRN, leaves, etc.
  const ruleContext = buildContext(scheduleId);
  const shiftInfo = ruleContext.shiftMap.get(shiftId);

  if (!shiftInfo) {
    return NextResponse.json({ error: "Shift not found in schedule" }, { status: 404 });
  }

  // Capture date after null guard so closures can reference it without TS narrowing issues
  const shiftDate = shiftInfo.date;

  // Wrap into SchedulerContext (same data, slightly different shape)
  const context: SchedulerContext = {
    scheduleId,
    shifts: [...ruleContext.shiftMap.values()],
    staffList: [...ruleContext.staffMap.values()],
    staffMap: ruleContext.staffMap,
    prnAvailability: ruleContext.prnAvailability,
    staffLeaves: ruleContext.staffLeaves,
    unitConfig: ruleContext.unitConfig,
    scheduleUnit: ruleContext.scheduleUnit,
    publicHolidays: ruleContext.publicHolidays,
  };

  // Populate SchedulerState from ALL current assignments for this schedule.
  // AssignmentInfo has all the same fields as AssignmentDraft so we can add directly.
  const state = new SchedulerState();
  for (const a of ruleContext.assignments) {
    state.addAssignment({
      shiftId: a.shiftId,
      staffId: a.staffId,
      date: a.date,
      shiftType: a.shiftType,
      startTime: a.startTime,
      endTime: a.endTime,
      durationHours: a.durationHours,
      unit: a.unit,
      isChargeNurse: a.isChargeNurse,
      isOvertime: a.isOvertime,
      isFloat: a.isFloat,
      floatFromUnit: a.floatFromUnit,
    });
  }

  // IDs of staff already on this specific shift
  const assignedToShift = new Set(
    ruleContext.assignments.filter((a) => a.shiftId === shiftId).map((a) => a.staffId)
  );

  // Scheduling context fields — shared shape for both assigned and non-assigned staff
  function staffContext(s: StaffInfo) {
    return {
      weeklyHours: state.getWeeklyHours(s.id, shiftDate),
      standardWeeklyHours: Math.round(Math.min(s.fte * 40, 40) * 10) / 10,
      preferredShift: s.preferences?.preferredShift ?? null,
      preferredDaysOff: s.preferences?.preferredDaysOff ?? [],
      avoidWeekends: s.preferences?.avoidWeekends ?? false,
    };
  }

  // Already-assigned staff: include with context but skip eligibility check.
  // weeklyHours already includes this shift since it is in state.
  const assignedResults = [...ruleContext.staffMap.values()]
    .filter((s) => s.isActive && assignedToShift.has(s.id))
    .map((s) => {
      const ctx = staffContext(s);
      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        role: s.role,
        employmentType: s.employmentType,
        icuCompetencyLevel: s.icuCompetencyLevel,
        isChargeNurseQualified: s.isChargeNurseQualified,
        reliabilityRating: s.reliabilityRating,
        isActive: s.isActive,
        eligible: false,
        alreadyAssigned: true,
        ineligibleReasons: [],
        wouldCauseOT: false, // not applicable — already assigned
        ...ctx,
      };
    });

  // Evaluate each active staff member NOT already on this shift
  const results = [...ruleContext.staffMap.values()]
    .filter((s) => s.isActive && !assignedToShift.has(s.id))
    .map((s) => {
      const eligible = passesHardRules(s, shiftInfo, state, context);
      const ineligibleReasons = eligible ? [] : getRejectionReasons(s, shiftInfo, state, context);
      const ctx = staffContext(s);
      const wouldCauseOT = ctx.weeklyHours + shiftInfo.durationHours > 40;

      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        role: s.role,
        employmentType: s.employmentType,
        icuCompetencyLevel: s.icuCompetencyLevel,
        isChargeNurseQualified: s.isChargeNurseQualified,
        reliabilityRating: s.reliabilityRating,
        isActive: s.isActive,
        eligible,
        alreadyAssigned: false,
        ineligibleReasons,
        // Scheduling context — helps manager make an informed assignment decision
        wouldCauseOT,
        ...ctx,
      };
    });

  // Sort non-assigned: eligible first, then charge-qualified, reliability, competency
  results.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.isChargeNurseQualified !== b.isChargeNurseQualified)
      return a.isChargeNurseQualified ? -1 : 1;
    if (a.reliabilityRating !== b.reliabilityRating)
      return b.reliabilityRating - a.reliabilityRating;
    return b.icuCompetencyLevel - a.icuCompetencyLevel;
  });

  // Assigned staff come first so the dialog can separate them by flag, not position
  return NextResponse.json([...assignedResults, ...results]);
}
