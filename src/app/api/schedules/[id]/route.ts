import { db } from "@/db";
import {
  schedule,
  shift,
  shiftDefinition,
  assignment,
  staff,
  censusBand,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const sched = db.select().from(schedule).where(eq(schedule.id, id)).get();
  if (!sched) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  // Get all shifts with their definitions
  const shifts = db
    .select({
      id: shift.id,
      date: shift.date,
      shiftDefinitionId: shift.shiftDefinitionId,
      requiredStaffCount: shift.requiredStaffCount,
      requiresChargeNurse: shift.requiresChargeNurse,
      actualCensus: shift.actualCensus,
      censusBandId: shift.censusBandId,
      acuityLevel: shift.acuityLevel,
      acuityExtraStaff: shift.acuityExtraStaff,
      sitterCount: shift.sitterCount,
      notes: shift.notes,
      defName: shiftDefinition.name,
      defShiftType: shiftDefinition.shiftType,
      defStartTime: shiftDefinition.startTime,
      defEndTime: shiftDefinition.endTime,
      defDurationHours: shiftDefinition.durationHours,
      defRequiredStaff: shiftDefinition.requiredStaffCount,
      defRequiresCharge: shiftDefinition.requiresChargeNurse,
      defCountsTowardStaffing: shiftDefinition.countsTowardStaffing,
      defUnit: shiftDefinition.unit,
    })
    .from(shift)
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(eq(shift.scheduleId, id))
    .orderBy(shift.date, shiftDefinition.shiftType)
    .all();

  // Get all assignments for this schedule
  const assignments = db
    .select({
      id: assignment.id,
      shiftId: assignment.shiftId,
      staffId: assignment.staffId,
      status: assignment.status,
      isChargeNurse: assignment.isChargeNurse,
      isOvertime: assignment.isOvertime,
      assignmentSource: assignment.assignmentSource,
      safeHarborInvoked: assignment.safeHarborInvoked,
      isFloat: assignment.isFloat,
      floatFromUnit: assignment.floatFromUnit,
      agencyReason: assignment.agencyReason,
      notes: assignment.notes,
      staffFirstName: staff.firstName,
      staffLastName: staff.lastName,
      staffRole: staff.role,
      staffCompetency: staff.icuCompetencyLevel,
      staffHomeUnit: staff.homeUnit,
    })
    .from(assignment)
    .innerJoin(staff, eq(assignment.staffId, staff.id))
    .where(eq(assignment.scheduleId, id))
    .all();

  // Group assignments by shift; exclude called-out nurses from the grid
  const assignmentsByShift = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (a.status === "called_out") continue;
    const list = assignmentsByShift.get(a.shiftId) ?? [];
    list.push(a);
    assignmentsByShift.set(a.shiftId, list);
  }

  // Get census bands for calculating effective required count
  const censusBands = db
    .select()
    .from(censusBand)
    .where(eq(censusBand.isActive, true))
    .all();

  // Helper to calculate effective required staff based on census tier or patient count.
  // Priority 1: censusBandId direct lookup — use band directly, no Math.max,
  //   so Blue (low census) can legitimately require FEWER staff than the base shift definition.
  // Priority 2: acuityLevel + unit fallback — handles stale censusBandId (e.g. after DB re-seed)
  //   and seeded shifts that have acuityLevel but no censusBandId. Also no Math.max.
  // Priority 3: actualCensus (legacy numeric patient count path) — keeps Math.max so base is floor.
  function getEffectiveRequired(
    censusBandId: string | null,
    acuityLevel: string | null,
    unit: string | null,
    actualCensus: number | null,
    baseRequired: number
  ): number {
    if (censusBandId) {
      const band = censusBands.find((b) => b.id === censusBandId);
      if (band) return band.requiredRNs + band.requiredCNAs;
    }

    // Fallback: match by acuityLevel + unit (handles stale censusBandId or unseeded censusBandId)
    if (acuityLevel && unit) {
      const band = censusBands.find((b) => b.color === acuityLevel && b.unit === unit);
      if (band) return band.requiredRNs + band.requiredCNAs;
    }

    if (actualCensus !== null) {
      const band = censusBands.find(
        (b) => actualCensus >= b.minPatients && actualCensus <= b.maxPatients
      );
      if (band) {
        const censusRequired = band.requiredRNs + band.requiredCNAs;
        return Math.max(censusRequired, baseRequired);
      }
    }

    return baseRequired;
  }

  // Build response
  const shiftsWithAssignments = shifts.map((s) => {
    const baseRequired = s.requiredStaffCount ?? s.defRequiredStaff;
    const effectiveRequired = getEffectiveRequired(
      s.censusBandId, s.acuityLevel, s.defUnit, s.actualCensus, baseRequired
    );

    return {
      id: s.id,
      date: s.date,
      shiftDefinitionId: s.shiftDefinitionId,
      shiftType: s.defShiftType,
      name: s.defName,
      startTime: s.defStartTime,
      endTime: s.defEndTime,
      durationHours: s.defDurationHours,
      requiredStaffCount: effectiveRequired,
      baseRequiredStaffCount: baseRequired,
      requiresChargeNurse: s.requiresChargeNurse ?? s.defRequiresCharge,
      countsTowardStaffing: s.defCountsTowardStaffing,
      actualCensus: s.actualCensus,
      acuityLevel: s.acuityLevel,
      acuityExtraStaff: s.acuityExtraStaff,
      sitterCount: s.sitterCount,
      notes: s.notes,
      assignments: assignmentsByShift.get(s.id) ?? [],
    };
  });

  return NextResponse.json({
    ...sched,
    shifts: shiftsWithAssignments,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updated = db
    .update(schedule)
    .set({
      name: body.name,
      status: body.status,
      notes: body.notes,
      updatedAt: new Date().toISOString(),
      publishedAt: body.status === "published" ? new Date().toISOString() : undefined,
    })
    .where(eq(schedule.id, id))
    .returning()
    .get();

  return NextResponse.json(updated);
}
