"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";

interface ShiftAssignment {
  id: string;
  staffId: string;
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

interface StaffOption {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  employmentType: string;
  icuCompetencyLevel: number;
  isChargeNurseQualified: boolean;
  reliabilityRating: number;
  isActive: boolean;
  eligible: boolean;
  alreadyAssigned: boolean;
  ineligibleReasons: string[];
  weeklyHours: number;
  standardWeeklyHours: number;
  wouldCauseOT: boolean;
  preferredShift: string | null;
  preferredDaysOff: string[];
  avoidWeekends: boolean;
}

export function AssignmentDialog({
  open,
  onOpenChange,
  shift,
  scheduleId,
  onAssign,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: ShiftData | null;
  scheduleId: string;
  onAssign: (shiftId: string, staffId: string, isChargeNurse: boolean) => void;
  onRemove: (assignmentId: string) => void;
}) {
  const [availableStaff, setAvailableStaff] = useState<StaffOption[]>([]);
  const [assignedContext, setAssignedContext] = useState<Map<string, StaffOption>>(new Map());

  useEffect(() => {
    if (open && shift) {
      // Fetch all staff with scheduling context for this shift.
      // Already-assigned staff come back with alreadyAssigned: true — used to
      // enrich the "Currently Assigned" section with hours and preference info.
      fetch(`/api/shifts/${shift.id}/eligible-staff?scheduleId=${scheduleId}`)
        .then((r) => r.json())
        .then((staff: StaffOption[]) => {
          setAvailableStaff(staff.filter((s) => !s.alreadyAssigned));
          setAssignedContext(
            new Map(staff.filter((s) => s.alreadyAssigned).map((s) => [s.id, s]))
          );
        });
    }
  }, [open, shift, scheduleId]);

  if (!shift) return null;

  // A shift still "needs charge" if no VALID charge nurse (Level 4+) is assigned.
  // A Level 3 nurse with isChargeNurse=true satisfies the flag but violates the
  // hard rule, so we must not treat them as a valid charge nurse here.
  const needsCharge =
    shift.requiresChargeNurse &&
    !shift.assignments.some((a) => a.isChargeNurse && a.staffCompetency >= 4);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {shift.name} - {format(parseISO(shift.date), "EEE, MMM d, yyyy")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Shift info */}
          <div className="flex gap-2 text-sm flex-wrap">
            <Badge variant="secondary">
              {shift.assignments.length}/{shift.requiredStaffCount} staff
            </Badge>
            {needsCharge && (
              <Badge variant="destructive">Needs charge nurse</Badge>
            )}
          </div>

          {/* Census tier (read-only — set on the Census page) */}
          {shift.acuityLevel ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30 text-sm">
              <span className="font-medium">Census:</span>
              <span
                className={`inline-flex items-center gap-1.5 font-medium ${
                  shift.acuityLevel === "blue"
                    ? "text-blue-600"
                    : shift.acuityLevel === "green"
                    ? "text-green-600"
                    : shift.acuityLevel === "yellow"
                    ? "text-yellow-600"
                    : "text-red-600"
                }`}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    shift.acuityLevel === "blue"
                      ? "bg-blue-500"
                      : shift.acuityLevel === "green"
                      ? "bg-green-500"
                      : shift.acuityLevel === "yellow"
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                />
                {shift.acuityLevel === "blue"
                  ? "Low Census"
                  : shift.acuityLevel === "green"
                  ? "Normal"
                  : shift.acuityLevel === "yellow"
                  ? "Elevated"
                  : "Critical"}
              </span>
              <a
                href="/census"
                className="ml-auto text-xs text-muted-foreground underline hover:text-foreground"
              >
                Edit on Census page
              </a>
            </div>
          ) : null}

          {/* Current assignments */}
          {shift.assignments.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Currently Assigned</h3>
              <div className="space-y-1">
                {shift.assignments.map((a) => {
                  const ctx = assignedContext.get(a.staffId);
                  const shiftDayName = format(parseISO(shift.date), "EEEE");
                  const isWeekend = [0, 6].includes(parseISO(shift.date).getDay());
                  const prefMismatch =
                    ctx?.preferredShift && ctx.preferredShift !== "any" && ctx.preferredShift !== shift.shiftType
                      ? `Prefers ${ctx.preferredShift}`
                      : null;
                  const dayOffMismatch =
                    ctx?.preferredDaysOff.includes(shiftDayName) ? `Prefers ${shiftDayName} off` : null;
                  const weekendMismatch = isWeekend && ctx?.avoidWeekends ? "Avoids weekends" : null;
                  const aboveFTE =
                    ctx && ctx.standardWeeklyHours < 40 && ctx.weeklyHours >= ctx.standardWeeklyHours;

                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {a.staffFirstName} {a.staffLastName}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {a.staffRole}
                          </Badge>
                          {a.isChargeNurse && (
                            <Badge className="text-xs">Charge</Badge>
                          )}
                          {a.isOvertime && (
                            <Badge variant="destructive" className="text-xs">
                              OT
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            Level {a.staffCompetency}/5
                          </span>
                        </div>
                        {ctx && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs ${aboveFTE ? "text-amber-600" : "text-muted-foreground"}`}>
                              {ctx.weeklyHours}h this week
                              {ctx.standardWeeklyHours < 40 && ` (${ctx.standardWeeklyHours}h FTE target)`}
                            </span>
                            {prefMismatch && (
                              <span className="text-xs text-amber-600">{prefMismatch}</span>
                            )}
                            {dayOffMismatch && (
                              <span className="text-xs text-amber-600">{dayOffMismatch}</span>
                            )}
                            {weekendMismatch && (
                              <span className="text-xs text-amber-600">{weekendMismatch}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive shrink-0 ml-2"
                        onClick={() => onRemove(a.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available staff */}
          {(() => {
            const employmentLabels: Record<string, string> = {
              full_time: "FT",
              part_time: "PT",
              per_diem: "PRN",
              float: "Float",
              agency: "Agency",
            };
            const eligible = availableStaff.filter((s) => s.eligible);
            const ineligible = availableStaff.filter((s) => !s.eligible);

            return (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    Available Staff
                    {eligible.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {eligible.length} can be assigned
                      </span>
                    )}
                  </h3>
                  {eligible.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No staff available for this shift (all blocked by scheduling rules).
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {eligible.map((s) => {
                        // Build detail hints for the second line
                        const shiftDayName = format(parseISO(shift.date), "EEEE");
                        const isWeekend = [0, 6].includes(parseISO(shift.date).getDay());
                        const prefMismatch =
                          s.preferredShift && s.preferredShift !== "any" && s.preferredShift !== shift.shiftType
                            ? `Prefers ${s.preferredShift}`
                            : null;
                        const dayOffMismatch =
                          s.preferredDaysOff.includes(shiftDayName) ? `Prefers ${shiftDayName} off` : null;
                        const weekendMismatch = isWeekend && s.avoidWeekends ? "Avoids weekends" : null;

                        const aboveFTE =
                          s.standardWeeklyHours < 40 && s.weeklyHours >= s.standardWeeklyHours;

                        return (
                          <div
                            key={s.id}
                            className="flex items-center justify-between rounded-md border px-3 py-2"
                          >
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium">
                                  {s.firstName} {s.lastName}
                                </span>
                                <Badge variant="secondary" className="text-xs">
                                  {s.role}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {employmentLabels[s.employmentType] || s.employmentType}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Level {s.icuCompetencyLevel}/5
                                </span>
                                {s.isChargeNurseQualified && (
                                  <Badge variant="outline" className="text-xs">
                                    Charge RN
                                  </Badge>
                                )}
                              </div>
                              {/* Detail line */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs ${aboveFTE ? "text-amber-600" : "text-muted-foreground"}`}>
                                  {s.weeklyHours}h this week
                                  {s.standardWeeklyHours < 40 && ` (${s.standardWeeklyHours}h FTE target)`}
                                </span>
                                {s.wouldCauseOT && (
                                  <Badge variant="destructive" className="text-xs py-0">
                                    Would OT
                                  </Badge>
                                )}
                                {prefMismatch && (
                                  <span className="text-xs text-amber-600">{prefMismatch}</span>
                                )}
                                {dayOffMismatch && (
                                  <span className="text-xs text-amber-600">{dayOffMismatch}</span>
                                )}
                                {weekendMismatch && (
                                  <span className="text-xs text-amber-600">{weekendMismatch}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0 ml-2">
                              {s.isChargeNurseQualified && s.icuCompetencyLevel >= 4 && needsCharge && (
                                <Button
                                  size="sm"
                                  onClick={() => onAssign(shift.id, s.id, true)}
                                >
                                  Assign as Charge
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => onAssign(shift.id, s.id, false)}
                              >
                                Assign
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {ineligible.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                      Unavailable ({ineligible.length})
                    </h3>
                    <div className="space-y-1">
                      {ineligible.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 opacity-50"
                        >
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">
                                {s.firstName} {s.lastName}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {s.role}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                Level {s.icuCompetencyLevel}/5
                              </span>
                            </div>
                            {s.ineligibleReasons.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {s.ineligibleReasons.join(" · ")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
