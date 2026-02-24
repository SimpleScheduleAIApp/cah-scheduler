import { db } from "@/db";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { parseExcelFile, generateTemplate, type ImportResult } from "@/lib/import/parse-excel";
import * as XLSX from "xlsx";

// Fixed schedule ID used as FK anchor for PRN availability imported from Excel.
// The rule engine loads PRN availability across ALL schedules (no scheduleId filter),
// so this ID is only needed to satisfy the FK constraint — it has no scheduling impact.
const PRN_TEMPLATE_SCHEDULE_ID = "00000000-0000-0000-0000-000000000001";

const DAY_NAME_TO_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

/**
 * Expands an array of full day names (e.g. ["Monday", "Wednesday", "Friday"])
 * into a list of specific YYYY-MM-DD date strings for the next 12 months.
 */
function expandPRNDatesToNextYear(dayNames: string[]): string[] {
  if (dayNames.length === 0) return [];
  const allowedDays = new Set(dayNames.map((d) => DAY_NAME_TO_INDEX[d]).filter((i) => i !== undefined));
  const dates: string[] = [];
  const today = new Date();
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 1);
  const cur = new Date(today);
  while (cur <= end) {
    if (allowedDays.has(cur.getDay())) {
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// DELETE all existing data in correct order for FK constraints
function deleteAllData() {
  // Level 1: Tables with most FK dependencies
  db.delete(schema.exceptionLog).run();
  db.delete(schema.scenario).run();
  db.delete(schema.callout).run();
  db.delete(schema.shiftSwapRequest).run();
  db.delete(schema.openShift).run();

  // Level 2: Assignment and related
  db.delete(schema.assignment).run();
  db.delete(schema.staffHolidayAssignment).run();
  db.delete(schema.prnAvailability).run();
  db.delete(schema.staffLeave).run();

  // Level 3: Shift and schedule
  db.delete(schema.shift).run();
  db.delete(schema.shiftDefinition).run();
  db.delete(schema.schedule).run();

  // Level 4: Staff related
  db.delete(schema.staffPreferences).run();
  db.delete(schema.staff).run();

  // Level 5: Configuration tables
  db.delete(schema.censusBand).run();
  db.delete(schema.rule).run();
  db.delete(schema.publicHoliday).run();
  db.delete(schema.unit).run();
}

// Create default shift definitions
function createDefaultShiftDefinitions(units: string[]) {
  const unit = units[0] || "ICU";

  db.insert(schema.shiftDefinition).values({
    name: "Day Shift",
    shiftType: "day",
    startTime: "07:00",
    endTime: "19:00",
    durationHours: 12,
    unit,
    requiredStaffCount: 4,
    requiresChargeNurse: true,
    countsTowardStaffing: true,
  }).run();

  db.insert(schema.shiftDefinition).values({
    name: "Night Shift",
    shiftType: "night",
    startTime: "19:00",
    endTime: "07:00",
    durationHours: 12,
    unit,
    requiredStaffCount: 3,
    requiresChargeNurse: true,
    countsTowardStaffing: true,
  }).run();
}

// Create default rules
function createDefaultRules() {
  const rules = [
    // Hard rules
    { name: "Minimum Staff Per Shift", ruleType: "hard" as const, category: "staffing" as const, description: "Each shift must meet the minimum staff count", parameters: { evaluator: "min-staff" }, weight: 1.0 },
    { name: "Charge Nurse Required", ruleType: "hard" as const, category: "staffing" as const, description: "Shifts requiring a charge nurse must have one assigned", parameters: { evaluator: "charge-nurse" }, weight: 1.0 },
    { name: "Patient-to-Licensed-Staff Ratio", ruleType: "hard" as const, category: "staffing" as const, description: "Patient ratio must not exceed census band limit", parameters: { evaluator: "patient-ratio" }, weight: 1.0 },
    { name: "Minimum Rest Between Shifts", ruleType: "hard" as const, category: "rest" as const, description: "Staff must have minimum 10 hours rest between shifts", parameters: { evaluator: "rest-hours", minRestHours: 10 }, weight: 1.0 },
    { name: "Maximum Consecutive Days", ruleType: "hard" as const, category: "rest" as const, description: "Staff cannot work more than 5 consecutive days", parameters: { evaluator: "max-consecutive", maxConsecutiveDays: 5 }, weight: 1.0 },
    { name: "ICU Competency Minimum", ruleType: "hard" as const, category: "skill" as const, description: "Staff assigned to ICU must have competency level 2+", parameters: { evaluator: "icu-competency", minLevel: 2 }, weight: 1.0 },
    { name: "Level 1 Preceptor Required", ruleType: "hard" as const, category: "skill" as const, description: "Level 1 staff must have Level 5 preceptor on same shift", parameters: { evaluator: "level1-preceptor" }, weight: 1.0 },
    { name: "Level 2 ICU/ER Supervision", ruleType: "hard" as const, category: "skill" as const, description: "Level 2 staff in ICU/ER must have Level 4+ supervision", parameters: { evaluator: "level2-supervision" }, weight: 1.0 },
    { name: "No Overlapping Shifts", ruleType: "hard" as const, category: "rest" as const, description: "Staff cannot be assigned to overlapping shifts", parameters: { evaluator: "no-overlapping-shifts" }, weight: 1.0 },
    { name: "PRN Availability", ruleType: "hard" as const, category: "preference" as const, description: "PRN staff can only be scheduled on available days", parameters: { evaluator: "prn-availability" }, weight: 1.0 },
    { name: "Staff On Leave", ruleType: "hard" as const, category: "preference" as const, description: "Staff with approved leave cannot be scheduled", parameters: { evaluator: "staff-on-leave" }, weight: 1.0 },
    { name: "On-Call Limits", ruleType: "hard" as const, category: "rest" as const, description: "On-call limited per week and weekend per month", parameters: { evaluator: "on-call-limits" }, weight: 1.0 },
    { name: "Maximum 60 Hours in 7 Days", ruleType: "hard" as const, category: "rest" as const, description: "Staff cannot work more than 60 hours in 7 days", parameters: { evaluator: "max-hours-60", maxHours: 60 }, weight: 1.0 },
    // Soft rules
    { name: "Overtime & Extra Hours", ruleType: "soft" as const, category: "cost" as const, description: "Penalty for overtime (>40h) and extra hours", parameters: { evaluator: "overtime-v2", actualOtPenaltyWeight: 1.0, extraHoursPenaltyWeight: 0.3 }, weight: 8.0 },
    { name: "Staff Preference Match", ruleType: "soft" as const, category: "preference" as const, description: "Match staff to their preferred shifts", parameters: { evaluator: "preference-match" }, weight: 5.0 },
    { name: "Weekend Shifts Required", ruleType: "soft" as const, category: "fairness" as const, description: "Staff must work minimum weekend shifts per period", parameters: { evaluator: "weekend-count" }, weight: 7.0 },
    { name: "Consecutive Weekends Penalty", ruleType: "soft" as const, category: "fairness" as const, description: "Penalize >2 consecutive weekends", parameters: { evaluator: "consecutive-weekends" }, weight: 6.0 },
    { name: "Holiday Fairness", ruleType: "soft" as const, category: "fairness" as const, description: "Fair distribution of holiday shifts", parameters: { evaluator: "holiday-fairness" }, weight: 7.0 },
    { name: "Skill Mix Diversity", ruleType: "soft" as const, category: "skill" as const, description: "Each shift should have mix of experience levels", parameters: { evaluator: "skill-mix" }, weight: 3.0 },
    { name: "Minimize Float Assignments", ruleType: "soft" as const, category: "preference" as const, description: "Minimize floating staff to other units", parameters: { evaluator: "float-penalty" }, weight: 4.0 },
    { name: "Charge Nurse Distribution", ruleType: "soft" as const, category: "skill" as const, description: "Distribute charge nurses across shifts", parameters: { evaluator: "charge-clustering" }, weight: 4.0 },
  ];

  for (const r of rules) {
    db.insert(schema.rule).values(r).run();
  }
}

// Create default census bands for a unit
function createDefaultCensusBands(unitName: string) {
  const censusBands = [
    { name: "Low Census", unit: unitName, minPatients: 1, maxPatients: 4, requiredRNs: 2, requiredLPNs: 0, requiredCNAs: 1, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
    { name: "Normal Census", unit: unitName, minPatients: 5, maxPatients: 8, requiredRNs: 3, requiredLPNs: 1, requiredCNAs: 1, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
    { name: "High Census", unit: unitName, minPatients: 9, maxPatients: 10, requiredRNs: 4, requiredLPNs: 1, requiredCNAs: 2, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
    { name: "Critical Census", unit: unitName, minPatients: 11, maxPatients: 12, requiredRNs: 5, requiredLPNs: 1, requiredCNAs: 2, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
  ];

  for (const cb of censusBands) {
    db.insert(schema.censusBand).values(cb).run();
  }
}

// Import data from parsed Excel
function importData(data: ImportResult) {
  // 1. Import units
  for (const u of data.units) {
    db.insert(schema.unit).values({
      name: u.name,
      description: u.description,
      weekendShiftsRequired: u.weekendShiftsRequired,
      holidayShiftsRequired: u.holidayShiftsRequired,
    }).run();
  }

  // 2. Import holidays
  for (const h of data.holidays) {
    db.insert(schema.publicHoliday).values({
      name: h.name,
      date: h.date,
      year: h.year,
    }).run();
  }

  // 3. Import staff and create preferences
  for (const s of data.staff) {
    const newStaff = db.insert(schema.staff).values({
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      phone: s.phone,
      role: s.role,
      employmentType: s.employmentType,
      fte: s.fte,
      hireDate: s.hireDate,
      icuCompetencyLevel: s.icuCompetencyLevel,
      isChargeNurseQualified: s.isChargeNurseQualified,
      certifications: [],
      reliabilityRating: s.reliabilityRating,
      homeUnit: s.homeUnit,
      crossTrainedUnits: s.crossTrainedUnits,
      weekendExempt: s.weekendExempt,
      voluntaryFlexAvailable: s.voluntaryFlexAvailable,
      notes: s.notes,
    }).returning().get();

    // Create staff preferences from imported data
    db.insert(schema.staffPreferences).values({
      staffId: newStaff.id,
      preferredShift: s.preferredShift,
      preferredDaysOff: s.preferredDaysOff,
      maxConsecutiveDays: s.maxConsecutiveDays,
      maxHoursPerWeek: s.maxHoursPerWeek,
      avoidWeekends: s.avoidWeekends,
    }).run();
  }

  // Re-query staff to get their DB-assigned IDs (needed for PRN + leaves below)
  const allImportedStaff = db.select().from(schema.staff).all();
  const staffIdByFullName = new Map(allImportedStaff.map((s) => [`${s.firstName} ${s.lastName}`, s.id]));

  // 3b. Create PRN availability records for per_diem staff that have available days defined.
  //     A lightweight "PRN Import Template" schedule is created once as the FK anchor —
  //     the scheduling engine loads PRN availability from ALL schedules regardless of ID.
  const prnStaff = data.staff.filter(
    (s) => s.employmentType === "per_diem" && s.prnAvailableDays.length > 0
  );
  if (prnStaff.length > 0) {
    const firstUnit = data.units[0]?.name ?? "ICU";
    db.insert(schema.schedule).values({
      id: PRN_TEMPLATE_SCHEDULE_ID,
      name: "PRN Import Template",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      unit: firstUnit,
      status: "archived",
    }).run();

    for (const s of prnStaff) {
      const staffId = staffIdByFullName.get(`${s.firstName} ${s.lastName}`);
      if (!staffId) continue;
      const availableDates = expandPRNDatesToNextYear(s.prnAvailableDays);
      if (availableDates.length === 0) continue;
      db.insert(schema.prnAvailability).values({
        staffId,
        scheduleId: PRN_TEMPLATE_SCHEDULE_ID,
        availableDates,
      }).run();
    }
  }

  // 3c. Import staff leaves
  if (data.leaves.length > 0) {
    const now = new Date().toISOString();
    for (const l of data.leaves) {
      const staffId = staffIdByFullName.get(`${l.firstName} ${l.lastName}`);
      if (!staffId) continue; // Skip if staff not found (name mismatch)
      db.insert(schema.staffLeave).values({
        staffId,
        leaveType: l.leaveType,
        startDate: l.startDate,
        endDate: l.endDate,
        status: l.status,
        reason: l.reason,
        submittedAt: now,
        approvedAt: l.status === "approved" ? now : undefined,
      }).run();
    }
  }

  // 4. Create default shift definitions
  const unitNames = data.units.map(u => u.name);
  createDefaultShiftDefinitions(unitNames);

  // 5. Create default rules
  createDefaultRules();

  // 6. Import census bands or create defaults
  if (data.censusBands && data.censusBands.length > 0) {
    // Import from Excel
    for (const cb of data.censusBands) {
      db.insert(schema.censusBand).values({
        name: cb.name,
        unit: cb.unit,
        minPatients: cb.minPatients,
        maxPatients: cb.maxPatients,
        requiredRNs: cb.requiredRNs,
        requiredLPNs: cb.requiredLPNs,
        requiredCNAs: cb.requiredCNAs,
        requiredChargeNurses: cb.requiredChargeNurses,
        patientToNurseRatio: cb.patientToNurseRatio,
      }).run();
    }
  } else if (unitNames.length > 0) {
    // Create defaults for first unit
    createDefaultCensusBands(unitNames[0]);
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const action = formData.get("action") as string | null;

    // Handle template download
    if (action === "template") {
      const buffer = generateTemplate();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": "attachment; filename=cah-scheduler-template.xlsx",
        },
      });
    }

    // Handle file upload
    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    // Check file type
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return NextResponse.json(
        { success: false, error: "File must be an Excel file (.xlsx or .xls)" },
        { status: 400 }
      );
    }

    // Read file as ArrayBuffer
    const buffer = await file.arrayBuffer();

    // Parse Excel
    const result = parseExcelFile(buffer);

    // Check for validation-only mode
    const validateOnly = formData.get("validateOnly") === "true";
    if (validateOnly) {
      return NextResponse.json({
        success: result.errors.length === 0,
        preview: {
          staff: result.staff.length,
          units: result.units.length,
          holidays: result.holidays.length,
          censusBands: result.censusBands.length,
          leaves: result.leaves.length,
        },
        errors: result.errors,
        warnings: result.warnings,
      });
    }

    // If there are errors, don't import
    if (result.errors.length > 0) {
      return NextResponse.json({
        success: false,
        errors: result.errors,
        warnings: result.warnings,
      }, { status: 400 });
    }

    // Check for minimum data
    if (result.staff.length === 0 && result.units.length === 0 && result.holidays.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No data found to import. Please ensure your Excel file has Staff, Units, or Holidays sheets with data.",
      }, { status: 400 });
    }

    // Delete all existing data
    deleteAllData();

    // Import new data
    importData(result);

    // Return success
    return NextResponse.json({
      success: true,
      imported: {
        staff: result.staff.length,
        units: result.units.length,
        holidays: result.holidays.length,
        censusBands: result.censusBands.length,
        leaves: result.leaves.length,
      },
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "An unexpected error occurred",
    }, { status: 500 });
  }
}

// GET endpoint to export current data as Excel
export async function GET() {
  const buffer = exportCurrentData();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=cah-scheduler-data.xlsx",
    },
  });
}

/**
 * Converts an array of date strings (YYYY-MM-DD) back into a compact day-pattern
 * string suitable for the "PRN Available Days" column (e.g. "Mon, Wed, Fri").
 * Returns empty string if no dates are provided.
 */
function summarisePRNDates(dates: string[]): string {
  if (dates.length === 0) return "";
  const daySet = new Set(dates.map((d) => new Date(d).getDay()));
  const allDays = [0, 1, 2, 3, 4, 5, 6];
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [0, 6];
  if (allDays.every((i) => daySet.has(i))) return "All";
  if (weekdays.every((i) => daySet.has(i)) && !daySet.has(0) && !daySet.has(6)) return "Weekdays";
  if (weekend.every((i) => daySet.has(i)) && daySet.size === 2) return "Weekends";
  const abbrevs = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return allDays.filter((i) => daySet.has(i)).map((i) => abbrevs[i]).join(", ");
}

// Export current database data to Excel
function exportCurrentData(): ArrayBuffer {
  // ── Evening preference migration (idempotent) ────────────────────────────
  // Converts any remaining "evening" preferred_shift values to alternating
  // "day" / "night" before export. Runs once; after migration all evening
  // rows are gone so subsequent calls become a fast no-op.
  const allPrefsForMigration = db.select().from(schema.staffPreferences).all();
  const eveningPrefs = allPrefsForMigration
    .filter((p) => (p.preferredShift as string) === "evening")
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
  for (let i = 0; i < eveningPrefs.length; i++) {
    const newShift: "day" | "night" = i % 2 === 0 ? "day" : "night";
    db.update(schema.staffPreferences)
      .set({ preferredShift: newShift })
      .where(eq(schema.staffPreferences.id, eveningPrefs[i].id))
      .run();
  }

  // Query current data from database (after migration so preferences are clean)
  const staffData = db.select().from(schema.staff).all();
  const staffPreferencesData = db.select().from(schema.staffPreferences).all();
  const prnAvailabilityData = db.select().from(schema.prnAvailability).all();
  const unitsData = db.select().from(schema.unit).all();
  const holidaysData = db.select().from(schema.publicHoliday).all();
  const censusBandsData = db.select().from(schema.censusBand).all();

  // Create a map of staff preferences by staffId for quick lookup
  const preferencesMap = new Map(staffPreferencesData.map(p => [p.staffId, p]));

  // Aggregate PRN availability dates by staffId across all records
  const prnDatesMap = new Map<string, string[]>();
  for (const p of prnAvailabilityData) {
    const existing = prnDatesMap.get(p.staffId) ?? [];
    existing.push(...((p.availableDates as string[]) ?? []));
    prnDatesMap.set(p.staffId, existing);
  }

  const workbook = XLSX.utils.book_new();

  // Staff sheet
  const staffHeaders = [
    "First Name",
    "Last Name",
    "Role",
    "Employment Type",
    "FTE",
    "Home Unit",
    "Cross-Trained Units",
    "Competency Level",
    "Charge Nurse Qualified",
    "Reliability Rating",
    "Email",
    "Phone",
    "Hire Date",
    "Weekend Exempt",
    "VTO Available",
    "Notes",
    "Preferred Shift",
    "Preferred Days Off",
    "Max Consecutive Days",
    "Max Hours Per Week",
    "Avoid Weekends",
    "PRN Available Days",
  ];

  const staffRows = staffData.map((s) => {
    const prefs = preferencesMap.get(s.id);
    const prnDates = prnDatesMap.get(s.id) ?? [];
    return [
      s.firstName,
      s.lastName,
      s.role,
      s.employmentType,
      s.fte,
      s.homeUnit || "",
      (s.crossTrainedUnits || []).join(", "),
      s.icuCompetencyLevel,
      s.isChargeNurseQualified ? "Yes" : "No",
      s.reliabilityRating,
      s.email || "",
      s.phone || "",
      s.hireDate,
      s.weekendExempt ? "Yes" : "No",
      s.voluntaryFlexAvailable ? "Yes" : "No",
      s.notes || "",
      prefs?.preferredShift || "any",
      (prefs?.preferredDaysOff || []).join(", "),
      prefs?.maxConsecutiveDays ?? 3,
      prefs?.maxHoursPerWeek ?? 40,
      prefs?.avoidWeekends ? "Yes" : "No",
      s.employmentType === "per_diem" ? summarisePRNDates(prnDates) : "",
    ];
  });

  const staffSheet = XLSX.utils.aoa_to_sheet([staffHeaders, ...staffRows]);
  XLSX.utils.book_append_sheet(workbook, staffSheet, "Staff");

  // Units sheet
  const unitsHeaders = [
    "Name",
    "Description",
    "Min Staff Day",
    "Min Staff Night",
    "Weekend Shifts Required",
    "Holiday Shifts Required",
  ];

  // For min staff, we'll use a default since it's not stored directly
  // The actual staffing is determined by census bands
  const unitsRows = unitsData.map((u) => [
    u.name,
    u.description || "",
    4, // Default min staff day
    3, // Default min staff night
    u.weekendShiftsRequired,
    u.holidayShiftsRequired,
  ]);

  const unitsSheet = XLSX.utils.aoa_to_sheet([unitsHeaders, ...unitsRows]);
  XLSX.utils.book_append_sheet(workbook, unitsSheet, "Units");

  // Holidays sheet
  const holidaysHeaders = ["Name", "Date"];

  const holidaysRows = holidaysData.map((h) => [
    h.name,
    h.date,
  ]);

  const holidaysSheet = XLSX.utils.aoa_to_sheet([holidaysHeaders, ...holidaysRows]);
  XLSX.utils.book_append_sheet(workbook, holidaysSheet, "Holidays");

  // Census Bands sheet
  const censusBandsHeaders = [
    "Name",
    "Unit",
    "Min Patients",
    "Max Patients",
    "Required RNs",
    "Required LPNs",
    "Required CNAs",
    "Required Charge",
    "Ratio",
  ];

  const censusBandsRows = censusBandsData.map((cb) => [
    cb.name,
    cb.unit,
    cb.minPatients,
    cb.maxPatients,
    cb.requiredRNs,
    cb.requiredLPNs,
    cb.requiredCNAs,
    cb.requiredChargeNurses,
    cb.patientToNurseRatio,
  ]);

  const censusBandsSheet = XLSX.utils.aoa_to_sheet([censusBandsHeaders, ...censusBandsRows]);
  XLSX.utils.book_append_sheet(workbook, censusBandsSheet, "Census Bands");

  // Staff Leave sheet
  const staffLeaveData = db.select().from(schema.staffLeave).all();
  const staffById = new Map(staffData.map((s) => [s.id, s]));

  const staffLeaveHeaders = [
    "First Name",
    "Last Name",
    "Leave Type",
    "Start Date",
    "End Date",
    "Status",
    "Reason",
  ];
  const staffLeaveRows = staffLeaveData.map((l) => {
    const s = staffById.get(l.staffId);
    return [
      s?.firstName ?? "",
      s?.lastName ?? "",
      l.leaveType,
      l.startDate,
      l.endDate,
      l.status,
      l.reason ?? "",
    ];
  });
  const staffLeaveSheet = XLSX.utils.aoa_to_sheet([staffLeaveHeaders, ...staffLeaveRows]);
  XLSX.utils.book_append_sheet(workbook, staffLeaveSheet, "Staff Leave");

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return buffer;
}
