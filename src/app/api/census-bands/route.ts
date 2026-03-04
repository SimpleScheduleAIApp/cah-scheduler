import { db } from "@/db";
import { censusBand } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const bands = db
    .select()
    .from(censusBand)
    .orderBy(censusBand.minPatients)
    .all();
  return NextResponse.json(bands);
}

export async function POST(request: Request) {
  const body = await request.json();

  const newBand = db
    .insert(censusBand)
    .values({
      name: body.name,
      unit: body.unit ?? "ICU",
      color: body.color ?? "green",
      minPatients: body.minPatients,
      maxPatients: body.maxPatients,
      requiredRNs: body.requiredRNs,
      requiredLPNs: body.requiredLPNs ?? 0,
      requiredCNAs: body.requiredCNAs ?? 0,
      requiredChargeNurses: body.requiredChargeNurses ?? 1,
      patientToNurseRatio: body.patientToNurseRatio ?? "2:1",
    })
    .returning()
    .get();

  return NextResponse.json(newBand, { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json();

  if (!body.id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  const updated = db
    .update(censusBand)
    .set({
      name: body.name,
      color: body.color,
      minPatients: body.minPatients,
      maxPatients: body.maxPatients,
      requiredRNs: body.requiredRNs,
      requiredLPNs: body.requiredLPNs,
      requiredCNAs: body.requiredCNAs,
      requiredChargeNurses: body.requiredChargeNurses,
      patientToNurseRatio: body.patientToNurseRatio,
      isActive: body.isActive,
    })
    .where(eq(censusBand.id, body.id))
    .returning()
    .get();

  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  db.delete(censusBand).where(eq(censusBand.id, id)).run();
  return NextResponse.json({ success: true });
}
