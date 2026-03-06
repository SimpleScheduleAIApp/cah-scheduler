import { db } from "@/db";
import {
  schedule,
  shift,
  shiftDefinition,
  assignment,
  staff,
  staffLeave,
  callout,
} from "@/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const sched = db.select().from(schedule).where(eq(schedule.id, id)).get();
  if (!sched) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }

  // ── Fetch shifts + assignments ────────────────────────────────────────────
  const shifts = db
    .select({
      id: shift.id,
      date: shift.date,
      defName: shiftDefinition.name,
      defShiftType: shiftDefinition.shiftType,
      defStartTime: shiftDefinition.startTime,
      defEndTime: shiftDefinition.endTime,
    })
    .from(shift)
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(eq(shift.scheduleId, id))
    .orderBy(shift.date, shiftDefinition.shiftType)
    .all();

  const shiftIds = shifts.map((s) => s.id);

  const assignments =
    shiftIds.length === 0
      ? []
      : db
          .select({
            shiftId: assignment.shiftId,
            status: assignment.status,
            isChargeNurse: assignment.isChargeNurse,
            isOvertime: assignment.isOvertime,
            firstName: staff.firstName,
            lastName: staff.lastName,
            role: staff.role,
            staffId: staff.id,
          })
          .from(assignment)
          .innerJoin(staff, eq(assignment.staffId, staff.id))
          .where(
            and(
              eq(assignment.scheduleId, id),
              inArray(assignment.shiftId, shiftIds)
            )
          )
          .all();

  // Group active assignments by shiftId
  const assignmentsByShift = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (a.status === "called_out" || a.status === "cancelled") continue;
    const list = assignmentsByShift.get(a.shiftId) ?? [];
    list.push(a);
    assignmentsByShift.set(a.shiftId, list);
  }

  // ── Fetch leave records overlapping the schedule period ───────────────────
  const leaves = db
    .select({
      firstName: staff.firstName,
      lastName: staff.lastName,
      role: staff.role,
      leaveType: staffLeave.leaveType,
      startDate: staffLeave.startDate,
      endDate: staffLeave.endDate,
      status: staffLeave.status,
    })
    .from(staffLeave)
    .innerJoin(staff, eq(staffLeave.staffId, staff.id))
    .where(
      and(
        lte(staffLeave.startDate, sched.endDate),
        gte(staffLeave.endDate, sched.startDate)
      )
    )
    .orderBy(staffLeave.startDate)
    .all();

  // ── Fetch callouts for shifts in this schedule ────────────────────────────
  const callouts =
    shiftIds.length === 0
      ? []
      : db
          .select({
            shiftId: callout.shiftId,
            reason: callout.reason,
            status: callout.status,
            calledOutAt: callout.calledOutAt,
            staffFirstName: staff.firstName,
            staffLastName: staff.lastName,
          })
          .from(callout)
          .innerJoin(staff, eq(callout.staffId, staff.id))
          .where(inArray(callout.shiftId, shiftIds))
          .all();

  const shiftDateMap = new Map(shifts.map((s) => [s.id, s.date]));
  const shiftTypeMap = new Map(shifts.map((s) => [s.id, s.defName]));

  // ── Build workbook ────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Schedule Grid ────────────────────────────────────────────────
  // Collect all unique shift types (column headers)
  const shiftTypes = Array.from(
    new Set(shifts.map((s) => s.defName))
  ).sort();

  // Collect all unique dates (row keys)
  const dates = Array.from(new Set(shifts.map((s) => s.date))).sort();

  // Build a lookup: date → shiftName → shift id
  const shiftLookup = new Map<string, Map<string, string>>();
  for (const s of shifts) {
    if (!shiftLookup.has(s.date)) shiftLookup.set(s.date, new Map());
    shiftLookup.get(s.date)!.set(s.defName, s.id);
  }

  const gridHeaders = ["Date", "Day", ...shiftTypes];
  const gridRows: (string | number)[][] = [gridHeaders];

  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const date of dates) {
    const dayName = DAY_NAMES[new Date(date + "T00:00:00").getDay()];
    const row: (string | number)[] = [date, dayName];
    for (const st of shiftTypes) {
      const shiftId = shiftLookup.get(date)?.get(st);
      if (!shiftId) {
        row.push("");
        continue;
      }
      const asgns = assignmentsByShift.get(shiftId) ?? [];
      const names = asgns.map((a) => {
        const name = `${a.firstName} ${a.lastName}`;
        return a.isChargeNurse ? `★ ${name}` : name;
      });
      row.push(names.join(", "));
    }
    gridRows.push(row);
  }

  const gridSheet = XLSX.utils.aoa_to_sheet(gridRows);
  // Set column widths
  gridSheet["!cols"] = [
    { wch: 12 }, // Date
    { wch: 5 },  // Day
    ...shiftTypes.map(() => ({ wch: 50 })),
  ];
  XLSX.utils.book_append_sheet(wb, gridSheet, "Schedule Grid");

  // ── Sheet 2: Leave & Callouts ─────────────────────────────────────────────
  const lcHeaders = [
    "Type",
    "Staff Name",
    "Role",
    "Date / Period",
    "Reason",
    "Status",
  ];
  const lcRows: string[][] = [lcHeaders];

  for (const l of leaves) {
    lcRows.push([
      "Leave",
      `${l.firstName} ${l.lastName}`,
      l.role,
      l.startDate === l.endDate ? l.startDate : `${l.startDate} – ${l.endDate}`,
      l.leaveType,
      l.status,
    ]);
  }

  for (const c of callouts) {
    const date = shiftDateMap.get(c.shiftId) ?? "";
    const shiftType = shiftTypeMap.get(c.shiftId) ?? "";
    lcRows.push([
      "Callout",
      `${c.staffFirstName} ${c.staffLastName}`,
      "",
      `${date} (${shiftType})`,
      c.reason,
      c.status,
    ]);
  }

  const lcSheet = XLSX.utils.aoa_to_sheet(lcRows);
  lcSheet["!cols"] = [
    { wch: 10 },
    { wch: 22 },
    { wch: 12 },
    { wch: 28 },
    { wch: 18 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, lcSheet, "Leave & Callouts");

  // ── Sheet 3: Per-Staff List ───────────────────────────────────────────────
  const staffHeaders = [
    "Staff Name",
    "Role",
    "Date",
    "Day",
    "Shift",
    "Start",
    "End",
    "Charge Nurse",
    "Overtime",
  ];
  const staffRows: string[][] = [staffHeaders];

  // Build full shift info map
  const shiftInfoMap = new Map(
    shifts.map((s) => [
      s.id,
      { date: s.date, name: s.defName, start: s.defStartTime, end: s.defEndTime },
    ])
  );

  // Collect all per-staff rows, grouped by staff name
  const staffAssignments = new Map<string, { name: string; role: string; rows: string[][] }>();
  for (const a of assignments) {
    if (a.status === "called_out" || a.status === "cancelled") continue;
    const shiftInfo = shiftInfoMap.get(a.shiftId);
    if (!shiftInfo) continue;
    const key = a.staffId;
    if (!staffAssignments.has(key)) {
      staffAssignments.set(key, {
        name: `${a.firstName} ${a.lastName}`,
        role: a.role,
        rows: [],
      });
    }
    const dayName = DAY_NAMES[new Date(shiftInfo.date + "T00:00:00").getDay()];
    staffAssignments.get(key)!.rows.push([
      `${a.firstName} ${a.lastName}`,
      a.role,
      shiftInfo.date,
      dayName,
      shiftInfo.name,
      shiftInfo.start,
      shiftInfo.end,
      a.isChargeNurse ? "Yes" : "",
      a.isOvertime ? "Yes" : "",
    ]);
  }

  // Sort by staff name, then by date within each staff
  const sortedStaff = Array.from(staffAssignments.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const s of sortedStaff) {
    s.rows.sort((a, b) => a[2].localeCompare(b[2]));
    for (const row of s.rows) staffRows.push(row);
  }

  const staffSheet = XLSX.utils.aoa_to_sheet(staffRows);
  staffSheet["!cols"] = [
    { wch: 22 },
    { wch: 10 },
    { wch: 12 },
    { wch: 6 },
    { wch: 14 },
    { wch: 8 },
    { wch: 8 },
    { wch: 13 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, staffSheet, "Per-Staff List");

  // ── Serialize and return ──────────────────────────────────────────────────
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const fileName = `${sched.name.replace(/[^a-zA-Z0-9-_ ]/g, "")}-schedule.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
