"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  onCensusChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: ShiftData | null;
  scheduleId: string;
  onAssign: (shiftId: string, staffId: string, isChargeNurse: boolean) => void;
  onRemove: (assignmentId: string) => void;
  onCensusChange?: (shiftId: string, census: number | null) => void;
}) {
  const [availableStaff, setAvailableStaff] = useState<StaffOption[]>([]);
  const [assignedContext, setAssignedContext] = useState<Map<string, StaffOption>>(new Map());
  const [censusValue, setCensusValue] = useState<string>("");

  useEffect(() => {
    if (open && shift) {
      // Set initial census value
      setCensusValue(shift.actualCensus?.toString() ?? "");

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

  async function handleCensusUpdate() {
    if (!shift || !onCensusChange) return;
    const newCensus = censusValue === "" ? null : parseInt(censusValue, 10);
    if (censusValue !== "" && isNaN(newCensus as number)) return;
    onCensusChange(shift.id, newCensus);
  }

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

          {/* Census input */}
          <div className="flex items-end gap-2 p-3 rounded-md border bg-muted/30">
            <div className="flex-1">
              <Label htmlFor="census" className="text-sm">Patient Census</Label>
              <Input
                id="census"
                type="number"
                min="0"
                max="50"
                placeholder="Enter patient count"
                value={censusValue}
                onChange={(e) => setCensusValue(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Census determines required staffing from census bands
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleCensusUpdate}
              disabled={!onCensusChange}
            >
              Update
            </Button>
          </div>

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
