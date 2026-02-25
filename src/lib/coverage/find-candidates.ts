import { db } from "@/db";
import { staff, assignment, shift, shiftDefinition, staffLeave, prnAvailability, schedule } from "@/db/schema";
import { eq, and, ne, gte, lte, or, inArray } from "drizzle-orm";
import { addDays, parseISO, format, differenceInDays, startOfWeek, endOfWeek } from "date-fns";

export interface CandidateRecommendation {
  staffId: string;
  staffName: string;
  source: "float" | "per_diem" | "overtime" | "agency";
  reasons: string[];
  score: number;
  isOvertime: boolean;
  hoursThisWeek: number;
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
  // Get shift details
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

  const allCandidates: CandidateRecommendation[] = [];
  const escalationStepsChecked: string[] = [];

  // Step 1: Check Float Pool
  escalationStepsChecked.push("float");
  const floatCandidates = await findFloatCandidates(shiftRecord, excludeStaffId);
  allCandidates.push(...floatCandidates);

  // Step 2: Check PRN Staff
  escalationStepsChecked.push("per_diem");
  const prnCandidates = await findPRNCandidates(shiftRecord, excludeStaffId);
  allCandidates.push(...prnCandidates);

  // Step 3: Check Regular Staff for Overtime
  escalationStepsChecked.push("overtime");
  const otCandidates = await findOvertimeCandidates(shiftRecord, excludeStaffId);
  allCandidates.push(...otCandidates);

  // Step 4: Agency option (placeholder - requires external contact)
  escalationStepsChecked.push("agency");
  // Agency is always an option but scored lowest
  allCandidates.push({
    staffId: "agency",
    staffName: "Request Agency Staff",
    source: "agency",
    reasons: ["External staffing agency", "Requires phone call to agency", "Higher cost option"],
    score: 10, // Lowest priority score
    isOvertime: false,
    hoursThisWeek: 0,
  });

  // Sort by score (higher is better) and take top 3
  const sortedCandidates = allCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    candidates: sortedCandidates,
    escalationStepsChecked,
  };
}

async function findFloatCandidates(
  shiftDetails: ShiftDetails,
  excludeStaffId?: string
): Promise<CandidateRecommendation[]> {
  const candidates: CandidateRecommendation[] = [];

  // Find active float pool staff
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
    const availability = await checkStaffAvailability(s.id, shiftDetails);
    if (!availability.available) continue;

    const reasons: string[] = ["Float pool staff - designed for coverage"];

    // Check if cross-trained for this unit
    const crossTrained = s.crossTrainedUnits?.includes(shiftDetails.unit) || s.homeUnit === shiftDetails.unit;
    if (crossTrained) {
      reasons.push(`Cross-trained for ${shiftDetails.unit}`);
    }

    // Check competency
    if (s.icuCompetencyLevel >= 3) {
      reasons.push(`Competency Level ${s.icuCompetencyLevel} (Competent+)`);
    }

    // Calculate score (higher = better)
    let score = 100; // Float pool is highest priority
    if (crossTrained) score += 20;
    score += s.icuCompetencyLevel * 5;
    score += s.reliabilityRating * 3;

    candidates.push({
      staffId: s.id,
      staffName: `${s.firstName} ${s.lastName}`,
      source: "float",
      reasons,
      score,
      isOvertime: availability.hoursThisWeek + shiftDetails.durationHours > 40,
      hoursThisWeek: availability.hoursThisWeek,
    });
  }

  return candidates;
}

async function findPRNCandidates(
  shiftDetails: ShiftDetails,
  excludeStaffId?: string
): Promise<CandidateRecommendation[]> {
  const candidates: CandidateRecommendation[] = [];

  // Find active PRN staff
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
    // Check if PRN has marked this date as available
    const prnAvail = db
      .select()
      .from(prnAvailability)
      .where(eq(prnAvailability.staffId, s.id))
      .all();

    const isDateAvailable = prnAvail.some(
      (a) => a.availableDates?.includes(shiftDetails.date)
    );

    if (!isDateAvailable) continue;

    const availability = await checkStaffAvailability(s.id, shiftDetails);
    if (!availability.available) continue;

    const reasons: string[] = ["PRN staff - marked available for this date"];

    // Check unit qualification
    const qualifiedForUnit = s.homeUnit === shiftDetails.unit ||
      s.crossTrainedUnits?.includes(shiftDetails.unit);
    if (qualifiedForUnit) {
      reasons.push(`Qualified for ${shiftDetails.unit}`);
    } else {
      continue; // Skip if not qualified for unit
    }

    // Check reliability
    if (s.reliabilityRating >= 4) {
      reasons.push(`High reliability rating (${s.reliabilityRating}/5)`);
    }

    // Calculate score
    let score = 80; // PRN is second priority
    score += s.icuCompetencyLevel * 5;
    score += s.reliabilityRating * 5;
    if (s.homeUnit === shiftDetails.unit) score += 10;

    candidates.push({
      staffId: s.id,
      staffName: `${s.firstName} ${s.lastName}`,
      source: "per_diem",
      reasons,
      score,
      isOvertime: false, // PRN doesn't have regular hours
      hoursThisWeek: availability.hoursThisWeek,
    });
  }

  return candidates;
}

async function findOvertimeCandidates(
  shiftDetails: ShiftDetails,
  excludeStaffId?: string
): Promise<CandidateRecommendation[]> {
  const candidates: CandidateRecommendation[] = [];

  // Find active full-time and part-time staff
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
    const availability = await checkStaffAvailability(s.id, shiftDetails);
    if (!availability.available) continue;

    // Check unit qualification
    const qualifiedForUnit = s.homeUnit === shiftDetails.unit ||
      s.crossTrainedUnits?.includes(shiftDetails.unit);
    if (!qualifiedForUnit) continue;

    const reasons: string[] = [];
    const wouldBeOvertime = availability.hoursThisWeek + shiftDetails.durationHours > 40;

    if (wouldBeOvertime) {
      reasons.push("Would be overtime (OT pay applies)");
    } else {
      reasons.push("Extra shift (within 40 hours)");
    }

    if (s.homeUnit === shiftDetails.unit) {
      reasons.push(`Home unit is ${shiftDetails.unit}`);
    } else {
      reasons.push(`Cross-trained for ${shiftDetails.unit}`);
    }

    // Prefer staff with lower flex hours (fairness)
    if (s.flexHoursYearToDate < 20) {
      reasons.push("Low flex hours YTD (fair distribution)");
    }

    // Calculate score (overtime is lower priority than PRN)
    let score = 60;
    if (!wouldBeOvertime) score += 15; // Prefer non-OT
    score += s.icuCompetencyLevel * 3;
    score += s.reliabilityRating * 3;
    if (s.homeUnit === shiftDetails.unit) score += 10;
    // Penalize staff with high flex hours (they've been sent home more)
    score -= Math.min(s.flexHoursYearToDate / 10, 10);

    candidates.push({
      staffId: s.id,
      staffName: `${s.firstName} ${s.lastName}`,
      source: "overtime",
      reasons,
      score,
      isOvertime: wouldBeOvertime,
      hoursThisWeek: availability.hoursThisWeek,
    });
  }

  return candidates;
}

interface AvailabilityResult {
  available: boolean;
  hoursThisWeek: number;
  reason?: string;
}

async function checkStaffAvailability(
  staffId: string,
  shiftDetails: ShiftDetails
): Promise<AvailabilityResult> {
  const shiftDate = parseISO(shiftDetails.date);
  const weekStart = startOfWeek(shiftDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(shiftDate, { weekStartsOn: 0 });

  // Check if staff is on approved leave
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

  // Check if already assigned to a shift on this date
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

  // Check for overlapping shifts and insufficient same-day rest
  for (const existing of existingAssignments) {
    if (shiftsOverlap(existing.startTime, existing.endTime, shiftDetails.startTime, shiftDetails.endTime)) {
      return { available: false, hoursThisWeek: 0, reason: "Already assigned to overlapping shift" };
    }
    // Non-overlapping same-day shifts still need ≥10 hours gap
    // e.g. Day 07:00–19:00 followed by Night 19:00–07:00 = 0 hours rest
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

  // Calculate hours worked this week
  const weekAssignments = db
    .select({
      durationHours: shiftDefinition.durationHours,
    })
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

  // Check 60-hour limit
  if (hoursThisWeek + shiftDetails.durationHours > 60) {
    return { available: false, hoursThisWeek, reason: "Would exceed 60 hours in 7 days" };
  }

  // Check minimum rest (10 hours between shifts)
  const previousDayAssignments = db
    .select({
      endTime: shiftDefinition.endTime,
      shiftDate: shift.date,
    })
    .from(assignment)
    .innerJoin(shift, eq(assignment.shiftId, shift.id))
    .innerJoin(shiftDefinition, eq(shift.shiftDefinitionId, shiftDefinition.id))
    .where(
      and(
        eq(assignment.staffId, staffId),
        eq(shift.date, format(addDays(shiftDate, -1), "yyyy-MM-dd")),
        ne(assignment.status, "cancelled")
      )
    )
    .all();

  for (const prev of previousDayAssignments) {
    // If previous shift ends late and new shift starts early, check rest period
    const prevEndHour = parseInt(prev.endTime.split(":")[0]);
    const newStartHour = parseInt(shiftDetails.startTime.split(":")[0]);

    // Night shift ending at 7am, day shift starting at 7am = 0 hours rest (or 24 + diff for crossing midnight)
    let restHours: number;
    if (prevEndHour > newStartHour) {
      // Previous shift ended after new shift would start (crossing midnight)
      restHours = 24 - prevEndHour + newStartHour;
    } else {
      restHours = newStartHour - prevEndHour;
    }

    if (restHours < 10) {
      return { available: false, hoursThisWeek, reason: "Insufficient rest time (< 10 hours)" };
    }
  }

  return { available: true, hoursThisWeek };
}

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

  // Handle overnight shifts
  if (e1 < s1) e1 += 24 * 60;
  if (e2 < s2) e2 += 24 * 60;

  // Check overlap
  return s1 < e2 && s2 < e1;
}

/**
 * Returns the minimum forward time gap (in minutes) between two same-day
 * non-overlapping shifts.  Both directions are checked and the smaller
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
  if (e1 < s1) e1 += 24 * 60; // normalize overnight
  if (e2 < s2) e2 += 24 * 60;
  // Gap A: shift1 ends then shift2 starts
  const gapA = s2 - e1;
  // Gap B: shift2 ends then shift1 starts
  const gapB = s1 - e2;
  const pos = [gapA, gapB].filter((g) => g >= 0);
  return pos.length > 0 ? Math.min(...pos) : Infinity;
}
