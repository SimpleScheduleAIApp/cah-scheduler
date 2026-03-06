import { db } from "@/db";
import {
  staff, schedule, shift, assignment, callout, exceptionLog,
  shiftDefinition, censusBand, staffLeave, openShift, prnAvailability, unit,
} from "@/db/schema";
import { eq, desc, inArray, or, and, gt, count, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  // Active staff count
  const activeStaff = db
    .select()
    .from(staff)
    .where(eq(staff.isActive, true))
    .all();

  const totalFTE = activeStaff.reduce((sum, s) => sum + s.fte, 0);

  // Current/latest schedule — exclude archived (e.g. the PRN import template)
  const latestSchedule = db
    .select()
    .from(schedule)
    .where(ne(schedule.status, "archived"))
    .orderBy(desc(schedule.startDate))
    .limit(1)
    .get();

  let understaffedShifts = 0;
  let overstaffedShifts = 0;
  let totalShifts = 0;
  let totalAssignments = 0;
  let totalSlots = 0;

  if (latestSchedule) {
    const shifts = db
      .select({
        id: shift.id,
        requiredStaffCount: shift.requiredStaffCount,
        censusBandId: shift.censusBandId,
        acuityLevel: shift.acuityLevel,
        actualCensus: shift.actualCensus,
        defRequiredStaff: shiftDefinition.requiredStaffCount,
        defUnit: shiftDefinition.unit,
      })
      .from(shift)
      .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
      .where(eq(shift.scheduleId, latestSchedule.id))
      .all();

    totalShifts = shifts.length;

    // Load census bands once — same priority logic as the schedule detail API
    const bands = db.select().from(censusBand).where(eq(censusBand.isActive, true)).all();

    function getEffectiveRequired(
      cbId: string | null,
      acuityLevel: string | null,
      unit: string | null,
      actualCensus: number | null,
      base: number
    ): number {
      if (cbId) {
        const b = bands.find((b) => b.id === cbId);
        if (b) return b.requiredRNs + b.requiredCNAs;
      }
      if (acuityLevel && unit) {
        const b = bands.find((b) => b.color === acuityLevel && b.unit === unit);
        if (b) return b.requiredRNs + b.requiredCNAs;
      }
      if (actualCensus !== null) {
        const b = bands.find((b) => actualCensus >= b.minPatients && actualCensus <= b.maxPatients);
        if (b) return Math.max(b.requiredRNs + b.requiredCNAs, base);
      }
      return base;
    }

    // Load all assignments for this schedule in one query (avoids N+1)
    const shiftIds = shifts.map((s) => s.id);
    const allAssignments = shiftIds.length > 0
      ? db
          .select({ shiftId: assignment.shiftId, status: assignment.status })
          .from(assignment)
          .where(inArray(assignment.shiftId, shiftIds))
          .all()
      : [];

    // Only count active assignments — exclude cancelled (leave) and called_out
    const activeCountByShift = new Map<string, number>();
    for (const a of allAssignments) {
      if (a.status === "cancelled" || a.status === "called_out") continue;
      activeCountByShift.set(a.shiftId, (activeCountByShift.get(a.shiftId) ?? 0) + 1);
    }

    for (const s of shifts) {
      const base = s.requiredStaffCount ?? s.defRequiredStaff;
      const required = getEffectiveRequired(s.censusBandId, s.acuityLevel, s.defUnit, s.actualCensus, base);
      totalSlots += required;
      const assigned = activeCountByShift.get(s.id) ?? 0;
      totalAssignments += assigned;
      if (assigned < required) understaffedShifts++;
      else if (assigned > required) overstaffedShifts++;
    }
  }

  // Open callouts
  const openCallouts = db
    .select()
    .from(callout)
    .where(eq(callout.status, "open"))
    .all();

  // Pending leave requests
  const pendingLeaveCount =
    db.select({ cnt: count() }).from(staffLeave).where(eq(staffLeave.status, "pending")).get()?.cnt ?? 0;

  // Open shifts needing manager action (posted but unfilled)
  const openShiftsCount =
    db
      .select({ cnt: count() })
      .from(openShift)
      .where(or(eq(openShift.status, "pending_approval"), eq(openShift.status, "approved")))
      .get()?.cnt ?? 0;

  // Active units count (for Getting Started checklist)
  const unitsCount =
    db.select({ cnt: count() }).from(unit).where(eq(unit.isActive, true)).get()?.cnt ?? 0;

  // PRN staff who haven't submitted availability for the current schedule
  let prnMissingCount = 0;
  if (latestSchedule) {
    const prnStaff = db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.isActive, true), eq(staff.employmentType, "per_diem")))
      .all();

    // Imported availability uses a fixed template schedule ID, not the actual schedule ID.
    // Match what the PRN Availability page does: check if the staff member has any record at all.
    const submittedIds = new Set(
      db
        .select({ staffId: prnAvailability.staffId })
        .from(prnAvailability)
        .all()
        .map((r) => r.staffId)
    );
    prnMissingCount = prnStaff.filter((s) => !submittedIds.has(s.id)).length;
  }

  // Schedule ending soon: warn if ≤7 days remain AND no next schedule exists yet
  let scheduleEndingSoon: { daysUntilEnd: number } | null = null;
  if (latestSchedule) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(latestSchedule.endDate + "T00:00:00");
    const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilEnd >= 0 && daysUntilEnd <= 7) {
      const nextSchedule = db
        .select({ id: schedule.id })
        .from(schedule)
        .where(gt(schedule.startDate, latestSchedule.endDate))
        .get();
      if (!nextSchedule) {
        scheduleEndingSoon = { daysUntilEnd };
      }
    }
  }

  // Recent audit entries
  const recentAudit = db
    .select()
    .from(exceptionLog)
    .orderBy(desc(exceptionLog.createdAt))
    .limit(10)
    .all();

  return NextResponse.json({
    staffCount: activeStaff.length,
    totalFTE,
    scheduleInfo: latestSchedule
      ? {
          id: latestSchedule.id,
          name: latestSchedule.name,
          status: latestSchedule.status,
          startDate: latestSchedule.startDate,
          endDate: latestSchedule.endDate,
        }
      : null,
    totalShifts,
    totalAssignments,
    totalSlots,
    fillRate: totalSlots > 0 ? Math.round((totalAssignments / totalSlots) * 100) : 0,
    understaffedShifts,
    overstaffedShifts,
    openCallouts: openCallouts.length,
    pendingLeaveCount,
    openShiftsCount,
    prnMissingCount,
    scheduleEndingSoon,
    unitsCount,
    recentAudit,
  });
}
