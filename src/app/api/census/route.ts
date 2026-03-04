import { db } from "@/db";
import { shift, shiftDefinition } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/census?date=YYYY-MM-DD
 * Returns all shifts for a given date, joined with their shift definition,
 * so the Census page can display shift name/type and current census tier.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "date query param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const shifts = db
    .select({
      id: shift.id,
      date: shift.date,
      acuityLevel: shift.acuityLevel,
      censusBandId: shift.censusBandId,
      shiftType: shiftDefinition.shiftType,
      name: shiftDefinition.name,
      startTime: shiftDefinition.startTime,
      endTime: shiftDefinition.endTime,
      unit: shiftDefinition.unit,
    })
    .from(shift)
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(eq(shift.date, date))
    .orderBy(shiftDefinition.startTime)
    .all();

  return NextResponse.json(shifts);
}
