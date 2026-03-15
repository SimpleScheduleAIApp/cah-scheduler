import type { AssignmentDraft } from "./types";

// ─── Date / time helpers ─────────────────────────────────────────────────────

export function toDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

export function shiftEndDateTime(
  date: string,
  startTime: string,
  durationHours: number
): Date {
  const start = toDateTime(date, startTime);
  return new Date(start.getTime() + durationHours * 60 * 60 * 1000);
}

export function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // days to preceding Monday
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function getWeekEnd(weekStart: string): string {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + 6);
  return date.toISOString().slice(0, 10);
}

function getWeekendId(dateStr: string): string {
  // Anchor Sunday back to Saturday so both share the same weekend identifier
  const date = new Date(dateStr);
  if (date.getDay() === 0) date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10); // Saturday date as the ID
}

// ─── SchedulerState ──────────────────────────────────────────────────────────

/**
 * Mutable state maintained during greedy construction.
 * All lookups are O(1) or O(assignments per staff), avoiding full scans.
 */
export class SchedulerState {
  private assignmentsByStaff = new Map<string, AssignmentDraft[]>();
  private assignmentsByShift = new Map<string, AssignmentDraft[]>();
  private workedDatesByStaff = new Map<string, Set<string>>();

  addAssignment(draft: AssignmentDraft): void {
    // Staff list — maintain sorted order by date then startTime for predictable retrieval
    const staffList = this.assignmentsByStaff.get(draft.staffId) ?? [];
    staffList.push(draft);
    staffList.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.startTime < y.startTime ? -1 : x.startTime > y.startTime ? 1 : 0);
    this.assignmentsByStaff.set(draft.staffId, staffList);

    // Shift list
    const shiftList = this.assignmentsByShift.get(draft.shiftId) ?? [];
    shiftList.push(draft);
    this.assignmentsByShift.set(draft.shiftId, shiftList);

    // Worked dates set
    const dates = this.workedDatesByStaff.get(draft.staffId) ?? new Set<string>();
    dates.add(draft.date);
    this.workedDatesByStaff.set(draft.staffId, dates);
  }

  removeAssignment(draft: AssignmentDraft): void {
    // Remove from assignmentsByStaff
    const staffList = this.assignmentsByStaff.get(draft.staffId);
    if (staffList) {
      const idx = staffList.findIndex(
        (a) => a.shiftId === draft.shiftId && a.date === draft.date && a.startTime === draft.startTime
      );
      if (idx !== -1) staffList.splice(idx, 1);
    }

    // Remove from assignmentsByShift
    const shiftList = this.assignmentsByShift.get(draft.shiftId);
    if (shiftList) {
      const idx = shiftList.findIndex((a) => a.staffId === draft.staffId);
      if (idx !== -1) shiftList.splice(idx, 1);
    }

    // Update workedDatesByStaff — only remove the date if no other assignment
    // for this staff on this date remains
    const remaining = this.assignmentsByStaff.get(draft.staffId) ?? [];
    if (!remaining.some((a) => a.date === draft.date)) {
      this.workedDatesByStaff.get(draft.staffId)?.delete(draft.date);
    }
  }

  getStaffAssignments(staffId: string): AssignmentDraft[] {
    return this.assignmentsByStaff.get(staffId) ?? [];
  }

  getShiftAssignments(shiftId: string): AssignmentDraft[] {
    return this.assignmentsByShift.get(shiftId) ?? [];
  }

  /**
   * Returns the end Date of the last shift for `staffId` that finishes
   * before the given new shift starts (needed for rest-hours check).
   */
  getLastShiftEndBefore(staffId: string, newShiftStart: Date): Date | null {
    const list = this.assignmentsByStaff.get(staffId) ?? [];
    let lastEnd: Date | null = null;
    for (const a of list) {
      const end = shiftEndDateTime(a.date, a.startTime, a.durationHours);
      if (end.getTime() <= newShiftStart.getTime()) {
        if (!lastEnd || end > lastEnd) lastEnd = end;
      }
    }
    return lastEnd;
  }

  /**
   * Returns true if adding an assignment on `targetDate` would result in
   * a consecutive run longer than `maxConsecutive` days.
   */
  wouldExceedConsecutiveDays(staffId: string, targetDate: string, maxConsecutive: number): boolean {
    const dates = this.workedDatesByStaff.get(staffId) ?? new Set<string>();
    const d = new Date(targetDate);
    let count = 1; // the target day itself

    // Count backwards
    for (let i = 1; i <= maxConsecutive; i++) {
      const prev = new Date(d);
      prev.setDate(prev.getDate() - i);
      if (dates.has(prev.toISOString().slice(0, 10))) count++;
      else break;
    }
    // Count forwards
    for (let i = 1; i <= maxConsecutive; i++) {
      const next = new Date(d);
      next.setDate(next.getDate() + i);
      if (dates.has(next.toISOString().slice(0, 10))) count++;
      else break;
    }

    return count > maxConsecutive;
  }

  /** Hours already worked during the calendar week (Mon–Sun) containing `date`. */
  getWeeklyHours(staffId: string, date: string): number {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(weekStart);
    return (this.assignmentsByStaff.get(staffId) ?? [])
      .filter((a) => a.date >= weekStart && a.date <= weekEnd)
      .reduce((sum, a) => sum + a.durationHours, 0);
  }

  /** Hours worked in the rolling 7-day window ending on (and including) `date`. */
  getRolling7DayHours(staffId: string, date: string): number {
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 6);
    const startStr = startDate.toISOString().slice(0, 10);
    return (this.assignmentsByStaff.get(staffId) ?? [])
      .filter((a) => a.date >= startStr && a.date <= date)
      .reduce((sum, a) => sum + a.durationHours, 0);
  }

  /**
   * Returns true if adding a shift of `durationHours` on `date` would push ANY of
   * the 7 rolling windows that contain `date` over `limit` hours.
   *
   * Why 7 windows?  The existing single-window backward check (ending at `date`) misses
   * violations in windows that START before `date` and extend past it. Because the
   * scheduler processes ICU shifts first, future shifts can already be in the state
   * when an earlier date is checked — the backward window sees nothing, but the forward
   * window [date … date+6] would expose the violation.
   */
  wouldExceed7DayHours(
    staffId: string,
    date: string,
    durationHours: number,
    limit: number
  ): boolean {
    const dateObj = new Date(date);
    const assignments = this.assignmentsByStaff.get(staffId) ?? [];

    // Windows containing `date` start from (date − 6) through date itself
    for (let offset = 0; offset <= 6; offset++) {
      const windowStart = new Date(dateObj);
      windowStart.setDate(windowStart.getDate() - offset);
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 6);
      const startStr = windowStart.toISOString().slice(0, 10);
      const endStr = windowEnd.toISOString().slice(0, 10);

      const existing = assignments
        .filter((a) => a.date >= startStr && a.date <= endStr)
        .reduce((sum, a) => sum + a.durationHours, 0);

      if (existing + durationHours > limit) return true;
    }
    return false;
  }

  /**
   * Charge-protection look-ahead helper.
   *
   * Returns true if adding a shift of `newDuration` on `newDate` to this
   * nurse's assignments would cause them to fail the 60h eligibility check for
   * a future shift of `futureDuration` on `futureDate`.
   *
   * Used in greedy.ts to detect when a charge-qualified nurse would be
   * "used up" by a regular slot before a critical ICU/ER charge shift.
   */
  wouldExceed7DayHoursAfterAdding(
    staffId: string,
    newDate: string,
    newDuration: number,
    futureDate: string,
    futureDuration: number,
    limit: number
  ): boolean {
    const futureDateObj = new Date(futureDate);
    const assignments = this.assignmentsByStaff.get(staffId) ?? [];

    for (let offset = 0; offset <= 6; offset++) {
      const windowStart = new Date(futureDateObj);
      windowStart.setDate(windowStart.getDate() - offset);
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 6);
      const startStr = windowStart.toISOString().slice(0, 10);
      const endStr = windowEnd.toISOString().slice(0, 10);

      const existing = assignments
        .filter((a) => a.date >= startStr && a.date <= endStr)
        .reduce((sum, a) => sum + a.durationHours, 0);

      // Count the current (proposed) assignment if it falls inside this window
      const currentExtra = newDate >= startStr && newDate <= endStr ? newDuration : 0;

      if (existing + currentExtra + futureDuration > limit) return true;
    }
    return false;
  }

  /**
   * Returns the peak hours in any rolling 7-day window containing `date`.
   * Used to build human-readable rejection messages.
   */
  getPeak7DayHours(staffId: string, date: string): number {
    const dateObj = new Date(date);
    const assignments = this.assignmentsByStaff.get(staffId) ?? [];
    let peak = 0;

    for (let offset = 0; offset <= 6; offset++) {
      const windowStart = new Date(dateObj);
      windowStart.setDate(windowStart.getDate() - offset);
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 6);
      const startStr = windowStart.toISOString().slice(0, 10);
      const endStr = windowEnd.toISOString().slice(0, 10);

      const hours = assignments
        .filter((a) => a.date >= startStr && a.date <= endStr)
        .reduce((sum, a) => sum + a.durationHours, 0);

      if (hours > peak) peak = hours;
    }
    return peak;
  }

  /** O(1) check: did this staff member work on this specific date? */
  hasWorkedDate(staffId: string, date: string): boolean {
    return this.workedDatesByStaff.get(staffId)?.has(date) ?? false;
  }

  /** Total number of weekend-day assignments for `staffId` so far. */
  getWeekendCount(staffId: string): number {
    return (this.assignmentsByStaff.get(staffId) ?? []).filter((a) => {
      const day = new Date(a.date).getDay();
      return day === 0 || day === 6;
    }).length;
  }

  /** Count on-call shifts this calendar week for `staffId`. */
  getOnCallCountThisWeek(staffId: string, date: string): number {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(weekStart);
    return (this.assignmentsByStaff.get(staffId) ?? []).filter(
      (a) => a.date >= weekStart && a.date <= weekEnd && a.shiftType === "on_call"
    ).length;
  }

  /** Count distinct weekends in the current month where `staffId` is on-call. */
  getOnCallWeekendsThisMonth(staffId: string, date: string): number {
    const month = date.slice(0, 7); // YYYY-MM
    const weekendIds = new Set<string>();
    for (const a of this.assignmentsByStaff.get(staffId) ?? []) {
      if (!a.date.startsWith(month) || a.shiftType !== "on_call") continue;
      const d = new Date(a.date).getDay();
      if (d === 0 || d === 6) weekendIds.add(getWeekendId(a.date));
    }
    return weekendIds.size;
  }

  /**
   * Returns the start Date of the earliest existing assignment for `staffId`
   * that begins at or after `newShiftEnd` (needed for forward rest-hours check).
   */
  getNextShiftStartAfter(staffId: string, newShiftEnd: Date): Date | null {
    const list = this.assignmentsByStaff.get(staffId) ?? [];
    let nextStart: Date | null = null;
    for (const a of list) {
      const aStart = toDateTime(a.date, a.startTime);
      if (aStart.getTime() >= newShiftEnd.getTime()) {
        if (!nextStart || aStart < nextStart) nextStart = aStart;
      }
    }
    return nextStart;
  }

  /** True if `staffId` has any existing assignment whose time overlaps [start, end). */
  hasOverlapWith(staffId: string, newStart: Date, newEnd: Date): boolean {
    for (const a of this.assignmentsByStaff.get(staffId) ?? []) {
      const aStart = toDateTime(a.date, a.startTime);
      const aEnd = shiftEndDateTime(a.date, a.startTime, a.durationHours);
      if (aStart < newEnd && aEnd > newStart) return true;
    }
    return false;
  }

  /** Shallow clone for local-search swap evaluation. */
  clone(): SchedulerState {
    const copy = new SchedulerState();
    for (const [id, list] of this.assignmentsByStaff) {
      copy.assignmentsByStaff.set(id, [...list]);
    }
    for (const [id, list] of this.assignmentsByShift) {
      copy.assignmentsByShift.set(id, [...list]);
    }
    for (const [id, dates] of this.workedDatesByStaff) {
      copy.workedDatesByStaff.set(id, new Set(dates));
    }
    return copy;
  }
}
