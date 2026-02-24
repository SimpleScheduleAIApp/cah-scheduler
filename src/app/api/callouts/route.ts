import { db } from "@/db";
import { callout, assignment, staff, shift, shiftDefinition } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit/logger";
import { getEscalationOptions } from "@/lib/callout/escalation";

export async function GET() {
  const callouts = db
    .select({
      id: callout.id,
      assignmentId: callout.assignmentId,
      staffId: callout.staffId,
      shiftId: callout.shiftId,
      reason: callout.reason,
      reasonDetail: callout.reasonDetail,
      calledOutAt: callout.calledOutAt,
      replacementStaffId: callout.replacementStaffId,
      replacementSource: callout.replacementSource,
      status: callout.status,
      resolvedAt: callout.resolvedAt,
      staffFirstName: staff.firstName,
      staffLastName: staff.lastName,
    })
    .from(callout)
    .innerJoin(staff, eq(callout.staffId, staff.id))
    .orderBy(callout.createdAt)
    .all();

  return NextResponse.json(callouts);
}

export async function POST(request: Request) {
  const body = await request.json();

  // Update the assignment status
  db.update(assignment)
    .set({ status: "called_out", updatedAt: new Date().toISOString() })
    .where(eq(assignment.id, body.assignmentId))
    .run();

  const newCallout = db
    .insert(callout)
    .values({
      assignmentId: body.assignmentId,
      staffId: body.staffId,
      shiftId: body.shiftId,
      reason: body.reason,
      reasonDetail: body.reasonDetail || null,
      status: "open",
    })
    .returning()
    .get();

  logAuditEvent({
    entityType: "callout",
    entityId: newCallout.id,
    action: "callout_logged",
    description: `Callout logged for staff ${body.staffId}, reason: ${body.reason}`,
    newState: newCallout as unknown as Record<string, unknown>,
  });

  // Was the called-out assignment a charge nurse slot?
  const origAssignment = db
    .select({ isChargeNurse: assignment.isChargeNurse })
    .from(assignment)
    .where(eq(assignment.id, body.assignmentId))
    .get();
  const chargeNurseRequired = origAssignment?.isChargeNurse === true;

  // Get escalation options (competency-ranked, top 3 + up to 3 ineligible)
  const options = getEscalationOptions(body.shiftId, body.staffId);

  return NextResponse.json(
    { callout: newCallout, escalationOptions: options, chargeNurseRequired },
    { status: 201 }
  );
}
