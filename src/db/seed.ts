import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import { addDays, format, subDays } from "date-fns";

const dbPath = path.join(process.cwd(), "cah-scheduler.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

function uuid() {
  return crypto.randomUUID();
}

async function seed() {
  console.log("Seeding database with comprehensive test data...\n");

  // Clear existing data in FK-safe order.
  // open_shift.filledByAssignmentId and originalStaffId have no ON DELETE CASCADE,
  // so open_shift must be deleted before assignment and staff.
  // generation_job and staff_holiday_assignment are also deleted explicitly
  // before their parent tables to avoid any cascade ambiguity.
  sqlite.exec(`
    DELETE FROM exception_log;
    DELETE FROM generation_job;
    DELETE FROM scenario;
    DELETE FROM open_shift;
    DELETE FROM callout;
    DELETE FROM shift_swap_request;
    DELETE FROM staff_holiday_assignment;
    DELETE FROM assignment;
    DELETE FROM shift;
    DELETE FROM schedule;
    DELETE FROM prn_availability;
    DELETE FROM staff_leave;
    DELETE FROM rule;
    DELETE FROM census_band;
    DELETE FROM shift_definition;
    DELETE FROM staff_preferences;
    DELETE FROM staff;
    DELETE FROM public_holiday;
    DELETE FROM unit;
  `);

  // ============================================================
  // UNIT CONFIGURATION
  // ============================================================
  const icuUnitId = uuid();
  db.insert(schema.unit).values({
    id: icuUnitId,
    name: "ICU",
    description: "Intensive Care Unit - 12 bed critical care",
    weekendRuleType: "count_per_period",
    weekendShiftsRequired: 3,
    schedulePeriodWeeks: 6,
    holidayShiftsRequired: 1,
    escalationSequence: ["float", "per_diem", "overtime", "agency"],
    acuityYellowExtraStaff: 1,
    acuityRedExtraStaff: 2,
    lowCensusOrder: ["voluntary", "overtime", "per_diem", "full_time"],
    otApprovalThreshold: 4,
    maxOnCallPerWeek: 1,
    maxOnCallWeekendsPerMonth: 1,
    maxConsecutiveWeekends: 2,
  }).run();

  const erUnitId = uuid();
  db.insert(schema.unit).values({
    id: erUnitId,
    name: "ER",
    description: "Emergency Room - 24/7 emergency services",
    weekendRuleType: "count_per_period",
    weekendShiftsRequired: 3,
    schedulePeriodWeeks: 6,
    holidayShiftsRequired: 1,
    escalationSequence: ["float", "per_diem", "overtime", "agency"],
    acuityYellowExtraStaff: 1,
    acuityRedExtraStaff: 2,
    lowCensusOrder: ["voluntary", "overtime", "per_diem", "full_time"],
    otApprovalThreshold: 4,
    maxOnCallPerWeek: 1,
    maxOnCallWeekendsPerMonth: 1,
    maxConsecutiveWeekends: 2,
  }).run();

  const medSurgUnitId = uuid();
  db.insert(schema.unit).values({
    id: medSurgUnitId,
    name: "Med-Surg",
    description: "Medical-Surgical Unit - General patient care",
    weekendRuleType: "count_per_period",
    weekendShiftsRequired: 3,
    schedulePeriodWeeks: 6,
    holidayShiftsRequired: 1,
    escalationSequence: ["float", "per_diem", "overtime", "agency"],
    acuityYellowExtraStaff: 1,
    acuityRedExtraStaff: 2,
    lowCensusOrder: ["voluntary", "overtime", "per_diem", "full_time"],
    otApprovalThreshold: 4,
    maxOnCallPerWeek: 2,
    maxOnCallWeekendsPerMonth: 2,
    maxConsecutiveWeekends: 2,
  }).run();

  console.log("✓ Created 3 unit configurations (ICU, ER, Med-Surg)");

  // ============================================================
  // PUBLIC HOLIDAYS (2026)
  // ============================================================
  const holidays = [
    { name: "New Year's Day", date: "2026-01-01", year: 2026 },
    { name: "Martin Luther King Jr. Day", date: "2026-01-19", year: 2026 },
    { name: "Presidents' Day", date: "2026-02-16", year: 2026 },
    { name: "Memorial Day", date: "2026-05-25", year: 2026 },
    { name: "Independence Day", date: "2026-07-04", year: 2026 },
    { name: "Labor Day", date: "2026-09-07", year: 2026 },
    { name: "Thanksgiving", date: "2026-11-26", year: 2026 },
    { name: "Christmas Eve", date: "2026-12-24", year: 2026 },
    { name: "Christmas Day", date: "2026-12-25", year: 2026 },
  ];

  for (const h of holidays) {
    db.insert(schema.publicHoliday).values({ id: uuid(), ...h }).run();
  }
  console.log(`✓ Created ${holidays.length} public holidays`);

  // ============================================================
  // STAFF (33 staff members - realistic mix)
  // ============================================================
  const staffData = [
    // === ICU STAFF (12 members) ===
    // Expert/Charge RNs (Level 5)
    { id: uuid(), firstName: "Maria", lastName: "Garcia", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2018-03-15", icuCompetencyLevel: 5, isChargeNurseQualified: true, reliabilityRating: 5, certifications: ["CCRN", "BLS", "ACLS", "TNCC"], email: "maria.garcia@cah.local", phone: "512-555-0101", homeUnit: "ICU", crossTrainedUnits: ["ER"], weekendExempt: false },
    { id: uuid(), firstName: "James", lastName: "Wilson", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2019-06-01", icuCompetencyLevel: 5, isChargeNurseQualified: true, reliabilityRating: 5, certifications: ["CCRN", "BLS", "ACLS", "TNCC"], email: "james.wilson@cah.local", phone: "512-555-0102", homeUnit: "ICU", crossTrainedUnits: ["ER"], weekendExempt: false },
    // Proficient RNs (Level 4)
    { id: uuid(), firstName: "Sarah", lastName: "Chen", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2020-01-10", icuCompetencyLevel: 4, isChargeNurseQualified: true, reliabilityRating: 4, certifications: ["BLS", "ACLS", "PALS", "TNCC"], email: "sarah.chen@cah.local", phone: "512-555-0103", homeUnit: "ICU", crossTrainedUnits: ["ER"], weekendExempt: false },
    { id: uuid(), firstName: "Michael", lastName: "Brown", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2020-08-20", icuCompetencyLevel: 4, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS", "TNCC"], email: "michael.brown@cah.local", phone: "512-555-0104", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    // Competent RNs (Level 3)
    { id: uuid(), firstName: "Emily", lastName: "Davis", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2021-02-14", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS", "PALS"], email: "emily.davis@cah.local", phone: "512-555-0105", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    { id: uuid(), firstName: "David", lastName: "Martinez", role: "RN" as const, employmentType: "full_time" as const, fte: 0.9, hireDate: "2021-09-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS", "ACLS"], email: "david.martinez@cah.local", phone: "512-555-0106", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    { id: uuid(), firstName: "Lisa", lastName: "Anderson", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2022-03-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS"], email: "lisa.anderson@cah.local", phone: "512-555-0107", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    // Advanced Beginner RN (Level 2)
    { id: uuid(), firstName: "Ashley", lastName: "Johnson", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2023-04-15", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS"], email: "ashley.johnson@cah.local", phone: "512-555-0108", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    // Orientee RN (Level 1) - Needs preceptor
    { id: uuid(), firstName: "Robert", lastName: "Taylor", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2025-12-01", icuCompetencyLevel: 1, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS"], email: "robert.taylor@cah.local", phone: "512-555-0109", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "New grad orientee - requires Level 5 preceptor" },
    // ICU LPN
    { id: uuid(), firstName: "Jessica", lastName: "Rodriguez", role: "LPN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2022-06-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["LPN", "BLS"], email: "jessica.rodriguez@cah.local", phone: "512-555-0110", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    // ICU CNAs
    { id: uuid(), firstName: "Jennifer", lastName: "White", role: "CNA" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2021-03-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 5, certifications: ["CNA", "BLS"], email: "jennifer.white@cah.local", phone: "512-555-0111", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    { id: uuid(), firstName: "Daniel", lastName: "Harris", role: "CNA" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2023-07-15", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["CNA", "BLS"], email: "daniel.harris@cah.local", phone: "512-555-0112", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },

    // === PART-TIME STAFF (4 members) ===
    { id: uuid(), firstName: "Kevin", lastName: "Thomas", role: "RN" as const, employmentType: "part_time" as const, fte: 0.5, hireDate: "2020-11-01", icuCompetencyLevel: 4, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS"], email: "kevin.thomas@cah.local", phone: "512-555-0113", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Works Fri-Sun only" },
    { id: uuid(), firstName: "Rachel", lastName: "Moore", role: "RN" as const, employmentType: "part_time" as const, fte: 0.6, hireDate: "2021-05-20", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS"], email: "rachel.moore@cah.local", phone: "512-555-0114", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    { id: uuid(), firstName: "Steven", lastName: "Lee", role: "RN" as const, employmentType: "part_time" as const, fte: 0.5, hireDate: "2022-02-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS"], email: "steven.lee@cah.local", phone: "512-555-0115", homeUnit: "ICU", crossTrainedUnits: ["Med-Surg"], weekendExempt: false },
    { id: uuid(), firstName: "Michelle", lastName: "King", role: "CNA" as const, employmentType: "part_time" as const, fte: 0.5, hireDate: "2023-01-15", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["CNA", "BLS"], email: "michelle.king@cah.local", phone: "512-555-0116", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },

    // === PER DIEM / PRN STAFF (4 members) ===
    { id: uuid(), firstName: "Patricia", lastName: "Clark", role: "RN" as const, employmentType: "per_diem" as const, fte: 0.0, hireDate: "2020-09-01", icuCompetencyLevel: 4, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS"], email: "patricia.clark@cah.local", phone: "512-555-0117", homeUnit: "ICU", crossTrainedUnits: ["ER"], weekendExempt: false, notes: "Retired RN, picks up 2-3 shifts/month" },
    { id: uuid(), firstName: "Mark", lastName: "Lewis", role: "RN" as const, employmentType: "per_diem" as const, fte: 0.0, hireDate: "2021-12-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS", "ACLS"], email: "mark.lewis@cah.local", phone: "512-555-0118", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Works weekends only" },
    { id: uuid(), firstName: "Nancy", lastName: "Hall", role: "RN" as const, employmentType: "per_diem" as const, fte: 0.0, hireDate: "2022-06-15", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS"], email: "nancy.hall@cah.local", phone: "512-555-0119", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    { id: uuid(), firstName: "Thomas", lastName: "Young", role: "CNA" as const, employmentType: "per_diem" as const, fte: 0.0, hireDate: "2023-03-01", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["CNA", "BLS"], email: "thomas.young@cah.local", phone: "512-555-0120", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },

    // === FLOAT POOL (3 members) ===
    { id: uuid(), firstName: "Amanda", lastName: "Walker", role: "RN" as const, employmentType: "float" as const, fte: 1.0, hireDate: "2021-02-01", icuCompetencyLevel: 4, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS", "PALS"], email: "amanda.walker@cah.local", phone: "512-555-0121", homeUnit: null, crossTrainedUnits: ["ICU", "ER", "Med-Surg"], weekendExempt: false, notes: "Float pool - highly flexible" },
    { id: uuid(), firstName: "Christopher", lastName: "Allen", role: "RN" as const, employmentType: "float" as const, fte: 1.0, hireDate: "2022-05-15", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS", "ACLS"], email: "chris.allen@cah.local", phone: "512-555-0122", homeUnit: null, crossTrainedUnits: ["ICU", "ER", "Med-Surg"], weekendExempt: false, notes: "Float pool" },
    { id: uuid(), firstName: "Stephanie", lastName: "Scott", role: "CNA" as const, employmentType: "float" as const, fte: 1.0, hireDate: "2023-01-01", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["CNA", "BLS"], email: "stephanie.scott@cah.local", phone: "512-555-0123", homeUnit: null, crossTrainedUnits: ["ICU", "ER", "Med-Surg"], weekendExempt: false, notes: "Float pool CNA" },

    // === AGENCY STAFF (3 members) ===
    { id: uuid(), firstName: "Brian", lastName: "Turner", role: "RN" as const, employmentType: "agency" as const, fte: 0.0, hireDate: "2026-01-15", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["BLS", "ACLS"], email: "brian.turner@agency.com", phone: "512-555-0124", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Agency - 13-week contract ending March 2026" },
    { id: uuid(), firstName: "Kimberly", lastName: "Phillips", role: "RN" as const, employmentType: "agency" as const, fte: 0.0, hireDate: "2026-01-20", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 2, certifications: ["BLS"], email: "kim.phillips@agency.com", phone: "512-555-0125", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Agency - temporary coverage" },
    { id: uuid(), firstName: "Jason", lastName: "Campbell", role: "CNA" as const, employmentType: "agency" as const, fte: 0.0, hireDate: "2026-02-01", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["CNA", "BLS"], email: "jason.campbell@agency.com", phone: "512-555-0126", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Agency CNA" },

    // === STAFF WITH SPECIAL STATUS (2 members) ===
    { id: uuid(), firstName: "Elizabeth", lastName: "Mitchell", role: "RN" as const, employmentType: "full_time" as const, fte: 0.8, hireDate: "2019-07-01", icuCompetencyLevel: 4, isChargeNurseQualified: true, reliabilityRating: 5, certifications: ["CCRN", "BLS", "ACLS"], email: "elizabeth.mitchell@cah.local", phone: "512-555-0127", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: true, notes: "Weekend exempt - ADA accommodation for childcare" },
    { id: uuid(), firstName: "William", lastName: "Roberts", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2020-04-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 2, certifications: ["BLS", "ACLS"], email: "william.roberts@cah.local", phone: "512-555-0128", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Frequent callouts - on performance improvement plan", flexHoursYearToDate: 24 },

    // === 5 ADDITIONAL STAFF (filling coverage gaps) ===
    // Night charge backup — Level 4, charge qualified (James Wilson is the only night charge; this gives resilience)
    { id: uuid(), firstName: "Sophia", lastName: "Patel", role: "RN" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2020-05-12", icuCompetencyLevel: 4, isChargeNurseQualified: true, reliabilityRating: 4, certifications: ["CCRN", "BLS", "ACLS"], email: "sophia.patel@cah.local", phone: "512-555-0129", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "Night charge backup - Level 4" },
    // Second LPN (part-time) — only Jessica Rodriguez is an LPN; adds shift flexibility
    { id: uuid(), firstName: "Marcus", lastName: "Thompson", role: "LPN" as const, employmentType: "part_time" as const, fte: 0.6, hireDate: "2022-08-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["LPN", "BLS", "ACLS"], email: "marcus.thompson@cah.local", phone: "512-555-0130", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
    // All-days PRN RN — available any day; useful when multiple staff call out
    { id: uuid(), firstName: "Olivia", lastName: "Bennett", role: "RN" as const, employmentType: "per_diem" as const, fte: 0.0, hireDate: "2023-09-01", icuCompetencyLevel: 3, isChargeNurseQualified: false, reliabilityRating: 4, certifications: ["BLS", "ACLS"], email: "olivia.bennett@cah.local", phone: "512-555-0131", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false, notes: "PRN - available all days" },
    // Charge-qualified float RN — adds a charge-nurse option to the float pool
    { id: uuid(), firstName: "Carlos", lastName: "Rivera", role: "RN" as const, employmentType: "float" as const, fte: 1.0, hireDate: "2021-07-15", icuCompetencyLevel: 4, isChargeNurseQualified: true, reliabilityRating: 5, certifications: ["CCRN", "BLS", "ACLS", "PALS"], email: "carlos.rivera@cah.local", phone: "512-555-0132", homeUnit: null, crossTrainedUnits: ["ICU", "ER", "Med-Surg"], weekendExempt: false, notes: "Float pool - charge qualified, covers all units" },
    // Extra CNA (full-time) — Yellow/Red census tiers require 2 CNAs; currently only 2 FT CNAs exist
    { id: uuid(), firstName: "Natalie", lastName: "Brooks", role: "CNA" as const, employmentType: "full_time" as const, fte: 1.0, hireDate: "2024-01-08", icuCompetencyLevel: 2, isChargeNurseQualified: false, reliabilityRating: 3, certifications: ["CNA", "BLS"], email: "natalie.brooks@cah.local", phone: "512-555-0133", homeUnit: "ICU", crossTrainedUnits: [], weekendExempt: false },
  ];

  for (const s of staffData) {
    db.insert(schema.staff).values({
      id: s.id,
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
      certifications: s.certifications,
      reliabilityRating: s.reliabilityRating,
      homeUnit: s.homeUnit,
      crossTrainedUnits: s.crossTrainedUnits,
      weekendExempt: s.weekendExempt,
      flexHoursYearToDate: s.flexHoursYearToDate ?? 0,
      notes: s.notes,
    }).run();
  }
  console.log(`✓ Created ${staffData.length} staff members`);

  // Create staff preferences
  const shiftPrefs = ["day", "night", "evening", "any"] as const;
  for (let i = 0; i < staffData.length; i++) {
    const s = staffData[i];
    db.insert(schema.staffPreferences).values({
      staffId: s.id,
      preferredShift: shiftPrefs[i % 4],
      maxHoursPerWeek: s.employmentType === "per_diem" ? 24 : s.fte * 40,
      maxConsecutiveDays: s.employmentType === "per_diem" ? 2 : 4,
      preferredDaysOff: i % 3 === 0 ? ["Sunday"] : i % 3 === 1 ? ["Saturday"] : [],
      avoidWeekends: s.weekendExempt,
    }).run();
  }
  console.log(`✓ Created ${staffData.length} staff preferences`);

  // ============================================================
  // SHIFT DEFINITIONS
  // ============================================================
  const dayShiftId = uuid();
  const nightShiftId = uuid();
  const eveningShiftId = uuid();
  const onCallShiftId = uuid();

  db.insert(schema.shiftDefinition).values({ id: dayShiftId, name: "Day Shift", shiftType: "day", startTime: "07:00", endTime: "19:00", durationHours: 12, unit: "ICU", requiredStaffCount: 4, requiresChargeNurse: true, countsTowardStaffing: true }).run();
  db.insert(schema.shiftDefinition).values({ id: nightShiftId, name: "Night Shift", shiftType: "night", startTime: "19:00", endTime: "07:00", durationHours: 12, unit: "ICU", requiredStaffCount: 3, requiresChargeNurse: true, countsTowardStaffing: true }).run();
  db.insert(schema.shiftDefinition).values({ id: eveningShiftId, name: "Evening Shift", shiftType: "evening", startTime: "13:00", endTime: "01:00", durationHours: 12, unit: "ICU", requiredStaffCount: 3, requiresChargeNurse: true, countsTowardStaffing: true }).run();
  db.insert(schema.shiftDefinition).values({ id: onCallShiftId, name: "On-Call", shiftType: "on_call", startTime: "19:00", endTime: "07:00", durationHours: 12, unit: "ICU", requiredStaffCount: 1, requiresChargeNurse: false, countsTowardStaffing: false }).run();

  console.log("✓ Created 4 shift definitions");

  // ============================================================
  // CENSUS BANDS
  // ============================================================
  const censusBands: { id: string; name: string; color: "blue" | "green" | "yellow" | "red"; unit: string; minPatients: number; maxPatients: number; requiredRNs: number; requiredLPNs: number; requiredCNAs: number; requiredChargeNurses: number; patientToNurseRatio: string }[] = [
    // RN counts satisfy strict 2:1 RN:patient ratio at the TOP of each tier's range.
    // requiredLPNs = 0: ICU scope-of-practice prevents LPN substitution for RNs.
    // requiredChargeNurses = 1: display/documentation only; included in the RN count (not extra).
    { id: uuid(), name: "Low Census",      color: "blue",   unit: "ICU", minPatients: 1,  maxPatients: 4,  requiredRNs: 2, requiredLPNs: 0, requiredCNAs: 1, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
    { id: uuid(), name: "Normal Census",   color: "green",  unit: "ICU", minPatients: 5,  maxPatients: 8,  requiredRNs: 4, requiredLPNs: 0, requiredCNAs: 1, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
    { id: uuid(), name: "High Census",     color: "yellow", unit: "ICU", minPatients: 9,  maxPatients: 10, requiredRNs: 5, requiredLPNs: 0, requiredCNAs: 2, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
    { id: uuid(), name: "Critical Census", color: "red",    unit: "ICU", minPatients: 11, maxPatients: 12, requiredRNs: 6, requiredLPNs: 0, requiredCNAs: 2, requiredChargeNurses: 1, patientToNurseRatio: "2:1" },
  ];

  for (const cb of censusBands) {
    db.insert(schema.censusBand).values(cb).run();
  }
  console.log(`✓ Created ${censusBands.length} census bands`);

  // Build a color → band ID map so shifts can reference the correct band
  const bandIdByColor: Record<string, string> = {};
  for (const cb of censusBands) {
    bandIdByColor[cb.color] = cb.id;
  }

  // ============================================================
  // RULES
  // ============================================================
  const rules = [
    // Hard rules
    { id: uuid(), name: "Minimum Staff Per Shift", ruleType: "hard" as const, category: "staffing" as const, description: "Each shift must meet the minimum staff count", parameters: { evaluator: "min-staff" }, weight: 1.0 },
    { id: uuid(), name: "Charge Nurse Required", ruleType: "hard" as const, category: "staffing" as const, description: "Shifts requiring a charge nurse must have one assigned", parameters: { evaluator: "charge-nurse" }, weight: 1.0 },
    { id: uuid(), name: "Patient-to-Nurse Ratio", ruleType: "hard" as const, category: "staffing" as const, description: "RN:patient ratio must not exceed census band limit (2:1 ICU standard)", parameters: { evaluator: "patient-ratio" }, weight: 1.0 },
    { id: uuid(), name: "Minimum Rest Between Shifts", ruleType: "hard" as const, category: "rest" as const, description: "Staff must have minimum 10 hours rest between shifts", parameters: { evaluator: "rest-hours", minRestHours: 10 }, weight: 1.0 },
    { id: uuid(), name: "Maximum Consecutive Days", ruleType: "hard" as const, category: "rest" as const, description: "Staff cannot work more than 5 consecutive days", parameters: { evaluator: "max-consecutive", maxConsecutiveDays: 5 }, weight: 1.0 },
    { id: uuid(), name: "ICU Competency Minimum", ruleType: "hard" as const, category: "skill" as const, description: "Staff assigned to ICU must have competency level 2+", parameters: { evaluator: "icu-competency", minLevel: 2 }, weight: 1.0 },
    { id: uuid(), name: "Level 1 Preceptor Required", ruleType: "hard" as const, category: "skill" as const, description: "Level 1 staff must have Level 5 preceptor on same shift", parameters: { evaluator: "level1-preceptor" }, weight: 1.0 },
    { id: uuid(), name: "Level 2 ICU/ER Supervision", ruleType: "hard" as const, category: "skill" as const, description: "Level 2 staff in ICU/ER must have Level 4+ supervision", parameters: { evaluator: "level2-supervision" }, weight: 1.0 },
    { id: uuid(), name: "No Overlapping Shifts", ruleType: "hard" as const, category: "rest" as const, description: "Staff cannot be assigned to overlapping shifts", parameters: { evaluator: "no-overlapping-shifts" }, weight: 1.0 },
    { id: uuid(), name: "PRN Availability", ruleType: "hard" as const, category: "preference" as const, description: "PRN staff can only be scheduled on available days", parameters: { evaluator: "prn-availability" }, weight: 1.0 },
    { id: uuid(), name: "Staff On Leave", ruleType: "hard" as const, category: "preference" as const, description: "Staff with approved leave cannot be scheduled", parameters: { evaluator: "staff-on-leave" }, weight: 1.0 },
    { id: uuid(), name: "On-Call Limits", ruleType: "hard" as const, category: "rest" as const, description: "On-call limited per week and weekend per month", parameters: { evaluator: "on-call-limits" }, weight: 1.0 },
    { id: uuid(), name: "Maximum 60 Hours in 7 Days", ruleType: "hard" as const, category: "rest" as const, description: "Staff cannot work more than 60 hours in 7 days", parameters: { evaluator: "max-hours-60", maxHours: 60 }, weight: 1.0 },
    // Soft rules
    { id: uuid(), name: "Overtime & Extra Hours", ruleType: "soft" as const, category: "cost" as const, description: "Penalty for overtime (>40h) and extra hours", parameters: { evaluator: "overtime-v2", actualOtPenaltyWeight: 1.0, extraHoursPenaltyWeight: 0.3 }, weight: 8.0 },
    { id: uuid(), name: "Staff Preference Match", ruleType: "soft" as const, category: "preference" as const, description: "Match staff to their preferred shifts", parameters: { evaluator: "preference-match" }, weight: 5.0 },
    { id: uuid(), name: "Weekend Shifts Required", ruleType: "soft" as const, category: "fairness" as const, description: "Staff must work minimum weekend shifts per period", parameters: { evaluator: "weekend-count" }, weight: 7.0 },
    { id: uuid(), name: "Consecutive Weekends Penalty", ruleType: "soft" as const, category: "fairness" as const, description: "Penalize >2 consecutive weekends", parameters: { evaluator: "consecutive-weekends" }, weight: 6.0 },
    { id: uuid(), name: "Holiday Fairness", ruleType: "soft" as const, category: "fairness" as const, description: "Fair distribution of holiday shifts", parameters: { evaluator: "holiday-fairness" }, weight: 7.0 },
    { id: uuid(), name: "Skill Mix Diversity", ruleType: "soft" as const, category: "skill" as const, description: "Each shift should have mix of experience levels", parameters: { evaluator: "skill-mix" }, weight: 3.0 },
    { id: uuid(), name: "Minimize Float Assignments", ruleType: "soft" as const, category: "preference" as const, description: "Minimize floating staff to other units", parameters: { evaluator: "float-penalty" }, weight: 4.0 },
    { id: uuid(), name: "Charge Nurse Distribution", ruleType: "soft" as const, category: "skill" as const, description: "Distribute charge nurses across shifts", parameters: { evaluator: "charge-clustering" }, weight: 4.0 },
  ];

  for (const r of rules) {
    db.insert(schema.rule).values(r).run();
  }
  console.log(`✓ Created ${rules.length} rules (13 hard, 8 soft)`);

  // ============================================================
  // SCHEDULE (6-week period: Feb 2 - Mar 15, 2026)
  // ============================================================
  const scheduleId = uuid();
  const startDate = new Date(2026, 1, 2); // Feb 2, 2026 (Monday)
  const endDate = addDays(startDate, 41); // Mar 15, 2026

  db.insert(schema.schedule).values({
    id: scheduleId,
    name: "February-March 2026 ICU Schedule",
    startDate: format(startDate, "yyyy-MM-dd"),
    endDate: format(endDate, "yyyy-MM-dd"),
    unit: "ICU",
    status: "draft",
    notes: "6-week scheduling period for ICU unit. Includes Presidents' Day holiday.",
  }).run();
  console.log("✓ Created 1 schedule (Feb 2 - Mar 15, 2026)");

  // ============================================================
  // STAFF LEAVE
  // ============================================================
  const leaveRequests = [
    { staffId: staffData[4].id, leaveType: "vacation" as const, startDate: "2026-02-09", endDate: "2026-02-13", status: "approved" as const, notes: "Family vacation - planned 6 months ago" },
    { staffId: staffData[6].id, leaveType: "sick" as const, startDate: "2026-02-16", endDate: "2026-02-17", status: "approved" as const, notes: "Flu symptoms" },
    { staffId: staffData[3].id, leaveType: "personal" as const, startDate: "2026-02-23", endDate: "2026-02-23", status: "approved" as const, notes: "Child's school event" },
    { staffId: staffData[2].id, leaveType: "maternity" as const, startDate: "2026-03-01", endDate: "2026-04-30", status: "approved" as const, notes: "Maternity leave - 8 weeks" },
    { staffId: staffData[7].id, leaveType: "medical" as const, startDate: "2026-02-20", endDate: "2026-02-22", status: "pending" as const, notes: "Scheduled surgery" },
    { staffId: staffData[5].id, leaveType: "vacation" as const, startDate: "2026-03-09", endDate: "2026-03-13", status: "pending" as const, notes: "Spring break trip" },
  ];

  for (const leave of leaveRequests) {
    db.insert(schema.staffLeave).values({ id: uuid(), ...leave }).run();
  }
  console.log(`✓ Created ${leaveRequests.length} leave requests (4 approved, 2 pending)`);

  // ============================================================
  // PRN AVAILABILITY
  // ============================================================
  // Patricia (PRN RN) - available Tue/Thu/Sat
  const patriciaAvailable: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(startDate, i);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6) { // Tue, Thu, Sat
      patriciaAvailable.push(format(d, "yyyy-MM-dd"));
    }
  }
  db.insert(schema.prnAvailability).values({
    staffId: staffData[16].id, // Patricia
    scheduleId,
    availableDates: patriciaAvailable,
    notes: "Available Tuesdays, Thursdays, and Saturdays",
  }).run();

  // Mark (PRN RN) - available weekends only
  const markAvailable: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(startDate, i);
    if (d.getDay() === 0 || d.getDay() === 6) {
      markAvailable.push(format(d, "yyyy-MM-dd"));
    }
  }
  db.insert(schema.prnAvailability).values({
    staffId: staffData[17].id, // Mark
    scheduleId,
    availableDates: markAvailable,
    notes: "Weekends only",
  }).run();

  // Nancy (PRN RN) - available Mon/Wed/Fri
  const nancyAvailable: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(startDate, i);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) {
      nancyAvailable.push(format(d, "yyyy-MM-dd"));
    }
  }
  db.insert(schema.prnAvailability).values({
    staffId: staffData[18].id, // Nancy
    scheduleId,
    availableDates: nancyAvailable,
    notes: "Mondays, Wednesdays, Fridays",
  }).run();

  // Thomas (PRN CNA) - available every other weekend
  const thomasAvailable: string[] = [];
  let weekendCount = 0;
  for (let i = 0; i < 42; i++) {
    const d = addDays(startDate, i);
    if (d.getDay() === 6) weekendCount++;
    if ((d.getDay() === 0 || d.getDay() === 6) && weekendCount % 2 === 1) {
      thomasAvailable.push(format(d, "yyyy-MM-dd"));
    }
  }
  db.insert(schema.prnAvailability).values({
    staffId: staffData[19].id, // Thomas
    scheduleId,
    availableDates: thomasAvailable,
    notes: "Every other weekend",
  }).run();

  console.log("✓ Created PRN availability for 4 per diem staff");

  // ============================================================
  // SHIFTS (Day + Night for all 42 days)
  // ============================================================
  const shifts: { id: string; date: string; type: "day" | "night"; defId: string }[] = [];
  const acuityLevels = ["green", "green", "green", "yellow", "green", "green", "red"] as const;

  for (let i = 0; i < 42; i++) {
    const date = format(addDays(startDate, i), "yyyy-MM-dd");
    const acuity = acuityLevels[i % 7]; // Vary acuity

    const dayId = uuid();
    db.insert(schema.shift).values({
      id: dayId,
      scheduleId,
      shiftDefinitionId: dayShiftId,
      date,
      acuityLevel: acuity,
      censusBandId: bandIdByColor[acuity] ?? null,
      acuityExtraStaff: acuity === "yellow" ? 1 : acuity === "red" ? 2 : 0,
      actualCensus: 6 + (i % 5), // Census varies 6-10
    }).run();
    shifts.push({ id: dayId, date, type: "day", defId: dayShiftId });

    const nightId = uuid();
    db.insert(schema.shift).values({
      id: nightId,
      scheduleId,
      shiftDefinitionId: nightShiftId,
      date,
      acuityLevel: "green", // Nights usually calmer
      censusBandId: bandIdByColor["green"] ?? null,
      actualCensus: 5 + (i % 4),
    }).run();
    shifts.push({ id: nightId, date, type: "night", defId: nightShiftId });
  }
  console.log(`✓ Created ${shifts.length} shifts (42 days × 2 shifts)`);

  // ============================================================
  // ASSIGNMENTS (Fill 3 weeks with realistic schedule)
  // ============================================================
  let assignmentCount = 0;
  const assignmentIds: { id: string; shiftId: string; staffId: string }[] = [];

  // Get staff by role for easier assignment
  const chargeRNs = staffData.filter(s => s.isChargeNurseQualified && s.role === "RN");
  const level4PlusRNs = staffData.filter(s => s.role === "RN" && s.icuCompetencyLevel >= 4 && !s.isChargeNurseQualified);
  const level3RNs = staffData.filter(s => s.role === "RN" && s.icuCompetencyLevel === 3);
  const lpns = staffData.filter(s => s.role === "LPN");
  const cnas = staffData.filter(s => s.role === "CNA");
  const orientee = staffData.find(s => s.icuCompetencyLevel === 1);
  const preceptors = staffData.filter(s => s.icuCompetencyLevel === 5);

  // Fill first 21 days (3 weeks)
  for (let i = 0; i < 21; i++) {
    const date = format(addDays(startDate, i), "yyyy-MM-dd");
    const dayOfWeek = addDays(startDate, i).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Day shift assignments
    const dayShift = shifts.find(s => s.date === date && s.type === "day");
    if (dayShift) {
      // Charge nurse (rotate between charge-qualified staff)
      const chargeNurse = chargeRNs[i % chargeRNs.length];
      const aId1 = uuid();
      db.insert(schema.assignment).values({
        id: aId1,
        shiftId: dayShift.id,
        staffId: chargeNurse.id,
        scheduleId,
        isChargeNurse: true,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aId1, shiftId: dayShift.id, staffId: chargeNurse.id });
      assignmentCount++;

      // Second RN (Level 4)
      const secondRN = level4PlusRNs[i % level4PlusRNs.length];
      const aId2 = uuid();
      db.insert(schema.assignment).values({
        id: aId2,
        shiftId: dayShift.id,
        staffId: secondRN.id,
        scheduleId,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aId2, shiftId: dayShift.id, staffId: secondRN.id });
      assignmentCount++;

      // Third RN (Level 3) - skip if on approved leave
      const thirdRN = level3RNs[(i + 1) % level3RNs.length];
      const aId3 = uuid();
      db.insert(schema.assignment).values({
        id: aId3,
        shiftId: dayShift.id,
        staffId: thirdRN.id,
        scheduleId,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aId3, shiftId: dayShift.id, staffId: thirdRN.id });
      assignmentCount++;

      // LPN on weekdays
      if (!isWeekend && lpns.length > 0) {
        const aId4 = uuid();
        db.insert(schema.assignment).values({
          id: aId4,
          shiftId: dayShift.id,
          staffId: lpns[0].id,
          scheduleId,
          assignmentSource: "manual",
        }).run();
        assignmentIds.push({ id: aId4, shiftId: dayShift.id, staffId: lpns[0].id });
        assignmentCount++;
      }

      // CNA
      const cna = cnas[i % cnas.length];
      const aId5 = uuid();
      db.insert(schema.assignment).values({
        id: aId5,
        shiftId: dayShift.id,
        staffId: cna.id,
        scheduleId,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aId5, shiftId: dayShift.id, staffId: cna.id });
      assignmentCount++;

      // Orientee with preceptor on some days (Mon, Wed, Fri in week 1 & 2)
      if (orientee && i < 14 && (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5)) {
        const preceptor = preceptors[0]; // Maria is preceptor
        const aId6 = uuid();
        db.insert(schema.assignment).values({
          id: aId6,
          shiftId: dayShift.id,
          staffId: orientee.id,
          scheduleId,
          assignmentSource: "manual",
          notes: `Precepted by ${preceptor.firstName} ${preceptor.lastName}`,
        }).run();
        assignmentIds.push({ id: aId6, shiftId: dayShift.id, staffId: orientee.id });
        assignmentCount++;
      }
    }

    // Night shift assignments
    const nightShift = shifts.find(s => s.date === date && s.type === "night");
    if (nightShift) {
      // Charge nurse
      const nightCharge = chargeRNs[(i + 1) % chargeRNs.length];
      const aNight1 = uuid();
      db.insert(schema.assignment).values({
        id: aNight1,
        shiftId: nightShift.id,
        staffId: nightCharge.id,
        scheduleId,
        isChargeNurse: true,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aNight1, shiftId: nightShift.id, staffId: nightCharge.id });
      assignmentCount++;

      // Second RN
      const nightRN = level3RNs[(i + 2) % level3RNs.length];
      const aNight2 = uuid();
      db.insert(schema.assignment).values({
        id: aNight2,
        shiftId: nightShift.id,
        staffId: nightRN.id,
        scheduleId,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aNight2, shiftId: nightShift.id, staffId: nightRN.id });
      assignmentCount++;

      // CNA on nights
      const nightCNA = cnas[(i + 1) % cnas.length];
      const aNight3 = uuid();
      db.insert(schema.assignment).values({
        id: aNight3,
        shiftId: nightShift.id,
        staffId: nightCNA.id,
        scheduleId,
        assignmentSource: "manual",
      }).run();
      assignmentIds.push({ id: aNight3, shiftId: nightShift.id, staffId: nightCNA.id });
      assignmentCount++;
    }
  }
  console.log(`✓ Created ${assignmentCount} assignments (3 weeks filled)`);

  // ============================================================
  // CALLOUTS (5 realistic callouts)
  // ============================================================
  const callouts = [
    {
      assignmentId: assignmentIds[10].id,
      staffId: assignmentIds[10].staffId,
      shiftId: assignmentIds[10].shiftId,
      reason: "sick" as const,
      reasonDetail: "Stomach flu - called at 5:30am",
      status: "filled" as const,
      replacementStaffId: staffData[20].id, // Float nurse Amanda filled
      replacementSource: "float" as const,
    },
    {
      assignmentId: assignmentIds[25].id,
      staffId: assignmentIds[25].staffId,
      shiftId: assignmentIds[25].shiftId,
      reason: "family_emergency" as const,
      reasonDetail: "Child sick at school",
      status: "filled" as const,
      replacementStaffId: staffData[16].id, // PRN Patricia filled
      replacementSource: "per_diem" as const,
    },
    {
      assignmentId: assignmentIds[40].id,
      staffId: assignmentIds[40].staffId,
      shiftId: assignmentIds[40].shiftId,
      reason: "sick" as const,
      reasonDetail: "COVID symptoms - out for testing",
      status: "filled" as const,
      replacementStaffId: staffData[23].id, // Agency Brian filled
      replacementSource: "agency" as const,
    },
    {
      assignmentId: assignmentIds[55].id,
      staffId: assignmentIds[55].staffId,
      shiftId: assignmentIds[55].shiftId,
      reason: "no_show" as const,
      reasonDetail: "No call, no show - attempted contact 3x",
      status: "unfilled_approved" as const,
    },
    {
      assignmentId: assignmentIds[70].id,
      staffId: assignmentIds[70].staffId,
      shiftId: assignmentIds[70].shiftId,
      reason: "personal" as const,
      reasonDetail: "Car accident - not injured but handling insurance",
      status: "open" as const,
    },
  ];

  for (const c of callouts) {
    db.insert(schema.callout).values({
      id: uuid(),
      assignmentId: c.assignmentId,
      staffId: c.staffId,
      shiftId: c.shiftId,
      reason: c.reason,
      reasonDetail: c.reasonDetail,
      status: c.status,
      replacementStaffId: c.replacementStaffId,
      replacementSource: c.replacementSource,
      escalationStepsTaken: c.status === "filled" ? [
        { step: c.replacementSource || "float", attempted: true, result: "filled", timestamp: new Date().toISOString() }
      ] : [],
    }).run();
  }
  console.log(`✓ Created ${callouts.length} callouts (3 filled, 1 unfilled approved, 1 open)`);

  // ============================================================
  // SHIFT SWAP REQUESTS (3 requests)
  // ============================================================
  const swapRequests = [
    {
      requestingAssignmentId: assignmentIds[15].id,
      requestingStaffId: assignmentIds[15].staffId,
      targetAssignmentId: assignmentIds[30].id,
      targetStaffId: assignmentIds[30].staffId,
      status: "approved" as const,
      notes: "Swapping for child's birthday party",
    },
    {
      requestingAssignmentId: assignmentIds[45].id,
      requestingStaffId: assignmentIds[45].staffId,
      targetAssignmentId: assignmentIds[60].id,
      targetStaffId: assignmentIds[60].staffId,
      status: "pending" as const,
      notes: "Doctor appointment conflict",
    },
    {
      requestingAssignmentId: assignmentIds[75].id,
      requestingStaffId: assignmentIds[75].staffId,
      targetAssignmentId: null,
      targetStaffId: null,
      status: "pending" as const,
      notes: "Open request - anyone willing to swap?",
    },
  ];

  for (const swap of swapRequests) {
    db.insert(schema.shiftSwapRequest).values({
      id: uuid(),
      requestingAssignmentId: swap.requestingAssignmentId,
      requestingStaffId: swap.requestingStaffId,
      targetAssignmentId: swap.targetAssignmentId,
      targetStaffId: swap.targetStaffId,
      status: swap.status,
      notes: swap.notes,
      reviewedAt: swap.status === "approved" ? new Date().toISOString() : null,
      reviewedBy: swap.status === "approved" ? "nurse_manager" : null,
    }).run();
  }
  console.log(`✓ Created ${swapRequests.length} swap requests (1 approved, 2 pending)`);

  // ============================================================
  // EXCEPTION LOG (Audit trail samples)
  // ============================================================
  const auditEntries = [
    { entityType: "schedule" as const, entityId: scheduleId, action: "created" as const, description: "Schedule created for Feb-Mar 2026", performedBy: "nurse_manager" },
    { entityType: "assignment" as const, entityId: assignmentIds[0].id, action: "manual_assignment" as const, description: "Manually assigned Maria Garcia as charge nurse", performedBy: "nurse_manager" },
    { entityType: "callout" as const, entityId: uuid(), action: "callout_logged" as const, description: "Callout logged for sick call", performedBy: "nurse_manager" },
    { entityType: "callout" as const, entityId: uuid(), action: "callout_filled" as const, description: "Callout filled with float pool nurse", performedBy: "nurse_manager" },
    { entityType: "swap_request" as const, entityId: uuid(), action: "swap_approved" as const, description: "Shift swap approved between two nurses", performedBy: "nurse_manager" },
    { entityType: "leave" as const, entityId: uuid(), action: "leave_approved" as const, description: "Vacation leave approved for Emily Davis", performedBy: "nurse_manager" },
    { entityType: "shift" as const, entityId: shifts[3].id, action: "acuity_changed" as const, description: "Acuity changed from green to yellow due to admissions", performedBy: "charge_nurse" },
  ];

  for (const entry of auditEntries) {
    db.insert(schema.exceptionLog).values({
      id: uuid(),
      ...entry,
    }).run();
  }
  console.log(`✓ Created ${auditEntries.length} audit log entries`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("\n" + "=".repeat(50));
  console.log("SEED COMPLETED SUCCESSFULLY!");
  console.log("=".repeat(50));
  console.log(`
Summary:
- 3 Units (ICU, ER, Med-Surg)
- ${staffData.length} Staff Members:
  • 12 ICU full-time (2 charge nurses, 1 orientee)
  • 4 Part-time
  • 4 Per Diem/PRN
  • 3 Float Pool
  • 3 Agency
  • 2 Special status (1 weekend exempt, 1 on PIP)
- ${holidays.length} Public Holidays
- ${censusBands.length} Census Bands
- ${rules.length} Scheduling Rules
- 1 Schedule Period (6 weeks)
- ${shifts.length} Shifts
- ${assignmentCount} Assignments (3 weeks filled)
- ${leaveRequests.length} Leave Requests
- 4 PRN Availability Submissions
- ${callouts.length} Callouts
- ${swapRequests.length} Swap Requests
- ${auditEntries.length} Audit Log Entries
`);

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
