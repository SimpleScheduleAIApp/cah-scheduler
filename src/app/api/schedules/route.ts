import { db } from "@/db";
import { schedule, shiftDefinition, shift, censusBand } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { buildShiftInserts } from "@/lib/schedules/build-shifts";

export async function GET() {
  const schedules = db
    .select()
    .from(schedule)
    .where(ne(schedule.status, "archived"))
    .orderBy(schedule.startDate)
    .all();
  return NextResponse.json(schedules);
}

export async function POST(request: Request) {
  const body = await request.json();
  const unit = body.unit ?? "ICU";

  const newSchedule = db
    .insert(schedule)
    .values({
      name: body.name,
      startDate: body.startDate,
      endDate: body.endDate,
      unit,
      status: "draft",
      notes: body.notes || null,
    })
    .returning()
    .get();

  // Auto-generate shift instances for every day in the date range
  // using all active shift definitions that belong to this unit.
  const definitions = db
    .select()
    .from(shiftDefinition)
    .where(and(eq(shiftDefinition.unit, unit), eq(shiftDefinition.isActive, true)))
    .all();

  // Seed each new shift with Green tier so the census system works immediately.
  // The manager can change tiers per-shift on the Daily Census page.
  const greenBand = db
    .select()
    .from(censusBand)
    .where(and(eq(censusBand.unit, unit), eq(censusBand.color, "green"), eq(censusBand.isActive, true)))
    .get();

  const inserts = buildShiftInserts(
    newSchedule.id,
    newSchedule.startDate,
    newSchedule.endDate,
    definitions,
    "green",
    greenBand?.id ?? null,
  );
  for (const values of inserts) {
    db.insert(shift).values(values).run();
  }

  return NextResponse.json(
    { ...newSchedule, shiftsCreated: definitions.length > 0 },
    { status: 201 }
  );
}
