"use client";

import { Badge } from "@/components/ui/badge";
import { format, parseISO } from "date-fns";

interface ShiftAssignment {
  id: string;
  staffId: string;
  status: string;
  isChargeNurse: boolean;
  isOvertime: boolean;
  staffFirstName: string;
  staffLastName: string;
  staffRole: string;
  staffCompetency: number;
}

interface ShiftData {
  id: string;
  date: string;
  shiftType: string;
  name: string;
  requiredStaffCount: number;
  requiresChargeNurse: boolean;
  actualCensus: number | null;
  acuityLevel: "blue" | "green" | "yellow" | "red" | null;
  assignments: ShiftAssignment[];
}

interface RuleViolation {
  ruleId: string;
  ruleName: string;
  ruleType: "hard" | "soft";
  shiftId: string;
  staffId?: string;
  description: string;
  penaltyScore?: number;
}

interface ScheduleGridProps {
  shifts: ShiftData[];
  onShiftClick: (shift: ShiftData) => void;
  onViolationsClick?: (shift: ShiftData, violations: RuleViolation[]) => void;
  violations: Map<string, string[]>;
  violationDetails?: Map<string, RuleViolation[]>;
  softViolations?: Map<string, string[]>;
}

export function ScheduleGrid({ shifts, onShiftClick, onViolationsClick, violations, violationDetails, softViolations }: ScheduleGridProps) {
  // Group shifts by date
  const dateGroups = new Map<string, ShiftData[]>();
  for (const s of shifts) {
    const list = dateGroups.get(s.date) ?? [];
    list.push(s);
    dateGroups.set(s.date, list);
  }

  const sortedDates = [...dateGroups.keys()].sort();

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="sticky left-0 bg-background px-3 py-2 text-left font-medium">
              Date
            </th>
            <th className="min-w-[250px] px-3 py-2 text-left font-medium">
              Day Shift (07:00-19:00)
            </th>
            <th className="min-w-[250px] px-3 py-2 text-left font-medium">
              Night Shift (19:00-07:00)
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedDates.map((date) => {
            const dayShifts = dateGroups.get(date) ?? [];
            const day = dayShifts.find((s) => s.shiftType === "day");
            const night = dayShifts.find((s) => s.shiftType === "night");
            const dateObj = parseISO(date);
            const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;

            return (
              <tr
                key={date}
                className={`border-b ${isWeekend ? "bg-muted/30" : ""}`}
              >
                <td className="sticky left-0 bg-background px-3 py-2 font-medium whitespace-nowrap">
                  <div>{format(dateObj, "EEE, MMM d")}</div>
                  {isWeekend && (
                    <span className="text-xs text-muted-foreground">Weekend</span>
                  )}
                </td>
                {[day, night].map((shiftData, i) => (
                  <td key={i} className="px-2 py-1">
                    {shiftData ? (
                      <ShiftCell
                        shift={shiftData}
                        onClick={() => onShiftClick(shiftData)}
                        onViolationsClick={
                          onViolationsClick
                            ? () => onViolationsClick(shiftData, violationDetails?.get(shiftData.id) ?? [])
                            : undefined
                        }
                        violations={violations.get(shiftData.id) ?? []}
                        softViolationCount={softViolations?.get(shiftData.id)?.length ?? 0}
                      />
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ShiftCell({
  shift,
  onClick,
  onViolationsClick,
  violations,
  softViolationCount,
}: {
  shift: ShiftData;
  onClick: () => void;
  onViolationsClick?: () => void;
  violations: string[];
  softViolationCount: number;
}) {
  const activeAssignments = shift.assignments.filter((a) => a.status !== "cancelled");
  const cancelledAssignments = shift.assignments.filter((a) => a.status === "cancelled");
  const staffCount = activeAssignments.length;
  const isFull = staffCount >= shift.requiredStaffCount;
  const hasCharge = activeAssignments.some((a) => a.isChargeNurse);
  const hasHardViolations = violations.length > 0;
  const hasSoftViolations = softViolationCount > 0;

  let borderColor = "border-border";
  if (hasHardViolations) {
    borderColor = "border-red-400";
  } else if (hasSoftViolations) {
    borderColor = "border-yellow-400";
  } else if (isFull && (!shift.requiresChargeNurse || hasCharge)) {
    borderColor = "border-green-400";
  } else if (staffCount > 0) {
    borderColor = "border-orange-300";
  }

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md border-2 ${borderColor} bg-card p-2 text-left transition-colors hover:bg-accent`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {staffCount}/{shift.requiredStaffCount} staff
        </span>
        <div className="flex gap-1">
          {hasHardViolations && (
            <Badge
              variant="destructive"
              className="text-[10px] px-1 py-0 cursor-pointer hover:bg-red-700"
              onClick={(e) => {
                e.stopPropagation();
                onViolationsClick?.();
              }}
            >
              {violations.length} hard
            </Badge>
          )}
          {hasSoftViolations && (
            <Badge
              className="text-[10px] px-1 py-0 bg-yellow-500 text-white cursor-pointer hover:bg-yellow-600"
              onClick={(e) => {
                e.stopPropagation();
                onViolationsClick?.();
              }}
            >
              {softViolationCount} soft
            </Badge>
          )}
        </div>
      </div>
      <div className="space-y-0.5">
        {activeAssignments.map((a) => (
          <div key={a.id} className="flex items-center gap-1 text-xs">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                a.isChargeNurse ? "bg-blue-500" : "bg-gray-400"
              }`}
            />
            <span className="truncate">
              {a.staffFirstName} {a.staffLastName[0]}.
            </span>
            <Badge variant="secondary" className="text-[9px] px-1 py-0">
              {a.staffRole}
            </Badge>
            {a.isOvertime && (
              <Badge variant="destructive" className="text-[9px] px-1 py-0">
                OT
              </Badge>
            )}
          </div>
        ))}
        {cancelledAssignments.map((a) => (
          <div key={a.id} className="flex items-center gap-1 text-xs opacity-60">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-400" />
            <span className="truncate line-through text-muted-foreground">
              {a.staffFirstName} {a.staffLastName[0]}.
            </span>
            <Badge className="text-[9px] px-1 py-0 bg-orange-100 text-orange-700 border border-orange-300">
              Leave
            </Badge>
          </div>
        ))}
        {staffCount === 0 && cancelledAssignments.length === 0 && (
          <span className="text-xs text-muted-foreground italic">
            No staff assigned
          </span>
        )}
      </div>
      {shift.actualCensus !== null && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Census: {shift.actualCensus}
        </div>
      )}
    </button>
  );
}
