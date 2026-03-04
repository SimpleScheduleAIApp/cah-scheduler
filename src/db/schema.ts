import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ============================================================
// UNIT CONFIGURATION
// ============================================================
export const unit = sqliteTable(
  "unit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    description: text("description"),
    // Weekend fairness configuration
    weekendRuleType: text("weekend_rule_type", {
      enum: ["count_per_period", "alternate_weekends"],
    })
      .notNull()
      .default("count_per_period"),
    weekendShiftsRequired: integer("weekend_shifts_required").notNull().default(3), // per 6-week schedule
    schedulePeriodWeeks: integer("schedule_period_weeks").notNull().default(6),
    // Holiday fairness - similar to weekend
    holidayShiftsRequired: integer("holiday_shifts_required").notNull().default(1), // per schedule period
    // Escalation sequence for callouts (JSON array of sources in priority order)
    escalationSequence: text("escalation_sequence", { mode: "json" })
      .$type<string[]>()
      .default(["float", "per_diem", "overtime", "agency"]),
    // Acuity configuration - extra RNs/LPNs needed at each level
    acuityYellowExtraStaff: integer("acuity_yellow_extra_staff").notNull().default(1),
    acuityRedExtraStaff: integer("acuity_red_extra_staff").notNull().default(2),
    // Low census policy - order of who to send home (JSON array)
    // Note: Agency removed - contracts typically guarantee minimum hours
    lowCensusOrder: text("low_census_order", { mode: "json" })
      .$type<string[]>()
      .default(["voluntary", "overtime", "per_diem", "full_time"]),
    // Days before shift when leave approval creates callout vs open shift
    // If leave is approved within this many days of shift, create callout (urgent)
    // If beyond this threshold, create open shift for bidding
    calloutThresholdDays: integer("callout_threshold_days").notNull().default(7),
    // OT approval threshold (hours beyond which CNO approval needed)
    otApprovalThreshold: integer("ot_approval_threshold").notNull().default(4),
    // On-call limits
    maxOnCallPerWeek: integer("max_on_call_per_week").notNull().default(1),
    maxOnCallWeekendsPerMonth: integer("max_on_call_weekends_per_month").notNull().default(1),
    // Consecutive weekend penalty threshold
    maxConsecutiveWeekends: integer("max_consecutive_weekends").notNull().default(2),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("unit_name_idx").on(table.name)]
);

// ============================================================
// PUBLIC HOLIDAYS
// ============================================================
export const publicHoliday = sqliteTable(
  "public_holiday",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    year: integer("year").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("public_holiday_date_idx").on(table.date),
    index("public_holiday_year_idx").on(table.year),
  ]
);

// ============================================================
// STAFF
// ============================================================
export const staff = sqliteTable(
  "staff",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    role: text("role", { enum: ["RN", "LPN", "CNA"] }).notNull(),
    employmentType: text("employment_type", {
      enum: ["full_time", "part_time", "per_diem", "float", "agency"],
    }).notNull(),
    fte: real("fte").notNull().default(1.0),
    hireDate: text("hire_date").notNull(),
    // ICU Competency Levels:
    // 1 = Novice/Orientee: Cannot take patient alone, must be paired with preceptor (FTE contribution = 0)
    // 2 = Advanced Beginner: Can take stable Med-Surg/Swing Bed, no ICU/ER alone
    // 3 = Competent (Standard): Fully functional, can take standard ICU/ER load, ACLS/PALS certified
    // 4 = Proficient (Trauma Ready): TNCC certified, can handle Codes/Trauma alone until backup
    // 5 = Expert (Charge/Preceptor): Qualified to be Charge Nurse, can take sickest patients, manage unit
    icuCompetencyLevel: integer("icu_competency_level").notNull().default(1),
    isChargeNurseQualified: integer("is_charge_nurse_qualified", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    // Certifications: ACLS, PALS, BLS, TNCC, specialty certs
    certifications: text("certifications", { mode: "json" })
      .$type<string[]>()
      .default([]),
    reliabilityRating: integer("reliability_rating").notNull().default(3),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    // Home unit and cross-training
    homeUnit: text("home_unit").default("ICU"),
    crossTrainedUnits: text("cross_trained_units", { mode: "json" })
      .$type<string[]>()
      .default([]),
    // Weekend exemption - only Admin/CNO can set this (for HR accommodations)
    weekendExempt: integer("weekend_exempt", { mode: "boolean" })
      .notNull()
      .default(false),
    // Flex hours year-to-date for low census rotation fairness
    flexHoursYearToDate: real("flex_hours_year_to_date").notNull().default(0),
    // Voluntary time off - staff indicates willingness to go home during low census
    voluntaryFlexAvailable: integer("voluntary_flex_available", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("staff_role_idx").on(table.role),
    index("staff_employment_type_idx").on(table.employmentType),
    index("staff_active_idx").on(table.isActive),
    index("staff_home_unit_idx").on(table.homeUnit),
  ]
);

// ============================================================
// STAFF PREFERENCES
// ============================================================
export const staffPreferences = sqliteTable(
  "staff_preferences",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    preferredShift: text("preferred_shift", {
      enum: ["day", "night", "evening", "any"],
    }).default("any"),
    maxHoursPerWeek: integer("max_hours_per_week").default(40),
    maxConsecutiveDays: integer("max_consecutive_days").default(3),
    preferredDaysOff: text("preferred_days_off", { mode: "json" })
      .$type<string[]>()
      .default([]),
    preferredPattern: text("preferred_pattern"),
    // Legacy field - kept for backwards compatibility but weekend fairness now handled by unit rules
    avoidWeekends: integer("avoid_weekends", { mode: "boolean" }).default(false),
    notes: text("notes"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [uniqueIndex("staff_preferences_staff_idx").on(table.staffId)]
);

// ============================================================
// STAFF LEAVE
// ============================================================
export const staffLeave = sqliteTable(
  "staff_leave",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    leaveType: text("leave_type", {
      enum: ["vacation", "sick", "maternity", "medical", "personal", "bereavement", "other"],
    }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "denied"],
    })
      .notNull()
      .default("pending"),
    submittedAt: text("submitted_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    approvedAt: text("approved_at"),
    approvedBy: text("approved_by"),
    denialReason: text("denial_reason"),
    reason: text("reason"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("staff_leave_staff_idx").on(table.staffId),
    index("staff_leave_dates_idx").on(table.startDate, table.endDate),
    index("staff_leave_status_idx").on(table.status),
  ]
);

// ============================================================
// PRN AVAILABILITY
// ============================================================
export const prnAvailability = sqliteTable(
  "prn_availability",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    // Array of dates (YYYY-MM-DD) when the PRN staff is available
    availableDates: text("available_dates", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    submittedAt: text("submitted_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("prn_availability_staff_idx").on(table.staffId),
    index("prn_availability_schedule_idx").on(table.scheduleId),
    uniqueIndex("prn_availability_unique_idx").on(table.staffId, table.scheduleId),
  ]
);

// ============================================================
// SHIFT DEFINITIONS (templates)
// ============================================================
export const shiftDefinition = sqliteTable("shift_definition", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  shiftType: text("shift_type", {
    enum: ["day", "night", "evening", "on_call"],
  }).notNull(),
  startTime: text("start_time").notNull(), // HH:MM format
  endTime: text("end_time").notNull(), // HH:MM format
  durationHours: real("duration_hours").notNull(),
  unit: text("unit").notNull().default("ICU"),
  requiredStaffCount: integer("required_staff_count").notNull().default(2),
  requiresChargeNurse: integer("requires_charge_nurse", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  // On-call shifts don't count toward regular staffing
  countsTowardStaffing: integer("counts_toward_staffing", { mode: "boolean" })
    .notNull()
    .default(true),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ============================================================
// CENSUS BANDS
// ============================================================
export const censusBand = sqliteTable(
  "census_band",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("ICU"),
    minPatients: integer("min_patients").notNull(),
    maxPatients: integer("max_patients").notNull(),
    requiredRNs: integer("required_rns").notNull(),
    requiredLPNs: integer("required_lpns").notNull().default(0), // Added for Texas units
    requiredCNAs: integer("required_cnas").notNull().default(0),
    requiredChargeNurses: integer("required_charge_nurses")
      .notNull()
      .default(1),
    // Patient to Licensed Staff ratio (RN + LPN, not just RN)
    patientToNurseRatio: text("patient_to_nurse_ratio")
      .notNull()
      .default("2:1"),
    color: text("color", { enum: ["blue", "green", "yellow", "red"] })
      .notNull()
      .default("green"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("census_band_unit_idx").on(table.unit)]
);

// ============================================================
// RULES
// ============================================================
export const rule = sqliteTable(
  "rule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    ruleType: text("rule_type", { enum: ["hard", "soft"] }).notNull(),
    category: text("category", {
      enum: [
        "staffing",
        "rest",
        "fairness",
        "cost",
        "skill",
        "preference",
      ],
    }).notNull(),
    description: text("description"),
    parameters: text("parameters", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    weight: real("weight").notNull().default(1.0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("rule_type_idx").on(table.ruleType),
    index("rule_category_idx").on(table.category),
  ]
);

// ============================================================
// SCHEDULE
// ============================================================
export const schedule = sqliteTable(
  "schedule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    unit: text("unit").notNull().default("ICU"),
    status: text("status", {
      enum: ["draft", "published", "archived"],
    })
      .notNull()
      .default("draft"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    publishedAt: text("published_at"),
  },
  (table) => [
    index("schedule_status_idx").on(table.status),
    index("schedule_dates_idx").on(table.startDate, table.endDate),
    index("schedule_unit_idx").on(table.unit),
  ]
);

// ============================================================
// SHIFT (instances within a schedule)
// ============================================================
export const shift = sqliteTable(
  "shift",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    shiftDefinitionId: text("shift_definition_id")
      .notNull()
      .references(() => shiftDefinition.id),
    date: text("date").notNull(),
    requiredStaffCount: integer("required_staff_count"),
    requiresChargeNurse: integer("requires_charge_nurse", {
      mode: "boolean",
    }),
    actualCensus: integer("actual_census"),
    censusBandId: text("census_band_id").references(() => censusBand.id),
    // Census tier set by CNO/Manager (blue=low, green=normal, yellow=elevated, red=critical)
    acuityLevel: text("acuity_level", {
      enum: ["blue", "green", "yellow", "red"],
    }),
    // Extra staff needed due to acuity (calculated from unit config)
    acuityExtraStaff: integer("acuity_extra_staff").default(0),
    // Number of 1:1 sitters needed (adds to CNA requirement)
    sitterCount: integer("sitter_count").default(0),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("shift_schedule_idx").on(table.scheduleId),
    index("shift_date_idx").on(table.date),
    uniqueIndex("shift_unique_idx").on(
      table.scheduleId,
      table.shiftDefinitionId,
      table.date
    ),
  ]
);

// ============================================================
// ASSIGNMENT
// ============================================================
export const assignment = sqliteTable(
  "assignment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shift.id, { onDelete: "cascade" }),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["assigned", "confirmed", "called_out", "swapped", "cancelled", "flexed"],
    })
      .notNull()
      .default("assigned"),
    isChargeNurse: integer("is_charge_nurse", { mode: "boolean" })
      .notNull()
      .default(false),
    isOvertime: integer("is_overtime", { mode: "boolean" })
      .notNull()
      .default(false),
    assignmentSource: text("assignment_source", {
      enum: [
        "manual",
        "auto_generated",
        "swap",
        "callout_replacement",
        "float",
        "agency_manual", // When manager calls agency directly
        "pull_back", // When pulled back from float assignment
        "scenario_applied", // When a scenario is applied to the schedule
      ],
    })
      .notNull()
      .default("manual"),
    // For agency_manual assignments, track the reason
    agencyReason: text("agency_reason", {
      enum: ["callout", "acuity_spike", "vacancy"],
    }),
    // Safe Harbor (Texas law) - nurse accepts assignment under protest
    safeHarborInvoked: integer("safe_harbor_invoked", { mode: "boolean" })
      .notNull()
      .default(false),
    safeHarborFormId: text("safe_harbor_form_id"),
    // Track if this is a float assignment (staff working outside home unit)
    isFloat: integer("is_float", { mode: "boolean" })
      .notNull()
      .default(false),
    floatFromUnit: text("float_from_unit"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("assignment_shift_idx").on(table.shiftId),
    index("assignment_staff_idx").on(table.staffId),
    index("assignment_schedule_idx").on(table.scheduleId),
    uniqueIndex("assignment_unique_idx").on(table.shiftId, table.staffId),
  ]
);

// ============================================================
// SHIFT SWAP REQUEST
// ============================================================
export const shiftSwapRequest = sqliteTable(
  "shift_swap_request",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The assignment the requesting staff wants to give up
    requestingAssignmentId: text("requesting_assignment_id")
      .notNull()
      .references(() => assignment.id),
    requestingStaffId: text("requesting_staff_id")
      .notNull()
      .references(() => staff.id),
    // The assignment being offered in exchange (optional - can be open request)
    targetAssignmentId: text("target_assignment_id")
      .references(() => assignment.id),
    targetStaffId: text("target_staff_id")
      .references(() => staff.id),
    status: text("status", {
      enum: ["pending", "approved", "denied", "cancelled"],
    })
      .notNull()
      .default("pending"),
    requestedAt: text("requested_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    reviewedAt: text("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    denialReason: text("denial_reason"),
    // Validation results at time of request
    validationNotes: text("validation_notes"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("swap_request_requesting_staff_idx").on(table.requestingStaffId),
    index("swap_request_target_staff_idx").on(table.targetStaffId),
    index("swap_request_status_idx").on(table.status),
  ]
);

// ============================================================
// CALLOUT
// ============================================================
export const callout = sqliteTable(
  "callout",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignment.id),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shift.id),
    reason: text("reason", {
      enum: ["sick", "family_emergency", "personal", "no_show", "other"],
    }).notNull(),
    reasonDetail: text("reason_detail"),
    calledOutAt: text("called_out_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    replacementStaffId: text("replacement_staff_id").references(
      () => staff.id
    ),
    replacementSource: text("replacement_source", {
      enum: ["float", "per_diem", "overtime", "agency", "unfilled"],
    }),
    escalationStepsTaken: text("escalation_steps_taken", { mode: "json" })
      .$type<
        {
          step: string;
          attempted: boolean;
          result: string;
          timestamp: string;
        }[]
      >()
      .default([]),
    status: text("status", {
      enum: ["open", "filled", "unfilled_approved"],
    })
      .notNull()
      .default("open"),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("callout_shift_idx").on(table.shiftId),
    index("callout_staff_idx").on(table.staffId),
    index("callout_status_idx").on(table.status),
  ]
);

// ============================================================
// SCENARIO
// ============================================================
export const scenario = sqliteTable(
  "scenario",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    overallScore: real("overall_score"),
    coverageScore: real("coverage_score"),
    fairnessScore: real("fairness_score"),
    costScore: real("cost_score"),
    preferenceScore: real("preference_score"),
    skillMixScore: real("skill_mix_score"),
    assignmentSnapshot: text("assignment_snapshot", { mode: "json" }).$type<
      {
        shiftId: string;
        staffId: string;
        isChargeNurse: boolean;
        isOvertime: boolean;
      }[]
    >(),
    hardViolations: text("hard_violations", { mode: "json" })
      .$type<
        {
          ruleId: string;
          ruleName: string;
          shiftId: string;
          staffId: string;
          description: string;
        }[]
      >()
      .default([]),
    softViolations: text("soft_violations", { mode: "json" })
      .$type<
        {
          ruleId: string;
          ruleName: string;
          shiftId: string;
          staffId: string;
          description: string;
          penaltyScore: number;
        }[]
      >()
      .default([]),
    status: text("status", {
      enum: ["draft", "selected", "rejected"],
    })
      .notNull()
      .default("draft"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [index("scenario_schedule_idx").on(table.scheduleId)]
);

// ============================================================
// EXCEPTION LOG (audit trail)
// ============================================================
export const exceptionLog = sqliteTable(
  "exception_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    entityType: text("entity_type", {
      enum: [
        "assignment",
        "schedule",
        "callout",
        "rule",
        "staff",
        "scenario",
        "leave",
        "swap_request",
        "unit",
        "shift",
        "open_shift",
      ],
    }).notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action", {
      enum: [
        "created",
        "updated",
        "deleted",
        "override_hard_rule",
        "override_soft_rule",
        "published",
        "archived",
        "callout_logged",
        "callout_filled",
        "scenario_selected",
        "scenario_rejected",
        "swap_requested",
        "swap_approved",
        "open_swap_approved",
        "swap_denied",
        "forced_overtime",
        "manual_assignment",
        "leave_requested",
        "leave_approved",
        "leave_denied",
        "pull_back",
        "flex_home",
        "safe_harbor",
        "acuity_changed",
        "census_changed",
        "agency_called",
        "open_shift_created",
        "open_shift_filled",
        "open_shift_cancelled",
        "schedule_auto_generated",
        "scenario_applied",
        "assignment_cancelled_for_leave",
        "callout_created_for_leave",
      ],
    }).notNull(),
    description: text("description").notNull(),
    previousState: text("previous_state", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    newState: text("new_state", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    overriddenRuleId: text("overridden_rule_id").references(() => rule.id),
    justification: text("justification"),
    performedBy: text("performed_by").notNull().default("nurse_manager"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("exception_log_entity_idx").on(table.entityType, table.entityId),
    index("exception_log_action_idx").on(table.action),
    index("exception_log_date_idx").on(table.createdAt),
  ]
);

// ============================================================
// STAFF HOLIDAY ASSIGNMENT (for annual holiday fairness tracking)
// ============================================================
export const staffHolidayAssignment = sqliteTable(
  "staff_holiday_assignment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    staffId: text("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    // Logical holiday name (e.g., "Christmas" for both Eve and Day)
    holidayName: text("holiday_name").notNull(),
    year: integer("year").notNull(),
    shiftId: text("shift_id").references(() => shift.id, { onDelete: "set null" }),
    assignmentId: text("assignment_id").references(() => assignment.id, { onDelete: "set null" }),
    assignedAt: text("assigned_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("staff_holiday_assignment_staff_idx").on(table.staffId),
    index("staff_holiday_assignment_year_idx").on(table.year),
    index("staff_holiday_assignment_holiday_idx").on(table.holidayName, table.year),
    // Prevent duplicate holiday assignments for same staff in same year
    uniqueIndex("staff_holiday_assignment_unique_idx").on(
      table.staffId,
      table.holidayName,
      table.year
    ),
  ]
);

// ============================================================
// SCHEDULE GENERATION JOB
// ============================================================
export const generationJob = sqliteTable(
  "generation_job",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedule.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    // 0-100 progress percentage
    progress: integer("progress").notNull().default(0),
    // Human-readable description of current phase
    currentPhase: text("current_phase"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    // Error message if failed
    error: text("error"),
    // JSON array of understaffed shift warnings
    warnings: text("warnings", { mode: "json" })
      .$type<
        {
          shiftId: string;
          date: string;
          shiftType: string;
          unit: string;
          required: number;
          assigned: number;
          reasons: string[];
        }[]
      >()
      .default([]),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("generation_job_schedule_idx").on(table.scheduleId),
    index("generation_job_status_idx").on(table.status),
  ]
);

// ============================================================
// COVERAGE REQUEST (shifts needing coverage with auto-recommendations)
// Renamed from "open_shift" to better reflect the approval workflow
// ============================================================
export const openShift = sqliteTable(
  "open_shift",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    shiftId: text("shift_id")
      .notNull()
      .references(() => shift.id, { onDelete: "cascade" }),
    originalStaffId: text("original_staff_id")
      .notNull()
      .references(() => staff.id),
    originalAssignmentId: text("original_assignment_id")
      .references(() => assignment.id, { onDelete: "set null" }),
    reason: text("reason", {
      enum: ["leave_approved", "callout", "schedule_change", "other"],
    }).notNull(),
    reasonDetail: text("reason_detail"),
    status: text("status", {
      enum: ["pending_approval", "approved", "filled", "cancelled", "no_candidates"],
    })
      .notNull()
      .default("pending_approval"),
    priority: text("priority", {
      enum: ["low", "normal", "high", "urgent"],
    })
      .notNull()
      .default("normal"),
    // Top 3 candidate recommendations with reasons
    // Each candidate includes: staffId, name, source (float/prn/overtime/agency), reasons[], score
    recommendations: text("recommendations", { mode: "json" })
      .$type<{
        staffId: string;
        staffName: string;
        source: "float" | "per_diem" | "overtime" | "agency";
        reasons: string[];
        score: number;
        isOvertime: boolean;
        hoursThisWeek: number;
      }[]>()
      .default([]),
    // Which escalation steps were checked
    escalationStepsChecked: text("escalation_steps_checked", { mode: "json" })
      .$type<string[]>()
      .default([]),
    // Selected candidate (after manager approval)
    selectedStaffId: text("selected_staff_id").references(() => staff.id),
    selectedSource: text("selected_source", {
      enum: ["float", "per_diem", "overtime", "agency"],
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    approvedAt: text("approved_at"),
    approvedBy: text("approved_by"),
    filledAt: text("filled_at"),
    filledByStaffId: text("filled_by_staff_id").references(() => staff.id),
    filledByAssignmentId: text("filled_by_assignment_id").references(() => assignment.id),
    notes: text("notes"),
  },
  (table) => [
    index("open_shift_shift_idx").on(table.shiftId),
    index("open_shift_status_idx").on(table.status),
    index("open_shift_priority_idx").on(table.priority),
  ]
);
