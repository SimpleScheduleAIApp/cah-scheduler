export type RuleCategory = "staffing" | "rest" | "fairness" | "cost" | "skill" | "preference";
export type RuleType = "hard" | "soft";

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  ruleType: RuleType;
  shiftId: string;
  staffId?: string;
  description: string;
  penaltyScore?: number;
}

export interface AssignmentInfo {
  id: string;
  shiftId: string;
  staffId: string;
  isChargeNurse: boolean;
  isOvertime: boolean;
  isFloat: boolean;
  floatFromUnit: string | null;
  date: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  unit: string;
}

export interface StaffInfo {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  employmentType: string;
  icuCompetencyLevel: number;
  isChargeNurseQualified: boolean;
  certifications: string[];
  fte: number;
  reliabilityRating: number;
  homeUnit: string | null;
  crossTrainedUnits: string[];
  weekendExempt: boolean;
  isActive: boolean;
  preferences: {
    preferredShift: string;
    maxHoursPerWeek: number;
    maxConsecutiveDays: number;
    preferredDaysOff: string[];
    avoidWeekends: boolean;
  } | null;
}

export interface ShiftInfo {
  id: string;
  date: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  requiredStaffCount: number;
  requiresChargeNurse: boolean;
  actualCensus: number | null;
  censusBandId: string | null;
  unit: string;
  countsTowardStaffing: boolean;
  acuityLevel: string | null;
  acuityExtraStaff: number;
  sitterCount: number;
}

export interface CensusBandInfo {
  id: string;
  minPatients: number;
  maxPatients: number;
  requiredRNs: number;
  requiredLPNs: number;
  requiredCNAs: number;
  requiredChargeNurses: number;
  patientToNurseRatio: string;
}

export interface UnitConfig {
  id: string;
  name: string;
  weekendRuleType: "count_per_period" | "alternate_weekends";
  weekendShiftsRequired: number;
  schedulePeriodWeeks: number;
  holidayShiftsRequired: number;
  maxOnCallPerWeek: number;
  maxOnCallWeekendsPerMonth: number;
  maxConsecutiveWeekends: number;
  acuityYellowExtraStaff: number;
  acuityRedExtraStaff: number;
}

export interface PRNAvailabilityInfo {
  staffId: string;
  availableDates: string[];
}

export interface StaffLeaveInfo {
  staffId: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface PublicHolidayInfo {
  date: string;
  name: string;
}

export interface RuleContext {
  assignments: AssignmentInfo[];
  staffMap: Map<string, StaffInfo>;
  shiftMap: Map<string, ShiftInfo>;
  censusBands: CensusBandInfo[];
  unitConfig: UnitConfig | null;
  prnAvailability: PRNAvailabilityInfo[];
  staffLeaves: StaffLeaveInfo[];
  publicHolidays: PublicHolidayInfo[];
  scheduleStartDate: string;
  scheduleEndDate: string;
  scheduleUnit: string;
  ruleParameters: Record<string, unknown>;
  /** Weekend shifts worked per staff in the prior schedule period. Used to seed
   *  the scheduler's scoring so nurses who already worked many weekends recently
   *  are deprioritised for weekend slots in the new period. */
  historicalWeekendCounts?: Map<string, number>;
}

export interface RuleEvaluator {
  id: string;
  name: string;
  type: RuleType;
  category: RuleCategory;
  evaluate: (context: RuleContext) => RuleViolation[];
}

export interface EvaluationResult {
  isValid: boolean;
  hardViolations: RuleViolation[];
  softViolations: RuleViolation[];
  totalPenalty: number;
}
