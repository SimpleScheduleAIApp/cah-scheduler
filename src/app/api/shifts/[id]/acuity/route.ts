import { db } from "@/db";
import { shift, exceptionLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Update shift acuity level, census, and extra staff requirements
 * POST /api/shifts/[id]/acuity
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db.select().from(shift).where(eq(shift.id, id)).get();

  if (!existing) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  // Build update object
  const updateData: Record<string, unknown> = {};

  if (body.acuityLevel !== undefined) {
    updateData.acuityLevel = body.acuityLevel;
    // When a census tier is set via censusBandId, the band's staffing spec is absolute —
    // clear the extra-staff modifier to prevent double-counting.
    updateData.acuityExtraStaff = body.censusBandId ? 0 : (body.acuityExtraStaff ?? 0);
  }

  if (body.censusBandId !== undefined) {
    updateData.censusBandId = body.censusBandId;
  }

  if (body.sitterCount !== undefined) {
    updateData.sitterCount = body.sitterCount;
  }

  if (body.actualCensus !== undefined) {
    updateData.actualCensus = body.actualCensus;
  }

  const updated = db
    .update(shift)
    .set(updateData)
    .where(eq(shift.id, id))
    .returning()
    .get();

  // Log census tier / acuity change
  if (body.acuityLevel !== undefined && existing.acuityLevel !== body.acuityLevel) {
    db.insert(exceptionLog)
      .values({
        entityType: "shift",
        entityId: id,
        action: "acuity_changed",
        description: `Census tier changed from ${existing.acuityLevel || "none"} to ${body.acuityLevel} for shift on ${existing.date}`,
        previousState: { acuityLevel: existing.acuityLevel, censusBandId: existing.censusBandId },
        newState: { acuityLevel: body.acuityLevel, censusBandId: body.censusBandId },
        performedBy: body.performedBy || "nurse_manager",
      })
      .run();
  }

  // Log census change
  if (body.actualCensus !== undefined && existing.actualCensus !== body.actualCensus) {
    db.insert(exceptionLog)
      .values({
        entityType: "shift",
        entityId: id,
        action: "census_changed",
        description: `Census changed from ${existing.actualCensus ?? "not set"} to ${body.actualCensus} for shift on ${existing.date}`,
        previousState: { actualCensus: existing.actualCensus },
        newState: { actualCensus: body.actualCensus },
        performedBy: body.performedBy || "nurse_manager",
      })
      .run();
  }

  return NextResponse.json(updated);
}
