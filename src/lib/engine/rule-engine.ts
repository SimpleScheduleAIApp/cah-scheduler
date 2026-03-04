import { db } from "@/db";
import {
  staff,
  staffPreferences,
  shift,
  shiftDefinition,
  assignment,
  rule,
  censusBand,
  unit,
  prnAvailability,
  staffLeave,
  publicHoliday,
  schedule,
} from "@/db/schema";
import { eq, and, gte, lte, lt, ne } from "drizzle-orm";
import { getEvaluator } from "./rules";
import type {
  RuleContext,
  EvaluationResult,
  AssignmentInfo,
  StaffInfo,
  ShiftInfo,
  CensusBandInfo,
  UnitConfig,
  PRNAvailabilityInfo,
  StaffLeaveInfo,
  PublicHolidayInfo,
} from "./rules/types";

export function buildContext(scheduleId: string): RuleContext {
  // Fetch the schedule to get unit and date range
  const scheduleRecord = db
    .select()
    .from(schedule)
    .where(eq(schedule.id, scheduleId))
    .get();

  const scheduleUnit = scheduleRecord?.unit ?? "ICU";
  const scheduleStartDate = scheduleRecord?.startDate ?? "";
  const scheduleEndDate = scheduleRecord?.endDate ?? "";

  // Fetch unit configuration
  const unitRecord = db
    .select()
    .from(unit)
    .where(and(eq(unit.name, scheduleUnit), eq(unit.isActive, true)))
    .get();

  const unitConfig: UnitConfig | null = unitRecord
    ? {
        id: unitRecord.id,
        name: unitRecord.name,
        weekendRuleType: unitRecord.weekendRuleType as "count_per_period" | "alternate_weekends",
        weekendShiftsRequired: unitRecord.weekendShiftsRequired,
        schedulePeriodWeeks: unitRecord.schedulePeriodWeeks,
        holidayShiftsRequired: unitRecord.holidayShiftsRequired,
        maxOnCallPerWeek: unitRecord.maxOnCallPerWeek,
        maxOnCallWeekendsPerMonth: unitRecord.maxOnCallWeekendsPerMonth,
        maxConsecutiveWeekends: unitRecord.maxConsecutiveWeekends,
        acuityYellowExtraStaff: unitRecord.acuityYellowExtraStaff,
        acuityRedExtraStaff: unitRecord.acuityRedExtraStaff,
      }
    : null;

  // Fetch all active assignments for this schedule.
  // Exclude called_out and cancelled — those staff are not working the shift and
  // should not trigger leave-conflict, rest-hours, or any other rule violation.
  const assignments = db
    .select({
      id: assignment.id,
      shiftId: assignment.shiftId,
      staffId: assignment.staffId,
      isChargeNurse: assignment.isChargeNurse,
      isOvertime: assignment.isOvertime,
      isFloat: assignment.isFloat,
      floatFromUnit: assignment.floatFromUnit,
      shiftDate: shift.date,
      shiftDefId: shift.shiftDefinitionId,
    })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .where(
      and(
        eq(assignment.scheduleId, scheduleId),
        ne(assignment.status, "called_out"),
        ne(assignment.status, "cancelled")
      )
    )
    .all();

  // Fetch shift definitions
  const shiftDefs = db.select().from(shiftDefinition).all();
  const shiftDefMap = new Map(shiftDefs.map((sd) => [sd.id, sd]));

  // Fetch all shifts for this schedule
  const shifts = db
    .select()
    .from(shift)
    .where(eq(shift.scheduleId, scheduleId))
    .all();

  // Build shift map
  const shiftMap = new Map<string, ShiftInfo>();
  for (const s of shifts) {
    const def = shiftDefMap.get(s.shiftDefinitionId);
    if (!def) continue;
    shiftMap.set(s.id, {
      id: s.id,
      date: s.date,
      shiftType: def.shiftType,
      startTime: def.startTime,
      endTime: def.endTime,
      durationHours: def.durationHours,
      requiredStaffCount: s.requiredStaffCount ?? def.requiredStaffCount,
      requiresChargeNurse: s.requiresChargeNurse ?? def.requiresChargeNurse,
      actualCensus: s.actualCensus,
      censusBandId: s.censusBandId ?? null,
      unit: def.unit,
      countsTowardStaffing: def.countsTowardStaffing,
      acuityLevel: s.acuityLevel,
      acuityExtraStaff: s.acuityExtraStaff ?? 0,
      sitterCount: s.sitterCount ?? 0,
    });
  }

  // Build assignment info
  const assignmentInfos: AssignmentInfo[] = assignments.map((a) => {
    const shiftInfo = shiftMap.get(a.shiftId);
    return {
      id: a.id,
      shiftId: a.shiftId,
      staffId: a.staffId,
      isChargeNurse: a.isChargeNurse,
      isOvertime: a.isOvertime,
      isFloat: a.isFloat,
      floatFromUnit: a.floatFromUnit,
      date: a.shiftDate,
      shiftType: shiftInfo?.shiftType ?? "",
      startTime: shiftInfo?.startTime ?? "",
      endTime: shiftInfo?.endTime ?? "",
      durationHours: shiftInfo?.durationHours ?? 0,
      unit: shiftInfo?.unit ?? scheduleUnit,
    };
  });

  // Fetch all staff with preferences
  const allStaff = db.select().from(staff).all();
  const allPrefs = db.select().from(staffPreferences).all();
  const prefsMap = new Map(allPrefs.map((p) => [p.staffId, p]));

  const staffMap = new Map<string, StaffInfo>();
  for (const s of allStaff) {
    const pref = prefsMap.get(s.id);
    staffMap.set(s.id, {
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      role: s.role,
      employmentType: s.employmentType,
      icuCompetencyLevel: s.icuCompetencyLevel,
      isChargeNurseQualified: s.isChargeNurseQualified,
      certifications: (s.certifications as string[]) ?? [],
      fte: s.fte,
      reliabilityRating: s.reliabilityRating,
      homeUnit: s.homeUnit,
      crossTrainedUnits: (s.crossTrainedUnits as string[]) ?? [],
      weekendExempt: s.weekendExempt,
      isActive: s.isActive,
      preferences: pref
        ? {
            preferredShift: pref.preferredShift ?? "any",
            maxHoursPerWeek: pref.maxHoursPerWeek ?? 40,
            maxConsecutiveDays: pref.maxConsecutiveDays ?? 3,
            preferredDaysOff: (pref.preferredDaysOff as string[]) ?? [],
            avoidWeekends: pref.avoidWeekends ?? false,
          }
        : null,
    });
  }

  // Fetch census bands
  const bands = db.select().from(censusBand).where(eq(censusBand.isActive, true)).all();
  const censusBandInfos: CensusBandInfo[] = bands.map((b) => ({
    id: b.id,
    minPatients: b.minPatients,
    maxPatients: b.maxPatients,
    requiredRNs: b.requiredRNs,
    requiredLPNs: b.requiredLPNs,
    requiredCNAs: b.requiredCNAs,
    requiredChargeNurses: b.requiredChargeNurses,
    patientToNurseRatio: b.patientToNurseRatio,
  }));

  // When a census tier has been selected (censusBandId is set on a shift), override
  // requiredStaffCount with the band's total staffing requirement so the scheduler
  // fills to the correct target (e.g. 4 RNs + 1 CNA = 5 for Green) rather than the
  // shift definition's base count (e.g. 4 for Day). Also zero acuityExtraStaff to
  // prevent double-counting — the band total already includes any elevated-census extra.
  for (const [shiftId, shiftInfo] of shiftMap) {
    if (shiftInfo.censusBandId) {
      const band = censusBandInfos.find((b) => b.id === shiftInfo.censusBandId);
      if (band) {
        shiftMap.set(shiftId, {
          ...shiftInfo,
          requiredStaffCount: band.requiredRNs + band.requiredCNAs,
          acuityExtraStaff: 0,
        });
      }
    }
  }

  // Fetch PRN availability — load all submissions across all schedules, then
  // aggregate dates per staff. The eligibility check already gates by date, so
  // loading across scheduleIds is safe and means PRN staff with standing
  // availability don't lose it just because a new schedule was created.
  const prnAvailabilityRecords = db
    .select()
    .from(prnAvailability)
    .all();

  const prnDatesByStaff = new Map<string, Set<string>>();
  for (const p of prnAvailabilityRecords) {
    const dates = prnDatesByStaff.get(p.staffId) ?? new Set<string>();
    for (const d of ((p.availableDates as string[]) ?? [])) {
      dates.add(d);
    }
    prnDatesByStaff.set(p.staffId, dates);
  }
  const prnAvailabilityInfos: PRNAvailabilityInfo[] = [...prnDatesByStaff.entries()].map(
    ([staffId, dates]) => ({ staffId, availableDates: [...dates] })
  );

  // Fetch approved staff leaves that overlap with schedule dates
  const staffLeaveRecords = db
    .select()
    .from(staffLeave)
    .where(eq(staffLeave.status, "approved"))
    .all()
    .filter((l) => {
      // Check if leave overlaps with schedule
      return l.startDate <= scheduleEndDate && l.endDate >= scheduleStartDate;
    });

  const staffLeaveInfos: StaffLeaveInfo[] = staffLeaveRecords.map((l) => ({
    staffId: l.staffId,
    startDate: l.startDate,
    endDate: l.endDate,
    status: l.status,
  }));

  // Fetch public holidays within schedule range
  const publicHolidayRecords = db
    .select()
    .from(publicHoliday)
    .where(eq(publicHoliday.isActive, true))
    .all()
    .filter((h) => h.date >= scheduleStartDate && h.date <= scheduleEndDate);

  const publicHolidayInfos: PublicHolidayInfo[] = publicHolidayRecords.map((h) => ({
    date: h.date,
    name: h.name,
  }));

  // Historical weekend counts — look back one schedule period before this schedule starts.
  // Used by the scheduler's scoring function so nurses who worked many weekends recently
  // are deprioritised for weekend slots in the new period, preventing the same staff from
  // always landing on weekends in every successive schedule generation.
  const historicalWeekendCounts = new Map<string, number>();
  if (scheduleStartDate) {
    const lookbackWeeks = unitConfig?.schedulePeriodWeeks ?? 6;
    const lookbackStart = new Date(scheduleStartDate);
    lookbackStart.setDate(lookbackStart.getDate() - lookbackWeeks * 7);
    const lookbackStartStr = lookbackStart.toISOString().slice(0, 10);

    const histRows = db
      .select({ staffId: assignment.staffId, date: shift.date })
      .from(assignment)
      .innerJoin(shift, eq(assignment.shiftId, shift.id))
      .where(and(gte(shift.date, lookbackStartStr), lt(shift.date, scheduleStartDate)))
      .all();

    for (const row of histRows) {
      const day = new Date(row.date).getDay();
      if (day === 0 || day === 6) {
        historicalWeekendCounts.set(
          row.staffId,
          (historicalWeekendCounts.get(row.staffId) ?? 0) + 1
        );
      }
    }
  }

  return {
    assignments: assignmentInfos,
    staffMap,
    shiftMap,
    censusBands: censusBandInfos,
    unitConfig,
    prnAvailability: prnAvailabilityInfos,
    staffLeaves: staffLeaveInfos,
    publicHolidays: publicHolidayInfos,
    scheduleStartDate,
    scheduleEndDate,
    scheduleUnit,
    ruleParameters: {},
    historicalWeekendCounts,
  };
}

export function evaluateSchedule(scheduleId: string): EvaluationResult {
  const context = buildContext(scheduleId);

  // Fetch active rules
  const activeRules = db
    .select()
    .from(rule)
    .where(eq(rule.isActive, true))
    .all();

  const hardViolations: EvaluationResult["hardViolations"] = [];
  const softViolations: EvaluationResult["softViolations"] = [];

  for (const r of activeRules) {
    const params = r.parameters as Record<string, unknown>;
    const evaluatorId = params.evaluator as string;
    if (!evaluatorId) continue;

    const evaluator = getEvaluator(evaluatorId);
    if (!evaluator) continue;

    // Merge rule parameters into context
    const ruleContext: RuleContext = {
      ...context,
      ruleParameters: params,
    };

    const violations = evaluator.evaluate(ruleContext);

    for (const v of violations) {
      if (r.ruleType === "hard") {
        hardViolations.push(v);
      } else {
        softViolations.push({
          ...v,
          penaltyScore: (v.penaltyScore ?? 1) * r.weight,
        });
      }
    }
  }

  const totalPenalty = softViolations.reduce(
    (sum, v) => sum + (v.penaltyScore ?? 0),
    0
  );

  return {
    isValid: hardViolations.length === 0,
    hardViolations,
    softViolations,
    totalPenalty,
  };
}
