import type {
  ShiftInfo,
  StaffInfo,
  PRNAvailabilityInfo,
  StaffLeaveInfo,
  UnitConfig,
  PublicHolidayInfo,
} from "@/lib/engine/rules/types";

export interface WeightProfile {
  overtime: number;
  preference: number;
  weekendCount: number;
  consecutiveWeekends: number;
  holidayFairness: number;
  skillMix: number;
  float: number;
  chargeClustering: number;
  /** Flat penalty for using agency nurses (markup cost 2–3× base pay vs OT at 1.5×). */
  agency: number;
}

export interface AssignmentDraft {
  shiftId: string;
  staffId: string;
  date: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  unit: string;
  isChargeNurse: boolean;
  isOvertime: boolean;
  isFloat: boolean;
  floatFromUnit: string | null;
}

export interface UnderstaffedShift {
  shiftId: string;
  date: string;
  shiftType: string;
  unit: string;
  required: number;
  assigned: number;
  reasons: string[];
}

export interface GenerationResult {
  assignments: AssignmentDraft[];
  understaffed: UnderstaffedShift[];
}

export interface SchedulerContext {
  scheduleId: string;
  /** All shift slots that need to be filled */
  shifts: ShiftInfo[];
  /** Shift lookup by ID — O(1) alternative to shifts.find() */
  shiftMap: Map<string, ShiftInfo>;
  /** Flat list of all active staff */
  staffList: StaffInfo[];
  /** Staff lookup by ID */
  staffMap: Map<string, StaffInfo>;
  prnAvailability: PRNAvailabilityInfo[];
  staffLeaves: StaffLeaveInfo[];
  unitConfig: UnitConfig | null;
  scheduleUnit: string;
  publicHolidays: PublicHolidayInfo[];
  /** Weekend shifts worked per staff in the prior schedule period.
   *  Seeded into scoring so nurses with recent high weekend load are deprioritised. */
  historicalWeekendCounts?: Map<string, number>;
}

// Re-export types from rules for convenience
export type { ShiftInfo, StaffInfo, UnitConfig };
