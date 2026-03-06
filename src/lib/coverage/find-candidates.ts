import { db } from "@/db";
import { staff, assignment, shift, shiftDefinition, staffLeave, prnAvailability, schedule } from "@/db/schema";
import { eq, and, ne, gte, lte, or } from "drizzle-orm";
import { addDays, parseISO, format, startOfWeek, endOfWeek } from "date-fns";

// ---------------------------------------------------------------------------
// Role hierarchy — replacement must have equal or higher rank than the original
// nurse. A CNA cannot perform RN duties regardless of availability; showing
// them at all creates confusion for the manager.
// ---------------------------------------------------------------------------
const ROLE_RANK: Record<string, number> = { RN: 3, LPN: 2, CNA: 1 };

// Source preference bonus — kept small relative to competency so a large
// level mismatch can override tier preference. A non-OT regular nurse at the
// same competency level as a PRN nurse scores identically (overtime source
// bonus 10 + non-OT bonus 10 = 20, same as PRN source bonus 20).
const SOURCE_BONUS: Record<string, number> = {
  float: 30,
  per_diem: 20,
  overtime: 10,
  agency: 0,
};

export interface CandidateRecommendation {
  staffId: string;
  staffName: string;
  role: string;
  icuCompetencyLevel: number;
  isChargeNurseQualified: boolean;
  source: "float" | "per_diem" | "overtime" | "agency";
  reasons: string[];
  score: number;
  isOvertime: boolean;
  hoursThisWeek: number;
  restHoursBefore?: number; // hours of rest between candidate's last preceding shift and this one
  weekendsThisPeriod: number;
  consecutiveDaysBeforeShift: number;
}

interface ShiftDetails {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  unit: string;
  shiftType: string;
  scheduleId: string;
}

/** Context derived from the original staff member being replaced. */
interface VacancyContext {
  /** Role rank of the original staff — candidates below this rank are skipped. */
  requiredRoleRank: number;
  /** ICU competency level of the original staff — used as the scoring ceiling. */
  calledOutLevel: number;
  /** True when the original assignment carried the charge nurse role. */
  chargeRequired: boolean;
}

// ---------------------------------------------------------------------------
// Helpers for weekend count and consecutive days
// ---------------------------------------------------------------------------

function countWeekendsInSchedulePeriod(staffId: string, scheduleId: string): number {
  const sched = db.select({ startDate: schedule.startDate, endDate: schedule.endDate })
    .from(schedule).where(eq(schedule.id, scheduleId)).get();
  if (!sched) return 0;

  const rows = db
    .select({ date: shift.date })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .where(
      and(
        eq(assignment.staffId, staffId),
        gte(shift.date, sched.startDate),
        lte(shift.date, sched.endDate),
        ne(assignment.status, "cancelled")
      )
    )
    .all();

  return rows.filter((r) => {
    const day = new Date(r.date + "T00:00:00Z").getUTCDay();
    return day === 0 || day === 6;
  }).length;
}

function countConsecutiveDaysBefore(staffId: string, shiftDate: string): number {
  let count = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(shiftDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const hasShift = db
      .select({ id: assignment.id })
      .from(assignment)
      .innerJoin(shift, eq(assignment.shiftId, shift.id))
      .where(
        and(
          eq(assignment.staffId, staffId),
          eq(shift.date, dateStr),
          ne(assignment.status, "cancelled")
        )
      )
      .get();
    if (!hasShift) break;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Find the top candidates to fill a shift, following escalation order:
 * 1. Float pool staff
 * 2. PRN (Per Diem) staff who are available
 * 3. Regular staff for overtime
 * 4. Agency (marked but requires external contact)
 */
export async function findCandidatesForShift(
  shiftId: string,
  excludeStaffId?: string
): Promise<{
  candidates: CandidateRecommendation[];
  escalationStepsChecked: string[];
}> {
  const shiftRecord = db
    .select({
      id: shift.id,
      date: shift.date,
      startTime: shiftDefinition.startTime,
      endTime: shiftDefinition.endTime,
      durationHours: shiftDefinition.durationHours,
      unit: shiftDefinition.unit,
      shiftType: shiftDefinition.shiftType,
      scheduleId: shift.scheduleId,
    })
    .from(shift)
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(eq(shift.id, shiftId))
    .get();

  if (!shiftRecord) {
    return { candidates: [], escalationStepsChecked: [] };
  }

  const vacancyContext = buildVacancyContext(shiftId, excludeStaffId);

  const allCandidates: CandidateRecommendation[] = [];
  const escalationStepsChecked: string[] = [];

  escalationStepsChecked.push("float");
  allCandidates.push(...await findFloatCandidates(shiftRecord, excludeStaffId, vacancyContext));

  escalationStepsChecked.push("per_diem");
  allCandidates.push(...await findPRNCandidates(shiftRecord, excludeStaffId, vacancyContext));

  escalationStepsChecked.push("overtime");
  allCandidates.push(...await findOvertimeCandidates(shiftRecord, excludeStaffId, vacancyContext));

  escalationStepsChecked.push("agency");
  allCandidates.push({
    staffId: "agency",
    staffName: "Request Agency Staff",
    role: "Agency",
    icuCompetencyLevel: 0,
    isChargeNurseQualified: false,
    source: "agency",
    reasons: ["External staffing agency", "Requires phone call to agency", "Higher cost option"],
    score: 10,
    isOvertime: false,
    hoursThisWeek: 0,
    weekendsThisPeriod: 0,
    consecutiveDaysBeforeShift: 0,
  });

  const sortedCandidates = allCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return { candidates: sortedCandidates, escalationStepsChecked };
}

// ---------------------------------------------------------------------------
// Vacancy context
// ---------------------------------------------------------------------------

function buildVacancyContext(shiftId: string, excludeStaffId?: string): VacancyContext {
  const defaults: VacancyContext = { requiredRoleRank: 0, calledOutLevel: 1, chargeRequired: false };
  if (!excludeStaffId) return defaults;

  const originalStaff = db
    .select({ role: staff.role, icuCompetencyLevel: staff.icuCompetencyLevel })
    .from(staff)
    .where(eq(staff.id, excludeStaffId))
    .get();
  if (!originalStaff) return defaults;

  const originalAssignment = db
    .select({ isChargeNurse: assignment.isChargeNurse })
    .from(assignment)
    .where(and(eq(assignment.shiftId, shiftId), eq(assignment.staffId, excludeStaffId)))
    .get();

  return {
    requiredRoleRank: ROLE_RANK[originalStaff.role] ?? 0,
    calledOutLevel: originalStaff.icuCompetencyLevel ?? 1,
    chargeRequired: originalAssignment?.isChargeNurse === true,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a candidate's score.
 *
 * Competency is the primary axis. effectiveLevel is capped at calledOutLevel
 * so a large over-qualification does not give an unfair tier advantage, but
 * being under-qualified always scores proportionally lower regardless of
 * employment tier (a Level 3 float never outranks a Level 5 regular nurse for
 * a Level 5 vacancy).
 *
 * Source bonus is kept small (30/20/10) so a 2-level competency gap (20 pts)
 * overrides the float-vs-overtime tier difference (20 pts).
 *
 * Non-OT regular staff receive +10 to match PRN source bonus (20 = 10+10),
 * ensuring a same-level, non-overtime regular nurse scores identically to a
 * PRN nurse — consistent with the reasoning that a nurse not yet at 40h is
 * no more expensive than a PRN shift.
 */
function candidateScore(
  candidateLevel: number,
  isChargeQualified: boolean,
  isHomeUnit: boolean,
  reliabilityRating: number,
  source: "float" | "per_diem" | "overtime" | "agency",
  hoursThisWeek: number,
  durationHours: number,
  vacancyContext: VacancyContext
): number {
  const effectiveLevel = Math.min(candidateLevel, vacancyContext.calledOutLevel);
  const overflowLevel = Math.max(0, candidateLevel - vacancyContext.calledOutLevel);
  let score = effectiveLevel * 10 + overflowLevel * 2;

  score += SOURCE_BONUS[source] ?? 0;
  score += reliabilityRating * 3;
  if (vacancyContext.chargeRequired && isChargeQualified) score += 15;
  if (source === "overtime" && hoursThisWeek + durationHours <= 40) score += 10;
  if (isHomeUnit) score += 5;
  score += Math.max(0, 40 - hoursThisWeek) * 0.2; // prefer less-loaded staff

  return score;
}

// ---------------------------------------------------------------------------
// Per-tier candidate finders
// ---------------------------------------------------------------------------

async function findFloatCandidates(
  shiftDetails: ShiftDetails,
  excludeStaffId: string | undefined,
  vacancyContext: VacancyContext
): Promise<CandidateRecommendation[]> {
  const candidates: CandidateRecommendation[] = [];

  const floatStaff = db
    .select()
    .from(staff)
    .where(
      and(
        eq(staff.employmentType, "float"),
        eq(staff.isActive, true),
        excludeStaffId ? ne(staff.id, excludeStaffId) : undefined
      )
    )
    .all();

  for (const s of floatStaff) {
    if ((ROLE_RANK[s.role] ?? 0) < vacancyContext.requiredRoleRank) continue;

    const isHomeUnit = s.homeUnit === shiftDetails.unit;
    const isQualified = isHomeUnit || !!(s.crossTrainedUnits?.includes(shiftDetails.unit));
    if (!isQualified) continue;

    const availability = await checkStaffAvailability(s.id, shiftDetails);
    if (!availability.available) continue;

    const reasons: string[] = ["Float pool staff - designed for coverage"];
    if (isHomeUnit) {
      reasons.push(`Home unit is ${shiftDetails.unit}`);
    } else {
      reasons.push(`Cross-trained for ${shiftDetails.unit}`);
    }
    if (s.icuCompetencyLevel >= 3) reasons.push(`Competency Level ${s.icuCompetencyLevel}`);
    if (vacancyContext.chargeRequired && s.isChargeNurseQualified) reasons.push("Charge nurse qualified");

    const hoursThisWeek = availability.hoursThisWeek;
    candidates.push({
      staffId: s.id,
      staffName: `${s.firstName} ${s.lastName}`,
      role: s.role,
      icuCompetencyLevel: s.icuCompetencyLevel,
      isChargeNurseQualified: s.isChargeNurseQualified,
      source: "float",
      reasons,
      score: candidateScore(
        s.icuCompetencyLevel, s.isChargeNurseQualified, isHomeUnit,
        s.reliabilityRating, "float", hoursThisWeek, shiftDetails.durationHours, vacancyContext
      ),
      isOvertime: hoursThisWeek + shiftDetails.durationHours > 40,
      hoursThisWeek,
      restHoursBefore: availability.restHoursBefore,
      weekendsThisPeriod: countWeekendsInSchedulePeriod(s.id, shiftDetails.scheduleId),
      consecutiveDaysBeforeShift: countConsecutiveDaysBefore(s.id, shiftDetails.date),
    });
  }

  return candidates;
}

async function findPRNCandidates(
  shiftDetails: ShiftDetails,
  excludeStaffId: string | undefined,
  vacancyContext: VacancyContext
): Promise<CandidateRecommendation[]> {
  const candidates: CandidateRecommendation[] = [];

  const prnStaff = db
    .select()
    .from(staff)
    .where(
      and(
        eq(staff.employmentType, "per_diem"),
        eq(staff.isActive, true),
        excludeStaffId ? ne(staff.id, excludeStaffId) : undefined
      )
    )
    .all();

  for (const s of prnStaff) {
    if ((ROLE_RANK[s.role] ?? 0) < vacancyContext.requiredRoleRank) continue;

    const isHomeUnit = s.homeUnit === shiftDetails.unit;
    const isQualified = isHomeUnit || !!(s.crossTrainedUnits?.includes(shiftDetails.unit));
    if (!isQualified) continue;

    // PRN must have marked this date as available.
    // Build a Set from all records for this staff member (same logic as rule engine)
    // to guard against JSON-parsing edge cases.
    const prnAvail = db
      .select()
      .from(prnAvailability)
      .where(eq(prnAvailability.staffId, s.id))
      .all();
    const availableSet = new Set<string>();
    for (const a of prnAvail) {
      for (const d of ((a.availableDates as string[]) ?? [])) {
        availableSet.add(d);
      }
    }
    if (!availableSet.has(shiftDetails.date)) continue;

    const availability = await checkStaffAvailability(s.id, shiftDetails);
    if (!availability.available) continue;

    const reasons: string[] = ["PRN staff - marked available for this date"];
    if (isHomeUnit) {
      reasons.push(`Home unit is ${shiftDetails.unit}`);
    } else {
      reasons.push(`Cross-trained for ${shiftDetails.unit}`);
    }
    if (s.reliabilityRating >= 4) reasons.push(`High reliability rating (${s.reliabilityRating}/5)`);
    if (vacancyContext.chargeRequired && s.isChargeNurseQualified) reasons.push("Charge nurse qualified");

    const hoursThisWeek = availability.hoursThisWeek;
    candidates.push({
      staffId: s.id,
      staffName: `${s.firstName} ${s.lastName}`,
      role: s.role,
      icuCompetencyLevel: s.icuCompetencyLevel,
      isChargeNurseQualified: s.isChargeNurseQualified,
      source: "per_diem",
      reasons,
      score: candidateScore(
        s.icuCompetencyLevel, s.isChargeNurseQualified, isHomeUnit,
        s.reliabilityRating, "per_diem", hoursThisWeek, shiftDetails.durationHours, vacancyContext
      ),
      isOvertime: false,
      hoursThisWeek,
      restHoursBefore: availability.restHoursBefore,
      weekendsThisPeriod: countWeekendsInSchedulePeriod(s.id, shiftDetails.scheduleId),
      consecutiveDaysBeforeShift: countConsecutiveDaysBefore(s.id, shiftDetails.date),
    });
  }

  return candidates;
}

async function findOvertimeCandidates(
  shiftDetails: ShiftDetails,
  excludeStaffId: string | undefined,
  vacancyContext: VacancyContext
): Promise<CandidateRecommendation[]> {
  const candidates: CandidateRecommendation[] = [];

  const regularStaff = db
    .select()
    .from(staff)
    .where(
      and(
        or(
          eq(staff.employmentType, "full_time"),
          eq(staff.employmentType, "part_time")
        ),
        eq(staff.isActive, true),
        excludeStaffId ? ne(staff.id, excludeStaffId) : undefined
      )
    )
    .all();

  for (const s of regularStaff) {
    if ((ROLE_RANK[s.role] ?? 0) < vacancyContext.requiredRoleRank) continue;

    const isHomeUnit = s.homeUnit === shiftDetails.unit;
    const isQualified = isHomeUnit || !!(s.crossTrainedUnits?.includes(shiftDetails.unit));
    if (!isQualified) continue;

    const availability = await checkStaffAvailability(s.id, shiftDetails);
    if (!availability.available) continue;

    const hoursThisWeek = availability.hoursThisWeek;
    const wouldBeOvertime = hoursThisWeek + shiftDetails.durationHours > 40;

    const reasons: string[] = [];
    // Overtime/hours context is shown as a con in the UI — not included in reasons
    if (isHomeUnit) {
      reasons.push(`Home unit is ${shiftDetails.unit}`);
    } else {
      reasons.push(`Cross-trained for ${shiftDetails.unit}`);
    }
    if (s.flexHoursYearToDate < 20) reasons.push("Low flex hours YTD (fair distribution)");
    if (vacancyContext.chargeRequired && s.isChargeNurseQualified) reasons.push("Charge nurse qualified");

    candidates.push({
      staffId: s.id,
      staffName: `${s.firstName} ${s.lastName}`,
      role: s.role,
      icuCompetencyLevel: s.icuCompetencyLevel,
      isChargeNurseQualified: s.isChargeNurseQualified,
      source: "overtime",
      reasons,
      score: candidateScore(
        s.icuCompetencyLevel, s.isChargeNurseQualified, isHomeUnit,
        s.reliabilityRating, "overtime", hoursThisWeek, shiftDetails.durationHours, vacancyContext
      ),
      isOvertime: wouldBeOvertime,
      hoursThisWeek,
      restHoursBefore: availability.restHoursBefore,
      weekendsThisPeriod: countWeekendsInSchedulePeriod(s.id, shiftDetails.scheduleId),
      consecutiveDaysBeforeShift: countConsecutiveDaysBefore(s.id, shiftDetails.date),
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

interface AvailabilityResult {
  available: boolean;
  hoursThisWeek: number;
  reason?: string;
  restHoursBefore?: number;
}

async function checkStaffAvailability(
  staffId: string,
  shiftDetails: ShiftDetails
): Promise<AvailabilityResult> {
  const shiftDate = parseISO(shiftDetails.date);
  const weekStart = startOfWeek(shiftDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(shiftDate, { weekStartsOn: 0 });

  // 1. Approved leave
  const leaveRecords = db
    .select()
    .from(staffLeave)
    .where(
      and(
        eq(staffLeave.staffId, staffId),
        eq(staffLeave.status, "approved"),
        lte(staffLeave.startDate, shiftDetails.date),
        gte(staffLeave.endDate, shiftDetails.date)
      )
    )
    .all();
  if (leaveRecords.length > 0) {
    return { available: false, hoursThisWeek: 0, reason: "On approved leave" };
  }

  // 2. Same-date assignments: check for overlap and insufficient same-day rest
  const existingAssignments = db
    .select({
      assignmentId: assignment.id,
      shiftDate: shift.date,
      durationHours: shiftDefinition.durationHours,
      startTime: shiftDefinition.startTime,
      endTime: shiftDefinition.endTime,
    })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(
      and(
        eq(assignment.staffId, staffId),
        eq(shift.date, shiftDetails.date),
        ne(assignment.status, "cancelled")
      )
    )
    .all();

  for (const existing of existingAssignments) {
    if (shiftsOverlap(existing.startTime, existing.endTime, shiftDetails.startTime, shiftDetails.endTime)) {
      return { available: false, hoursThisWeek: 0, reason: "Already assigned to overlapping shift" };
    }
    const gapMins = sameDayShiftGapMinutes(
      existing.startTime, existing.endTime,
      shiftDetails.startTime, shiftDetails.endTime
    );
    if (gapMins < 10 * 60) {
      return {
        available: false,
        hoursThisWeek: 0,
        reason: `Insufficient rest between same-day shifts (${Math.round(gapMins / 60)}h gap)`,
      };
    }
  }

  // 3. Weekly hours + 60h cap
  const weekAssignments = db
    .select({ durationHours: shiftDefinition.durationHours })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(
      and(
        eq(assignment.staffId, staffId),
        gte(shift.date, format(weekStart, "yyyy-MM-dd")),
        lte(shift.date, format(weekEnd, "yyyy-MM-dd")),
        ne(assignment.status, "cancelled")
      )
    )
    .all();
  const hoursThisWeek = weekAssignments.reduce((sum, a) => sum + (a.durationHours || 0), 0);

  if (hoursThisWeek + shiftDetails.durationHours > 60) {
    return { available: false, hoursThisWeek, reason: "Would exceed 60 hours in 7 days" };
  }

  // 4. Rest hours — check D-1 and D+1 assignments
  //
  // Bug fix: the previous code used `newStartHour - prevEndHour` for the D-1
  // rest gap, which treats both times as if they're on the same calendar day.
  // A nurse who finished a day shift at 19:00 on D-1 has 24h of rest before a
  // shift starting at 19:00 on D, not 0h. The correct formula spans midnight:
  //   regular D-1 shift → gap = 24h − prevEnd + newStart
  //   overnight D-1 shift (ends early on D) → gap = newStart − prevEnd
  //
  // Also added: D+1 check. If the candidate has a shift on D+1 and the new
  // shift is overnight, we verify they have ≥10h rest after finishing it.
  const prevDate = format(addDays(shiftDate, -1), "yyyy-MM-dd");
  const nextDate = format(addDays(shiftDate, 1), "yyyy-MM-dd");

  const adjacentAssignments = db
    .select({
      date: shift.date,
      startTime: shiftDefinition.startTime,
      endTime: shiftDefinition.endTime,
    })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(
      and(
        eq(assignment.staffId, staffId),
        ne(assignment.status, "cancelled"),
        or(eq(shift.date, prevDate), eq(shift.date, nextDate))
      )
    )
    .all();

  const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m ?? 0); };
  const newStartMins = toMins(shiftDetails.startTime);
  // Overnight new shift: end is past midnight, so express as minutes from shiftDate midnight
  const newEndMins = shiftDetails.endTime <= shiftDetails.startTime
    ? toMins(shiftDetails.endTime) + 24 * 60
    : toMins(shiftDetails.endTime);

  let restHoursBefore: number | undefined;

  for (const adj of adjacentAssignments) {
    if (adj.date === prevDate) {
      // Gap from D-1 shift end → new shift start
      const adjEndMins = toMins(adj.endTime);
      const adjIsOvernight = adj.endTime <= adj.startTime;
      const gapMins = adjIsOvernight
        ? newStartMins - adjEndMins              // overnight D-1 ends on D — gap is simple subtraction
        : 24 * 60 - adjEndMins + newStartMins;  // regular D-1 ends on D-1 — gap spans midnight
      if (gapMins < 10 * 60) {
        return {
          available: false,
          hoursThisWeek,
          reason: `Insufficient rest before this shift (${Math.round(gapMins / 60)}h)`,
        };
      }
      if (restHoursBefore === undefined || gapMins / 60 < restHoursBefore) {
        restHoursBefore = gapMins / 60;
      }
    }

    if (adj.date === nextDate) {
      // Gap from new shift end → D+1 shift start
      // Express D+1 start as minutes from shiftDate midnight by adding 24h
      const nextStartFromD = toMins(adj.startTime) + 24 * 60;
      const gapMins = nextStartFromD - newEndMins;
      if (gapMins < 10 * 60) {
        return {
          available: false,
          hoursThisWeek,
          reason: `Insufficient rest after this shift (${Math.round(gapMins / 60)}h)`,
        };
      }
    }
  }

  return { available: true, hoursThisWeek, restHoursBefore };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function shiftsOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean {
  const toMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  };
  const s1 = toMinutes(start1);
  let e1 = toMinutes(end1);
  const s2 = toMinutes(start2);
  let e2 = toMinutes(end2);
  if (e1 < s1) e1 += 24 * 60;
  if (e2 < s2) e2 += 24 * 60;
  return s1 < e2 && s2 < e1;
}

/**
 * Returns the minimum forward time gap (in minutes) between two same-day
 * non-overlapping shifts. Both directions are checked and the smaller
 * positive gap is returned.
 *
 * Example: Day 07:00–19:00 then Night 19:00–07:00 → gap = 0 min.
 */
function sameDayShiftGapMinutes(
  start1: string, end1: string,
  start2: string, end2: string
): number {
  const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
  const s1 = toMins(start1);
  let e1 = toMins(end1);
  const s2 = toMins(start2);
  let e2 = toMins(end2);
  if (e1 < s1) e1 += 24 * 60;
  if (e2 < s2) e2 += 24 * 60;
  const gapA = s2 - e1;
  const gapB = s1 - e2;
  const pos = [gapA, gapB].filter((g) => g >= 0);
  return pos.length > 0 ? Math.min(...pos) : Infinity;
}
