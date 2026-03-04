/**
 * Post-generation output validation.
 *
 * Pure utility — no DB access. Takes scheduler output and context to identify
 * understaffed shifts that have NO documented hard-rule explanation AND still
 * had enough potentially available staff that the scheduler should have been
 * able to fill them.
 *
 * Two categories of legitimate understaffing (not flagged):
 *  1. Hard constraint deadlock — scheduler recorded specific rejection reasons
 *     (no charge nurse available, 60h cap exhausted, PRN has no availability, etc.)
 *  2. Genuine shortage — fewer staff are available for the date than slots required
 *
 * Anything else returned here is a signal that the scheduler has a logic bug —
 * it stopped filling a shift without a valid reason despite having enough staff.
 * Example: v1.5.5 bug where requiredStaffCount was 4 (shift definition) instead
 * of 5 (Green census band), so the scheduler stopped at 4 with 25 staff available.
 */
import type { UnderstaffedShift, SchedulerContext } from "./types";

export interface SuspiciousUnderstaffing extends UnderstaffedShift {
  /** Count of staff who were not on approved leave and (if PRN) had availability for this date. */
  potentiallyAvailable: number;
}

/**
 * For each entry in `understaffed`:
 *  - Skip if hard-rule reasons are recorded (constraint issue, not a logic bug).
 *  - Count staff who are potentially available: active, not on approved leave,
 *    and (if per_diem) have submitted availability for the shift date.
 *  - Flag as suspicious if potentiallyAvailable >= required.
 *
 * A non-empty return means the scheduler under-filled a shift without a documented
 * reason and despite having sufficient staff — investigate immediately.
 *
 * Uses `Pick` so callers can pass either a full SchedulerContext or a lightweight
 * object containing just the three required fields.
 */
export function checkForUnexplainedUnderstaffing(
  understaffed: UnderstaffedShift[],
  context: Pick<SchedulerContext, "staffList" | "staffLeaves" | "prnAvailability">
): SuspiciousUnderstaffing[] {
  const suspicious: SuspiciousUnderstaffing[] = [];

  for (const u of understaffed) {
    // Hard-rule reasons documented → constraint issue, not a logic bug
    if (u.reasons.length > 0) continue;

    const potentiallyAvailable = context.staffList.filter((s) => {
      if (!s.isActive) return false;

      // Approved leave blocks all scheduling on those dates
      const onLeave = context.staffLeaves.some(
        (l) =>
          l.staffId === s.id &&
          l.status === "approved" &&
          l.startDate <= u.date &&
          l.endDate >= u.date
      );
      if (onLeave) return false;

      // PRN staff can only work on dates they submitted availability for
      if (s.employmentType === "per_diem") {
        const avail = context.prnAvailability.find((a) => a.staffId === s.id);
        if (!avail?.availableDates.includes(u.date)) return false;
      }

      return true;
    }).length;

    // Only suspicious when there are genuinely enough staff — not a real shortage
    if (potentiallyAvailable >= u.required) {
      suspicious.push({ ...u, potentiallyAvailable });
    }
  }

  return suspicious;
}
