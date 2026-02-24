import { db } from "@/db";
import { callout, assignment, shift, schedule, staff } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit/logger";
import { getEscalationOptions } from "@/lib/callout/escalation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = db.select().from(callout).where(eq(callout.id, id)).get();

  if (!c) {
    return NextResponse.json({ error: "Callout not found" }, { status: 404 });
  }

  // Compute escalation options so callers can open the replacement dialog
  // for an existing open callout without having to re-POST.
  const escalationOptions = getEscalationOptions(c.shiftId, c.staffId);
  const origAssignment = c.assignmentId
    ? db.select({ isChargeNurse: assignment.isChargeNurse })
        .from(assignment)
        .where(eq(assignment.id, c.assignmentId))
        .get()
    : null;
  const chargeNurseRequired = origAssignment?.isChargeNurse === true;

  return NextResponse.json({ ...c, escalationOptions, chargeNurseRequired });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updated = db
    .update(callout)
    .set({
      replacementStaffId: body.replacementStaffId,
      replacementSource: body.replacementSource,
      status: body.status ?? "filled",
      resolvedAt: new Date().toISOString(),
      resolvedBy: body.resolvedBy ?? "nurse_manager",
      escalationStepsTaken: body.escalationStepsTaken,
    })
    .where(eq(callout.id, id))
    .returning()
    .get();

  if (!updated) {
    return NextResponse.json({ error: "Callout not found" }, { status: 404 });
  }

  // Ensure the called-out nurse's original assignment is hidden from the grid.
  // POST /api/callouts already sets this when the callout is first logged, but
  // setting it again here is defensive — covers leave-based or direct-API flows
  // where the original assignment status may not have been updated yet.
  if (updated.assignmentId) {
    db.update(assignment)
      .set({ status: "called_out", updatedAt: new Date().toISOString() })
      .where(eq(assignment.id, updated.assignmentId))
      .run();
  }

  // Create a replacement assignment so the grid shows the new nurse
  if (body.replacementStaffId && updated.shiftId) {
    const shiftRecord = db
      .select({ scheduleId: shift.scheduleId })
      .from(shift)
      .where(eq(shift.id, updated.shiftId))
      .get();

    if (shiftRecord) {
      const schedRecord = db
        .select({ unit: schedule.unit })
        .from(schedule)
        .where(eq(schedule.id, shiftRecord.scheduleId))
        .get();

      const replacementStaff = db
        .select({ homeUnit: staff.homeUnit })
        .from(staff)
        .where(eq(staff.id, body.replacementStaffId))
        .get();

      const shiftUnit = schedRecord?.unit ?? "ICU";
      const staffHomeUnit = replacementStaff?.homeUnit ?? "ICU";
      const isFloat = staffHomeUnit !== shiftUnit;

      db.insert(assignment)
        .values({
          shiftId: updated.shiftId,
          staffId: body.replacementStaffId,
          scheduleId: shiftRecord.scheduleId,
          status: "assigned",
          assignmentSource: "callout_replacement",
          isFloat,
          floatFromUnit: isFloat ? staffHomeUnit : null,
          isChargeNurse: false,
          isOvertime: body.replacementSource === "overtime",
        })
        .run();

      logAuditEvent({
        entityType: "assignment",
        entityId: body.replacementStaffId,
        action: "manual_assignment",
        description: `Replacement assignment created for callout ${id} on shift ${updated.shiftId}`,
        newState: { shiftId: updated.shiftId, assignmentSource: "callout_replacement" },
      });
    }
  }

  logAuditEvent({
    entityType: "callout",
    entityId: id,
    action: "callout_filled",
    description: `Callout filled with replacement staff ${body.replacementStaffId} via ${body.replacementSource}`,
    newState: updated as unknown as Record<string, unknown>,
  });

  return NextResponse.json(updated);
}
