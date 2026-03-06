"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScheduleGrid } from "@/components/schedule/schedule-grid";
import { AssignmentDialog } from "@/components/schedule/assignment-dialog";
import { ShiftViolationsModal } from "@/components/schedule/shift-violations-modal";
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

interface ScheduleData {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  unit: string;
  status: string;
  shifts: ShiftData[];
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

interface EvalResult {
  isValid: boolean;
  hardViolations: RuleViolation[];
  softViolations: RuleViolation[];
  totalPenalty: number;
}

export default function ScheduleBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const scheduleId = params.id as string;

  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [evaluation, setEvaluation] = useState<EvalResult | null>(null);
  const [selectedShift, setSelectedShift] = useState<ShiftData | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [violationsModalOpen, setViolationsModalOpen] = useState(false);
  const [selectedShiftForViolations, setSelectedShiftForViolations] = useState<ShiftData | null>(null);
  const [selectedViolations, setSelectedViolations] = useState<RuleViolation[]>([]);
  const [publishing, setPublishing] = useState(false);

  const fetchSchedule = useCallback(async () => {
    const res = await fetch(`/api/schedules/${scheduleId}`);
    const data = await res.json();
    setSchedule(data);
    setLoading(false);
  }, [scheduleId]);

  const runEvaluation = useCallback(async () => {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId }),
    });
    const data = await res.json();
    setEvaluation(data);
  }, [scheduleId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  useEffect(() => {
    if (schedule) {
      runEvaluation();
    }
  }, [schedule, runEvaluation]);

  async function handleAssign(shiftId: string, staffId: string, isChargeNurse: boolean) {
    await fetch(`/api/schedules/${scheduleId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId, staffId, isChargeNurse }),
    });
    setDialogOpen(false);
    setSelectedShift(null);
    fetchSchedule();
  }

  async function handleRemove(assignmentId: string) {
    await fetch(
      `/api/schedules/${scheduleId}/assignments?assignmentId=${assignmentId}`,
      { method: "DELETE" }
    );
    setDialogOpen(false);
    setSelectedShift(null);
    fetchSchedule();
  }

  function handleShiftClick(shift: ShiftData) {
    setSelectedShift(shift);
    setDialogOpen(true);
  }

  async function handlePublish() {
    setPublishing(true);
    const newStatus = schedule?.status === "published" ? "draft" : "published";
    await fetch(`/api/schedules/${scheduleId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    await fetchSchedule();
    setPublishing(false);
  }

  function handleExport() {
    const a = document.createElement("a");
    a.href = `/api/schedules/${scheduleId}/export`;
    a.download = "";
    a.click();
  }

  function handleViolationsClick(shift: ShiftData, violations: RuleViolation[]) {
    setSelectedShiftForViolations(shift);
    setSelectedViolations(violations);
    setViolationsModalOpen(true);
  }

  if (loading || !schedule) {
    return <p className="text-muted-foreground">Loading schedule...</p>;
  }

  // Build violations maps for the grid
  // hardViolationMap  → red border + "N hard" badge
  // softViolationMap  → yellow border + "N soft" badge (separate from hard)
  // violationDetailsMap → full details for the violations modal
  const hardViolationMap = new Map<string, string[]>();
  const softViolationMap = new Map<string, string[]>();
  const violationDetailsMap = new Map<string, RuleViolation[]>();
  if (evaluation) {
    // Collect staff-level violations (weekend shortfall, overtime, etc.)
    // These have no shiftId — they apply to a staff member across the whole schedule
    const staffViolationMap = new Map<string, RuleViolation[]>();
    for (const v of evaluation.softViolations) {
      if (!v.shiftId && v.staffId) {
        const list = staffViolationMap.get(v.staffId) ?? [];
        list.push({ ...v, ruleType: "soft" });
        staffViolationMap.set(v.staffId, list);
      }
    }

    for (const v of evaluation.hardViolations) {
      if (v.shiftId) {
        const list = hardViolationMap.get(v.shiftId) ?? [];
        list.push(v.description);
        hardViolationMap.set(v.shiftId, list);

        const details = violationDetailsMap.get(v.shiftId) ?? [];
        details.push({ ...v, ruleType: "hard" });
        violationDetailsMap.set(v.shiftId, details);
      }
    }
    for (const v of evaluation.softViolations) {
      if (v.shiftId) {
        const list = softViolationMap.get(v.shiftId) ?? [];
        list.push(v.description);
        softViolationMap.set(v.shiftId, list);

        const details = violationDetailsMap.get(v.shiftId) ?? [];
        details.push({ ...v, ruleType: "soft" });
        violationDetailsMap.set(v.shiftId, details);
      }
    }

    // Attach staff-level violations to each shift the staff member is assigned to
    for (const shift of schedule.shifts) {
      for (const assignment of shift.assignments) {
        const staffViolations = staffViolationMap.get(assignment.staffId);
        if (!staffViolations?.length) continue;

        const softList = softViolationMap.get(shift.id) ?? [];
        softViolationMap.set(shift.id, [...softList, ...staffViolations.map((v) => v.description)]);

        const details = violationDetailsMap.get(shift.id) ?? [];
        violationDetailsMap.set(shift.id, [...details, ...staffViolations]);
      }
    }
  }

  const totalAssignments = schedule.shifts.reduce(
    (sum, s) => sum + s.assignments.length,
    0
  );
  const totalSlots = schedule.shifts.reduce(
    (sum, s) => sum + s.requiredStaffCount,
    0
  );
  const fillRate = totalSlots > 0 ? Math.round((totalAssignments / totalSlots) * 100) : 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{schedule.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {format(parseISO(schedule.startDate), "MMM d")} -{" "}
            {format(parseISO(schedule.endDate), "MMM d, yyyy")} | {schedule.unit}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={schedule.status === "draft" ? "secondary" : "default"}
          >
            {schedule.status}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/scenarios?scheduleId=${scheduleId}`)}
          >
            Generate Schedule
          </Button>
          <Button variant="outline" size="sm" onClick={runEvaluation}>
            Re-evaluate
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            Export
          </Button>
          {schedule.status !== "published" ? (
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={publishing || (evaluation !== null && evaluation.hardViolations.length > 0)}
              title={evaluation && evaluation.hardViolations.length > 0 ? "Fix hard violations before publishing" : undefined}
            >
              {publishing ? "Publishing…" : "Publish"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePublish}
              disabled={publishing}
            >
              {publishing ? "Saving…" : "Unpublish"}
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Fill Rate</p>
            <p className="text-2xl font-bold">{fillRate}%</p>
            <p className="text-xs text-muted-foreground">
              {totalAssignments}/{totalSlots} slots filled
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Hard Violations</p>
            <p
              className={`text-2xl font-bold ${
                evaluation && evaluation.hardViolations.length > 0
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {evaluation?.hardViolations.length ?? "-"}
            </p>
            <p className="text-xs text-muted-foreground">Must fix before publishing</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Soft Violations</p>
            <p className="text-2xl font-bold text-yellow-600">
              {evaluation?.softViolations.length ?? "-"}
            </p>
            <p className="text-xs text-muted-foreground">Preferences & scheduling quality</p>
          </CardContent>
        </Card>
      </div>

      {/* Violations summary — grouped by rule so 60 violations don't look like 60 separate crises */}
      {evaluation && (evaluation.hardViolations.length > 0 || evaluation.softViolations.length > 0) && (() => {
        // Group violations by rule name
        const hardGroups = new Map<string, number>();
        for (const v of evaluation.hardViolations) {
          hardGroups.set(v.ruleName, (hardGroups.get(v.ruleName) ?? 0) + 1);
        }
        const softGroups = new Map<string, number>();
        for (const v of evaluation.softViolations) {
          softGroups.set(v.ruleName, (softGroups.get(v.ruleName) ?? 0) + 1);
        }
        const prefViolations = evaluation.softViolations.filter(
          (v) => v.ruleId?.includes("preference") || v.ruleName?.toLowerCase().includes("preference")
        ).length;

        // Build staff name lookup from all assignments
        const staffNames = new Map<string, string>();
        for (const shift of schedule.shifts) {
          for (const a of shift.assignments) {
            if (!staffNames.has(a.staffId)) {
              staffNames.set(a.staffId, `${a.staffFirstName} ${a.staffLastName}`);
            }
          }
        }

        // Group soft violations by staff member
        const staffViolationMap = new Map<string, { name: string; count: number; rules: Set<string> }>();
        for (const v of evaluation.softViolations) {
          if (v.staffId) {
            const entry = staffViolationMap.get(v.staffId) ?? {
              name: staffNames.get(v.staffId) ?? v.staffId,
              count: 0,
              rules: new Set<string>(),
            };
            entry.count++;
            entry.rules.add(v.ruleName);
            staffViolationMap.set(v.staffId, entry);
          }
        }
        const staffViolationList = [...staffViolationMap.values()].sort((a, b) => b.count - a.count);

        return (
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            {evaluation.hardViolations.length > 0 && (
              <Card className="border-red-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-red-600">
                    Hard Violations — {evaluation.hardViolations.length} total (must fix)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {[...hardGroups.entries()].sort((a, b) => b[1] - a[1]).map(([rule, count]) => (
                      <li key={rule} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{rule}</span>
                        <Badge variant="destructive" className="ml-2 text-xs">{count}</Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Click any highlighted shift in the grid below for details and to manually fix it.
                  </p>
                </CardContent>
              </Card>
            )}

            {evaluation.softViolations.length > 0 && (
              <Card className="border-yellow-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-yellow-700">
                    Soft Violations — {evaluation.softViolations.length} total (schedule quality)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* By rule type */}
                  <p className="mb-1 text-xs font-medium text-muted-foreground">By rule:</p>
                  <ul className="space-y-1">
                    {[...softGroups.entries()].sort((a, b) => b[1] - a[1]).map(([rule, count]) => (
                      <li key={rule} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{rule}</span>
                        <Badge variant="secondary" className="ml-2 text-xs">{count}</Badge>
                      </li>
                    ))}
                  </ul>

                  {/* Per-staff breakdown */}
                  {staffViolationList.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                        Affected staff (most impacted first):
                      </p>
                      <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                        {staffViolationList.map(({ name, count, rules }) => (
                          <li key={name} className="text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium truncate">{name}</span>
                              <Badge variant="secondary" className="shrink-0 text-[9px] px-1 py-0">
                                {count} {count === 1 ? "violation" : "violations"}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-muted-foreground truncate">
                              {[...rules].join(" · ")}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="mt-3 text-xs text-muted-foreground">
                    Each count is the number of individual assignment-level mismatches across
                    the full schedule — one nurse working 4 non-preferred shifts counts as 4.
                    {prefViolations > 0 && (
                      <> {prefViolations} preference mismatches: some are unavoidable when ICU supervision
                      requirements limit which staff can work each shift. Regenerating with the
                      Fairness-Optimized variant may reduce this.</>
                    )}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        );
      })()}

      {/* Schedule grid */}
      <Card>
        <CardHeader>
          <CardTitle>Schedule Grid</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleGrid
            shifts={schedule.shifts}
            onShiftClick={handleShiftClick}
            onViolationsClick={handleViolationsClick}
            violations={hardViolationMap}
            softViolations={softViolationMap}
            violationDetails={violationDetailsMap}
          />
        </CardContent>
      </Card>

      {/* Assignment dialog */}
      <AssignmentDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setSelectedShift(null);
        }}
        shift={selectedShift}
        scheduleId={scheduleId}
        onAssign={handleAssign}
        onRemove={handleRemove}
      />

      {/* Shift violations modal */}
      <ShiftViolationsModal
        open={violationsModalOpen}
        onClose={() => {
          setViolationsModalOpen(false);
          setSelectedShiftForViolations(null);
          setSelectedViolations([]);
        }}
        shift={selectedShiftForViolations}
        violations={selectedViolations}
      />
    </div>
  );
}
