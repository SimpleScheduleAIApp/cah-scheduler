/**
 * Pure helper: given a schedule's date range and a list of shift definitions,
 * returns the array of shift records to insert — one per day × per definition.
 *
 * Keeping this separate from the DB call makes it trivially testable.
 */
export interface ShiftDefinitionLike {
  id: string;
  requiredStaffCount: number;
  requiresChargeNurse: boolean;
}

export interface ShiftInsertValues {
  scheduleId: string;
  shiftDefinitionId: string;
  date: string; // YYYY-MM-DD
  requiredStaffCount: number;
  requiresChargeNurse: boolean;
  acuityLevel?: "blue" | "green" | "yellow" | "red" | null;
  censusBandId?: string | null;
}

/**
 * Enumerates every (date, definition) combination for the given range.
 * Both `startDate` and `endDate` are inclusive (YYYY-MM-DD strings).
 * `defaultAcuityLevel` and `defaultCensusBandId` seed each shift with Green
 * so the census tier system works immediately on newly created schedules.
 */
export function buildShiftInserts(
  scheduleId: string,
  startDate: string,
  endDate: string,
  definitions: ShiftDefinitionLike[],
  defaultAcuityLevel?: "blue" | "green" | "yellow" | "red" | null,
  defaultCensusBandId?: string | null,
): ShiftInsertValues[] {
  if (definitions.length === 0) return [];

  const result: ShiftInsertValues[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    for (const def of definitions) {
      result.push({
        scheduleId,
        shiftDefinitionId: def.id,
        date: dateStr,
        requiredStaffCount: def.requiredStaffCount,
        requiresChargeNurse: def.requiresChargeNurse,
        acuityLevel: defaultAcuityLevel ?? null,
        censusBandId: defaultCensusBandId ?? null,
      });
    }
  }

  return result;
}
