import * as XLSX from "xlsx";

// Types for imported data
export interface StaffImport {
  firstName: string;
  lastName: string;
  role: "RN" | "LPN" | "CNA";
  employmentType: "full_time" | "part_time" | "per_diem" | "float" | "agency";
  fte: number;
  homeUnit: string | null;
  crossTrainedUnits: string[];
  icuCompetencyLevel: number;
  isChargeNurseQualified: boolean;
  reliabilityRating: number;
  email: string | null;
  phone: string | null;
  hireDate: string;
  weekendExempt: boolean;
  voluntaryFlexAvailable: boolean;
  notes: string | null;
  // Staff preferences
  preferredShift: "day" | "night" | "any";
  preferredDaysOff: string[];
  maxConsecutiveDays: number;
  maxHoursPerWeek: number;
  avoidWeekends: boolean;
  /**
   * Days of week this PRN/per_diem staff is generally available.
   * Full day names: "Sunday", "Monday", …, "Saturday".
   * Empty for non-per_diem staff.
   */
  prnAvailableDays: string[];
}

export interface UnitImport {
  name: string;
  description: string | null;
  minStaffDay: number;
  minStaffNight: number;
  weekendShiftsRequired: number;
  holidayShiftsRequired: number;
}

export interface HolidayImport {
  name: string;
  date: string;
  year: number;
}

export interface CensusBandImport {
  name: string;
  unit: string;
  minPatients: number;
  maxPatients: number;
  requiredRNs: number;
  requiredLPNs: number;
  requiredCNAs: number;
  requiredChargeNurses: number;
  patientToNurseRatio: string;
}

export interface LeaveImport {
  firstName: string;
  lastName: string;
  leaveType: "vacation" | "sick" | "maternity" | "medical" | "personal" | "bereavement" | "other";
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "denied";
  reason: string | null;
}

export interface ValidationError {
  sheet: string;
  row: number;
  message: string;
}

export interface ValidationWarning {
  sheet: string;
  row: number;
  message: string;
}

export interface ImportResult {
  staff: StaffImport[];
  units: UnitImport[];
  holidays: HolidayImport[];
  censusBands: CensusBandImport[];
  leaves: LeaveImport[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// Valid enum values
const VALID_ROLES = ["RN", "LPN", "CNA"];
const VALID_EMPLOYMENT_TYPES = ["full_time", "part_time", "per_diem", "float", "agency"];
const VALID_PREFERRED_SHIFTS = ["day", "night", "any"];
const VALID_LEAVE_TYPES = ["vacation", "sick", "maternity", "medical", "personal", "bereavement", "other"];
const VALID_LEAVE_STATUSES = ["pending", "approved", "denied"];
const VALID_DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// Helper to parse Yes/No to boolean
function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    return lower === "yes" || lower === "true" || lower === "1";
  }
  return false;
}

// Helper to parse number with default
function parseNumber(value: unknown, defaultValue: number, min?: number, max?: number): number {
  if (value === undefined || value === null || value === "") return defaultValue;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(num)) return defaultValue;
  if (min !== undefined && num < min) return min;
  if (max !== undefined && num > max) return max;
  return num;
}

// Helper to parse comma-separated list
function parseCommaSeparated(value: unknown): string[] {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Helper to format date to YYYY-MM-DD
function formatDate(value: unknown): string {
  if (!value) return new Date().toISOString().split("T")[0];

  // If it's an Excel date number
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
  }

  // If it's a string, try to parse it
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Check if it's already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    // Try to parse other formats
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  }

  return new Date().toISOString().split("T")[0];
}

// Map abbreviated and full day names to full capitalized day names
const PRN_DAY_ABBREV_MAP: Record<string, string> = {
  sun: "Sunday", sunday: "Sunday",
  mon: "Monday", monday: "Monday",
  tue: "Tuesday", tuesday: "Tuesday",
  wed: "Wednesday", wednesday: "Wednesday",
  thu: "Thursday", thursday: "Thursday",
  fri: "Friday", friday: "Friday",
  sat: "Saturday", saturday: "Saturday",
};

/**
 * Parse the "PRN Available Days" cell value into an array of full day names.
 * Accepts: "All", "Weekdays", "Weekends", or a comma-separated list of
 * abbreviated or full day names (e.g. "Mon, Wed, Fri" or "Monday, Friday").
 */
function parsePRNAvailableDays(value: unknown): string[] {
  if (!value || typeof value !== "string") return [];
  const raw = value.trim().toLowerCase();
  if (!raw) return [];
  if (raw === "all") return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (raw === "weekdays") return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  if (raw === "weekends") return ["Saturday", "Sunday"];
  return raw
    .split(",")
    .map((d) => PRN_DAY_ABBREV_MAP[d.trim()])
    .filter((d): d is string => d !== undefined);
}

// Helper to normalize employment type
function normalizeEmploymentType(value: string): string {
  const lower = value.toLowerCase().trim().replace(/[\s-]/g, "_");
  // Map common variations
  const mappings: Record<string, string> = {
    "fulltime": "full_time",
    "full_time": "full_time",
    "parttime": "part_time",
    "part_time": "part_time",
    "per_diem": "per_diem",
    "perdiem": "per_diem",
    "prn": "per_diem",
    "float": "float",
    "float_pool": "float",
    "agency": "agency",
  };
  return mappings[lower] || lower;
}

// Parse Staff sheet
function parseStaffSheet(
  sheet: XLSX.WorkSheet,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): StaffImport[] {
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const staff: StaffImport[] = [];

  data.forEach((row, index) => {
    const rowNum = index + 2; // Excel rows are 1-indexed, plus header row

    // Get values with flexible column name matching
    const firstName = String(row["First Name"] ?? row["FirstName"] ?? row["first_name"] ?? "").trim();
    const lastName = String(row["Last Name"] ?? row["LastName"] ?? row["last_name"] ?? "").trim();
    const role = String(row["Role"] ?? row["role"] ?? "").toUpperCase().trim();
    const employmentTypeRaw = String(row["Employment Type"] ?? row["EmploymentType"] ?? row["employment_type"] ?? "");
    const employmentType = normalizeEmploymentType(employmentTypeRaw);

    // Validate required fields
    if (!firstName) {
      errors.push({ sheet: "Staff", row: rowNum, message: "First Name is required" });
      return;
    }
    if (!lastName) {
      errors.push({ sheet: "Staff", row: rowNum, message: "Last Name is required" });
      return;
    }
    if (!role || !VALID_ROLES.includes(role)) {
      errors.push({ sheet: "Staff", row: rowNum, message: `Invalid Role "${role}". Must be RN, LPN, or CNA` });
      return;
    }
    if (!employmentType || !VALID_EMPLOYMENT_TYPES.includes(employmentType)) {
      errors.push({ sheet: "Staff", row: rowNum, message: `Invalid Employment Type "${employmentTypeRaw}". Must be full_time, part_time, per_diem, float, or agency` });
      return;
    }

    // Parse optional fields
    const fte = parseNumber(row["FTE"] ?? row["fte"], 1.0, 0, 1);
    const homeUnit = String(row["Home Unit"] ?? row["HomeUnit"] ?? row["home_unit"] ?? "").trim() || null;
    const crossTrainedUnits = parseCommaSeparated(row["Cross-Trained Units"] ?? row["CrossTrainedUnits"] ?? row["cross_trained_units"]);
    const competencyLevel = parseNumber(row["Competency Level"] ?? row["CompetencyLevel"] ?? row["competency_level"] ?? row["ICU Competency Level"], 3, 1, 5);
    const isChargeNurseQualified = parseBoolean(row["Charge Nurse Qualified"] ?? row["ChargeNurseQualified"] ?? row["charge_nurse_qualified"]);
    const reliabilityRating = parseNumber(row["Reliability Rating"] ?? row["ReliabilityRating"] ?? row["reliability_rating"], 3, 1, 5);
    const email = String(row["Email"] ?? row["email"] ?? "").trim() || null;
    const phone = String(row["Phone"] ?? row["phone"] ?? "").trim() || null;
    const hireDate = formatDate(row["Hire Date"] ?? row["HireDate"] ?? row["hire_date"]);
    const weekendExempt = parseBoolean(row["Weekend Exempt"] ?? row["WeekendExempt"] ?? row["weekend_exempt"]);
    const voluntaryFlexAvailable = parseBoolean(row["VTO Available"] ?? row["VTOAvailable"] ?? row["vto_available"] ?? row["Voluntary Flex Available"]);
    const notes = String(row["Notes"] ?? row["notes"] ?? "").trim() || null;

    // Parse staff preference fields
    const preferredShiftRaw = String(row["Preferred Shift"] ?? row["PreferredShift"] ?? row["preferred_shift"] ?? "any").toLowerCase().trim();
    const preferredShift = VALID_PREFERRED_SHIFTS.includes(preferredShiftRaw) ? preferredShiftRaw : "any";

    // Parse preferred days off - comma-separated list of day names
    const preferredDaysOffRaw = parseCommaSeparated(row["Preferred Days Off"] ?? row["PreferredDaysOff"] ?? row["preferred_days_off"]);
    const preferredDaysOff = preferredDaysOffRaw
      .map(day => {
        const normalized = day.toLowerCase().trim();
        // Find matching day and return properly capitalized version
        const validDay = VALID_DAYS_OF_WEEK.find(d => d === normalized);
        return validDay ? validDay.charAt(0).toUpperCase() + validDay.slice(1) : null;
      })
      .filter((day): day is string => day !== null);

    const maxConsecutiveDays = parseNumber(row["Max Consecutive Days"] ?? row["MaxConsecutiveDays"] ?? row["max_consecutive_days"], 3, 1, 7);
    const maxHoursPerWeek = parseNumber(row["Max Hours Per Week"] ?? row["MaxHoursPerWeek"] ?? row["max_hours_per_week"], 40, 8, 60);
    const avoidWeekends = parseBoolean(row["Avoid Weekends"] ?? row["AvoidWeekends"] ?? row["avoid_weekends"]);

    // PRN available days — only relevant for per_diem employment type
    const prnAvailableDays =
      employmentType === "per_diem"
        ? parsePRNAvailableDays(row["PRN Available Days"] ?? row["PRNAvailableDays"] ?? row["prn_available_days"])
        : [];

    // Add warnings for missing optional data
    if (!homeUnit) {
      warnings.push({ sheet: "Staff", row: rowNum, message: `No Home Unit specified for ${firstName} ${lastName}` });
    }

    staff.push({
      firstName,
      lastName,
      role: role as "RN" | "LPN" | "CNA",
      employmentType: employmentType as StaffImport["employmentType"],
      fte,
      homeUnit,
      crossTrainedUnits,
      icuCompetencyLevel: competencyLevel,
      isChargeNurseQualified,
      reliabilityRating,
      email,
      phone,
      hireDate,
      weekendExempt,
      voluntaryFlexAvailable,
      notes,
      // Staff preferences
      preferredShift: preferredShift as StaffImport["preferredShift"],
      preferredDaysOff,
      maxConsecutiveDays,
      maxHoursPerWeek,
      avoidWeekends,
      prnAvailableDays,
    });
  });

  return staff;
}

// Parse Units sheet
function parseUnitsSheet(
  sheet: XLSX.WorkSheet,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): UnitImport[] {
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const units: UnitImport[] = [];

  data.forEach((row, index) => {
    const rowNum = index + 2;

    const name = String(row["Name"] ?? row["name"] ?? row["Unit Name"] ?? "").trim();
    const description = String(row["Description"] ?? row["description"] ?? "").trim() || null;
    const minStaffDay = parseNumber(row["Min Staff Day"] ?? row["MinStaffDay"] ?? row["min_staff_day"], 0);
    const minStaffNight = parseNumber(row["Min Staff Night"] ?? row["MinStaffNight"] ?? row["min_staff_night"], 0);
    const weekendShiftsRequired = parseNumber(row["Weekend Shifts Required"] ?? row["WeekendShiftsRequired"], 3, 0);
    const holidayShiftsRequired = parseNumber(row["Holiday Shifts Required"] ?? row["HolidayShiftsRequired"], 1, 0);

    // Validate required fields
    if (!name) {
      errors.push({ sheet: "Units", row: rowNum, message: "Name is required" });
      return;
    }
    if (minStaffDay <= 0) {
      errors.push({ sheet: "Units", row: rowNum, message: "Min Staff Day must be greater than 0" });
      return;
    }
    if (minStaffNight <= 0) {
      errors.push({ sheet: "Units", row: rowNum, message: "Min Staff Night must be greater than 0" });
      return;
    }

    units.push({
      name,
      description,
      minStaffDay,
      minStaffNight,
      weekendShiftsRequired,
      holidayShiftsRequired,
    });
  });

  return units;
}

// Parse Holidays sheet
function parseHolidaysSheet(
  sheet: XLSX.WorkSheet,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): HolidayImport[] {
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const holidays: HolidayImport[] = [];

  data.forEach((row, index) => {
    const rowNum = index + 2;

    const name = String(row["Name"] ?? row["name"] ?? row["Holiday Name"] ?? "").trim();
    const dateRaw = row["Date"] ?? row["date"];

    // Validate required fields
    if (!name) {
      errors.push({ sheet: "Holidays", row: rowNum, message: "Name is required" });
      return;
    }
    if (!dateRaw) {
      errors.push({ sheet: "Holidays", row: rowNum, message: "Date is required" });
      return;
    }

    const date = formatDate(dateRaw);
    const year = parseInt(date.split("-")[0], 10);

    if (isNaN(year)) {
      errors.push({ sheet: "Holidays", row: rowNum, message: `Invalid date format: ${dateRaw}` });
      return;
    }

    holidays.push({
      name,
      date,
      year,
    });
  });

  return holidays;
}

// Parse Census Bands sheet
function parseCensusBandsSheet(
  sheet: XLSX.WorkSheet,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): CensusBandImport[] {
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const bands: CensusBandImport[] = [];

  data.forEach((row, index) => {
    const rowNum = index + 2;

    const name = String(row["Name"] ?? row["name"] ?? row["Band Name"] ?? "").trim();
    const unit = String(row["Unit"] ?? row["unit"] ?? "ICU").trim();
    const minPatients = parseNumber(row["Min Patients"] ?? row["MinPatients"] ?? row["min_patients"], 0);
    const maxPatients = parseNumber(row["Max Patients"] ?? row["MaxPatients"] ?? row["max_patients"], 0);
    const requiredRNs = parseNumber(row["Required RNs"] ?? row["RequiredRNs"] ?? row["required_rns"], 1);
    const requiredLPNs = parseNumber(row["Required LPNs"] ?? row["RequiredLPNs"] ?? row["required_lpns"], 0);
    const requiredCNAs = parseNumber(row["Required CNAs"] ?? row["RequiredCNAs"] ?? row["required_cnas"], 0);
    const requiredChargeNurses = parseNumber(row["Required Charge"] ?? row["RequiredCharge"] ?? row["required_charge_nurses"], 1);
    const patientToNurseRatio = String(row["Ratio"] ?? row["Patient Ratio"] ?? row["patient_to_nurse_ratio"] ?? "2:1").trim();

    // Validate required fields
    if (!name) {
      errors.push({ sheet: "Census Bands", row: rowNum, message: "Name is required" });
      return;
    }
    if (minPatients < 0) {
      errors.push({ sheet: "Census Bands", row: rowNum, message: "Min Patients must be >= 0" });
      return;
    }
    if (maxPatients < minPatients) {
      errors.push({ sheet: "Census Bands", row: rowNum, message: "Max Patients must be >= Min Patients" });
      return;
    }

    bands.push({
      name,
      unit,
      minPatients,
      maxPatients,
      requiredRNs,
      requiredLPNs,
      requiredCNAs,
      requiredChargeNurses,
      patientToNurseRatio,
    });
  });

  return bands;
}

// Parse Staff Leave sheet
function parseLeaves(
  sheet: XLSX.WorkSheet,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): LeaveImport[] {
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const leaves: LeaveImport[] = [];

  data.forEach((row, index) => {
    const rowNum = index + 2;

    const firstName = String(row["First Name"] ?? row["FirstName"] ?? row["first_name"] ?? "").trim();
    const lastName = String(row["Last Name"] ?? row["LastName"] ?? row["last_name"] ?? "").trim();
    const leaveTypeRaw = String(row["Leave Type"] ?? row["LeaveType"] ?? row["leave_type"] ?? "").toLowerCase().trim();
    const startDateRaw = row["Start Date"] ?? row["StartDate"] ?? row["start_date"];
    const endDateRaw = row["End Date"] ?? row["EndDate"] ?? row["end_date"];
    const statusRaw = String(row["Status"] ?? row["status"] ?? "pending").toLowerCase().trim();
    const reason = String(row["Reason"] ?? row["reason"] ?? "").trim() || null;

    if (!firstName) {
      errors.push({ sheet: "Staff Leave", row: rowNum, message: "First Name is required" });
      return;
    }
    if (!lastName) {
      errors.push({ sheet: "Staff Leave", row: rowNum, message: "Last Name is required" });
      return;
    }
    if (!leaveTypeRaw || !VALID_LEAVE_TYPES.includes(leaveTypeRaw)) {
      errors.push({ sheet: "Staff Leave", row: rowNum, message: `Invalid Leave Type "${leaveTypeRaw}". Must be one of: ${VALID_LEAVE_TYPES.join(", ")}` });
      return;
    }
    if (!startDateRaw) {
      errors.push({ sheet: "Staff Leave", row: rowNum, message: "Start Date is required" });
      return;
    }
    if (!endDateRaw) {
      errors.push({ sheet: "Staff Leave", row: rowNum, message: "End Date is required" });
      return;
    }

    const status: LeaveImport["status"] = VALID_LEAVE_STATUSES.includes(statusRaw)
      ? (statusRaw as LeaveImport["status"])
      : "pending";
    if (!VALID_LEAVE_STATUSES.includes(statusRaw)) {
      warnings.push({ sheet: "Staff Leave", row: rowNum, message: `Unknown status "${statusRaw}", defaulting to "pending"` });
    }

    leaves.push({
      firstName,
      lastName,
      leaveType: leaveTypeRaw as LeaveImport["leaveType"],
      startDate: formatDate(startDateRaw),
      endDate: formatDate(endDateRaw),
      status,
      reason,
    });
  });

  return leaves;
}

// Main parse function
export function parseExcelFile(buffer: ArrayBuffer): ImportResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Read the workbook
  const workbook = XLSX.read(buffer, { type: "array" });

  // Get sheet names
  const sheetNames = workbook.SheetNames;

  // Find sheets (case-insensitive)
  const staffSheetName = sheetNames.find((n) => n.toLowerCase() === "staff");
  const unitsSheetName = sheetNames.find((n) => n.toLowerCase() === "units");
  const holidaysSheetName = sheetNames.find((n) => n.toLowerCase() === "holidays");
  const censusBandsSheetName = sheetNames.find((n) => n.toLowerCase() === "census bands" || n.toLowerCase() === "censusbands");
  const leavesSheetName = sheetNames.find((n) => n.toLowerCase() === "staff leave" || n.toLowerCase() === "staffleave" || n.toLowerCase() === "leaves");

  // Parse each sheet
  let staff: StaffImport[] = [];
  let units: UnitImport[] = [];
  let holidays: HolidayImport[] = [];
  let censusBands: CensusBandImport[] = [];
  let leaves: LeaveImport[] = [];

  if (staffSheetName) {
    staff = parseStaffSheet(workbook.Sheets[staffSheetName], errors, warnings);
  } else {
    warnings.push({ sheet: "Staff", row: 0, message: "No 'Staff' sheet found - no staff will be imported" });
  }

  if (unitsSheetName) {
    units = parseUnitsSheet(workbook.Sheets[unitsSheetName], errors, warnings);
  } else {
    warnings.push({ sheet: "Units", row: 0, message: "No 'Units' sheet found - no units will be imported" });
  }

  if (holidaysSheetName) {
    holidays = parseHolidaysSheet(workbook.Sheets[holidaysSheetName], errors, warnings);
  } else {
    warnings.push({ sheet: "Holidays", row: 0, message: "No 'Holidays' sheet found - no holidays will be imported" });
  }

  if (censusBandsSheetName) {
    censusBands = parseCensusBandsSheet(workbook.Sheets[censusBandsSheetName], errors, warnings);
  }
  // Census bands are optional - if not provided, defaults will be created

  // Staff Leave sheet is optional - silently skip if not present (backwards compatible)
  if (leavesSheetName) {
    leaves = parseLeaves(workbook.Sheets[leavesSheetName], errors, warnings);
  }

  return {
    staff,
    units,
    holidays,
    censusBands,
    leaves,
    errors,
    warnings,
  };
}

// Generate a sample Excel template
export function generateTemplate(): ArrayBuffer {
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
  // Full-time example — PRN Available Days left blank (not applicable)
  const staffExampleFT = [
    "Maria",
    "Garcia",
    "RN",
    "full_time",
    "1.0",
    "ICU",
    "ER, Med-Surg",
    "4",
    "Yes",
    "5",
    "maria.garcia@hospital.com",
    "555-0101",
    "2020-01-15",
    "No",
    "No",
    "Senior charge nurse",
    "day",
    "Saturday, Sunday",
    "4",
    "40",
    "No",
    "", // PRN Available Days — not used for full_time
  ];
  // PRN/per_diem example — shows accepted formats: day names, "Weekdays", "Weekends", or "All"
  const staffExamplePRN = [
    "Patricia",
    "Clark",
    "RN",
    "per_diem",
    "0.0",
    "ICU",
    "",
    "3",
    "No",
    "4",
    "patricia.clark@hospital.com",
    "555-0201",
    "2023-03-01",
    "No",
    "No",
    "PRN — available Mon/Wed/Fri",
    "any",
    "",
    "3",
    "40",
    "No",
    "Mon, Wed, Fri", // PRN Available Days — comma-separated day abbreviations
  ];
  const staffSheet = XLSX.utils.aoa_to_sheet([staffHeaders, staffExampleFT, staffExamplePRN]);
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
  const unitsExample = [
    "ICU",
    "Intensive Care Unit - 12 bed critical care",
    "4",
    "3",
    "3",
    "1",
  ];
  const unitsSheet = XLSX.utils.aoa_to_sheet([unitsHeaders, unitsExample]);
  XLSX.utils.book_append_sheet(workbook, unitsSheet, "Units");

  // Holidays sheet
  const holidaysHeaders = ["Name", "Date"];
  const holidaysExamples = [
    ["New Year's Day", "2026-01-01"],
    ["Christmas Day", "2026-12-25"],
  ];
  const holidaysSheet = XLSX.utils.aoa_to_sheet([holidaysHeaders, ...holidaysExamples]);
  XLSX.utils.book_append_sheet(workbook, holidaysSheet, "Holidays");

  // Staff Leave sheet — 7 sample rows, one per leave type, spanning March–June 2026
  const staffLeaveHeaders = [
    "First Name",
    "Last Name",
    "Leave Type",
    "Start Date",
    "End Date",
    "Status",
    "Reason",
  ];
  const staffLeaveExamples = [
    ["Maria",    "Garcia",   "vacation",    "2026-03-09", "2026-03-13", "approved", "Spring break"],
    ["Patricia", "Clark",    "sick",        "2026-03-23", "2026-03-24", "approved", "Flu"],
    ["Sarah",    "Johnson",  "maternity",   "2026-04-01", "2026-06-30", "approved", "Maternity leave"],
    ["Michael",  "Brown",    "medical",     "2026-04-20", "2026-04-24", "pending",  "Scheduled procedure"],
    ["Jennifer", "Davis",    "personal",    "2026-05-04", "2026-05-04", "pending",  "Family event"],
    ["Robert",   "Wilson",   "bereavement", "2026-05-18", "2026-05-20", "approved", "Bereavement"],
    ["Lisa",     "Martinez", "other",       "2026-06-08", "2026-06-09", "pending",  "Other reason"],
  ];
  const staffLeaveSheet = XLSX.utils.aoa_to_sheet([staffLeaveHeaders, ...staffLeaveExamples]);
  XLSX.utils.book_append_sheet(workbook, staffLeaveSheet, "Staff Leave");

  // Generate buffer
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return buffer;
}
