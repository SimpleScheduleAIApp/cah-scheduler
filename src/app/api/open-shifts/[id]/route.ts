import { db } from "@/db";
import { openShift, assignment, shift, exceptionLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = db.select().from(openShift).where(eq(openShift.id, id)).get();

  if (!record) {
    return NextResponse.json({ error: "Open shift not found" }, { status: 404 });
  }

  return NextResponse.json(record);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db.select().from(openShift).where(eq(openShift.id, id)).get();

  if (!existing) {
    return NextResponse.json({ error: "Coverage request not found" }, { status: 404 });
  }

  // ACTION: Approve a recommended candidate
  // This is the main workflow - manager approves one of the top 3 recommendations
  if (body.action === "approve" && body.selectedStaffId) {
    const shiftRecord = db.select().from(shift).where(eq(shift.id, existing.shiftId)).get();

    if (!shiftRecord) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Find the selected candidate in recommendations to get their details
    const recommendations = existing.recommendations as Array<{
      staffId: string;
      staffName: string;
      source: "float" | "per_diem" | "overtime" | "agency";
      isOvertime: boolean;
    }> || [];

    const selectedCandidate = recommendations.find(r => r.staffId === body.selectedStaffId);
    const source = selectedCandidate?.source || body.source || "manual";
    const isOvertime = selectedCandidate?.isOvertime || body.isOvertime || false;

    // Handle agency selection differently - just mark as approved, no assignment
    if (body.selectedStaffId === "agency") {
      const updated = db
        .update(openShift)
        .set({
          status: "approved",
          selectedStaffId: null,
          selectedSource: "agency",
          approvedAt: new Date().toISOString(),
          approvedBy: body.approvedBy || "nurse_manager",
          notes: "Agency approved - awaiting agency confirmation",
        })
        .where(eq(openShift.id, id))
        .returning()
        .get();

      db.insert(exceptionLog)
        .values({
          entityType: "open_shift",
          entityId: id,
          action: "open_shift_filled",
          description: `Coverage approved for agency staff. Requires external agency contact.`,
          previousState: { status: existing.status },
          newState: { status: "approved", selectedSource: "agency" },
          performedBy: body.approvedBy || "nurse_manager",
        })
        .run();

      return NextResponse.json(updated);
    }

    // Create new assignment for the approved staff
    const newAssignment = db
      .insert(assignment)
      .values({
        shiftId: existing.shiftId,
        staffId: body.selectedStaffId,
        scheduleId: shiftRecord.scheduleId,
        isChargeNurse: body.isChargeNurse ?? false,
        isOvertime: isOvertime,
        assignmentSource: source === "float" ? "float" : source === "overtime" ? "manual" : "callout_replacement",
        notes: `Auto-filled from coverage request (original: ${existing.originalStaffId}, source: ${source})`,
      })
      .returning()
      .get();

    // Hide the original nurse's assignment from the schedule grid
    if (existing.originalStaffId) {
      db.update(assignment)
        .set({ status: "called_out", updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(assignment.staffId, existing.originalStaffId),
            eq(assignment.shiftId, existing.shiftId)
          )
        )
        .run();
    }

    // Update coverage request as filled
    const updated = db
      .update(openShift)
      .set({
        status: "filled",
        selectedStaffId: body.selectedStaffId,
        selectedSource: source,
        approvedAt: new Date().toISOString(),
        approvedBy: body.approvedBy || "nurse_manager",
        filledAt: new Date().toISOString(),
        filledByStaffId: body.selectedStaffId,
        filledByAssignmentId: newAssignment.id,
      })
      .where(eq(openShift.id, id))
      .returning()
      .get();

    // Log the approval and fill
    db.insert(exceptionLog)
      .values({
        entityType: "open_shift",
        entityId: id,
        action: "open_shift_filled",
        description: `Coverage approved and filled by ${selectedCandidate?.staffName || body.selectedStaffId} (${source})`,
        previousState: { status: existing.status },
        newState: { status: "filled", filledByStaffId: body.selectedStaffId, source },
        performedBy: body.approvedBy || "nurse_manager",
      })
      .run();

    return NextResponse.json(updated);
  }

  // ACTION: Legacy fill (manual assignment without going through recommendations)
  if (body.action === "fill" && body.filledByStaffId) {
    const shiftRecord = db.select().from(shift).where(eq(shift.id, existing.shiftId)).get();

    if (!shiftRecord) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Create new assignment for the staff filling the shift
    const newAssignment = db
      .insert(assignment)
      .values({
        shiftId: existing.shiftId,
        staffId: body.filledByStaffId,
        scheduleId: shiftRecord.scheduleId,
        isChargeNurse: body.isChargeNurse ?? false,
        isOvertime: body.isOvertime ?? false,
        assignmentSource: "manual",
        notes: `Manually filled from coverage request (original: ${existing.originalStaffId})`,
      })
      .returning()
      .get();

    // Hide the original nurse's assignment from the schedule grid
    if (existing.originalStaffId) {
      db.update(assignment)
        .set({ status: "called_out", updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(assignment.staffId, existing.originalStaffId),
            eq(assignment.shiftId, existing.shiftId)
          )
        )
        .run();
    }

    // Update coverage request as filled
    const updated = db
      .update(openShift)
      .set({
        status: "filled",
        filledAt: new Date().toISOString(),
        filledByStaffId: body.filledByStaffId,
        filledByAssignmentId: newAssignment.id,
      })
      .where(eq(openShift.id, id))
      .returning()
      .get();

    // Log the fill action
    db.insert(exceptionLog)
      .values({
        entityType: "open_shift",
        entityId: id,
        action: "open_shift_filled",
        description: `Coverage manually filled by staff ${body.filledByStaffId}`,
        previousState: { status: existing.status },
        newState: { status: "filled", filledByStaffId: body.filledByStaffId },
        performedBy: body.performedBy || "nurse_manager",
      })
      .run();

    return NextResponse.json(updated);
  }

  // ACTION: Cancel the coverage request
  if (body.action === "cancel") {
    const updated = db
      .update(openShift)
      .set({
        status: "cancelled",
        notes: body.notes || existing.notes,
      })
      .where(eq(openShift.id, id))
      .returning()
      .get();

    db.insert(exceptionLog)
      .values({
        entityType: "open_shift",
        entityId: id,
        action: "open_shift_cancelled",
        description: `Coverage request cancelled`,
        previousState: { status: existing.status },
        newState: { status: "cancelled" },
        performedBy: body.performedBy || "nurse_manager",
      })
      .run();

    return NextResponse.json(updated);
  }

  // General update
  const updated = db
    .update(openShift)
    .set({
      status: body.status ?? existing.status,
      priority: body.priority ?? existing.priority,
      notes: body.notes ?? existing.notes,
    })
    .where(eq(openShift.id, id))
    .returning()
    .get();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  db.delete(openShift).where(eq(openShift.id, id)).run();
  return NextResponse.json({ success: true });
}
