"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CalloutRecord {
  id: string;
  assignmentId: string;
  staffId: string;
  shiftId: string;
  reason: string;
  reasonDetail: string | null;
  calledOutAt: string;
  replacementStaffId: string | null;
  replacementSource: string | null;
  status: string;
  resolvedAt: string | null;
  staffFirstName: string;
  staffLastName: string;
}

interface ReplacementCandidate {
  staffId: string;
  firstName: string;
  lastName: string;
  role: string;
  employmentType: string;
  icuCompetencyLevel: number;
  isChargeNurseQualified: boolean;
  reliabilityRating: number;
  source: string;
  isAvailable: boolean;
  wouldBeOvertime: boolean;
  isEligible: boolean;
  ineligibilityReasons: string[];
  reasons: string[];
  score: number;
  hoursThisWeek: number;
}

interface ScheduleInfo {
  id: string;
  name: string;
  shifts: {
    id: string;
    date: string;
    name: string;
    assignments: {
      id: string;
      staffId: string;
      staffFirstName: string;
      staffLastName: string;
    }[];
  }[];
}

const reasonLabels: Record<string, string> = {
  sick: "Sick",
  family_emergency: "Family Emergency",
  personal: "Personal",
  no_show: "No Show",
  other: "Other",
};

const sourceLabels: Record<string, string> = {
  float: "Float Pool",
  per_diem: "Per Diem",
  overtime: "Overtime",
  agency: "Agency",
};

export default function CalloutsPage() {
  const [callouts, setCallouts] = useState<CalloutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [escalationDialogOpen, setEscalationDialogOpen] = useState(false);
  const [escalationOptions, setEscalationOptions] = useState<ReplacementCandidate[]>([]);
  const [chargeNurseRequired, setChargeNurseRequired] = useState(false);
  const [activeCalloutId, setActiveCalloutId] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ScheduleInfo[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [selectedAssignment, setSelectedAssignment] = useState<{
    assignmentId: string;
    staffId: string;
    shiftId: string;
  } | null>(null);
  const [calloutReason, setCalloutReason] = useState("sick");
  const [calloutDetail, setCalloutDetail] = useState("");

  const fetchCallouts = useCallback(async () => {
    const res = await fetch("/api/callouts");
    setCallouts(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCallouts();
    fetch("/api/schedules").then((r) => r.json()).then(async (scheds) => {
      const detailed = [];
      for (const s of scheds) {
        const res = await fetch(`/api/schedules/${s.id}`);
        detailed.push(await res.json());
      }
      setSchedules(detailed);
    });
  }, [fetchCallouts]);

  async function handleLogCallout() {
    if (!selectedAssignment) return;

    const res = await fetch("/api/callouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...selectedAssignment,
        reason: calloutReason,
        reasonDetail: calloutDetail || null,
      }),
    });

    const data = await res.json();
    setLogDialogOpen(false);
    setActiveCalloutId(data.callout.id);
    setEscalationOptions(data.escalationOptions);
    setChargeNurseRequired(data.chargeNurseRequired ?? false);
    setEscalationDialogOpen(true);
    fetchCallouts();
  }

  async function handleFillCallout(candidate: ReplacementCandidate) {
    if (!activeCalloutId) return;

    await fetch(`/api/callouts/${activeCalloutId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        replacementStaffId: candidate.staffId,
        replacementSource: candidate.source,
        status: "filled",
      }),
    });

    setEscalationDialogOpen(false);
    setActiveCalloutId(null);
    setChargeNurseRequired(false);
    fetchCallouts();
  }

  async function findReplacementForCallout(calloutId: string) {
    const res = await fetch(`/api/callouts/${calloutId}`);
    const data = await res.json();
    setActiveCalloutId(calloutId);
    setEscalationOptions(data.escalationOptions ?? []);
    setChargeNurseRequired(data.chargeNurseRequired ?? false);
    setEscalationDialogOpen(true);
  }

  // Get assignments from selected schedule for the log dialog
  const allScheduleAssignments = selectedScheduleId
    ? schedules
        .find((s) => s.id === selectedScheduleId)
        ?.shifts.flatMap((sh) =>
          sh.assignments.map((a) => ({
            ...a,
            shiftId: sh.id,
            shiftDate: sh.date,
            shiftName: sh.name,
          }))
        ) ?? []
    : [];

  // Unique staff for the filter dropdown
  const staffInSchedule = Array.from(
    new Map(
      allScheduleAssignments.map((a) => [
        a.staffId,
        { staffId: a.staffId, name: `${a.staffFirstName} ${a.staffLastName}` },
      ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Assignments filtered to the selected staff member
  const scheduleAssignments = staffFilter
    ? allScheduleAssignments.filter((a) => a.staffId === staffFilter)
    : allScheduleAssignments;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Callout Management</h1>
          <p className="mt-1 text-muted-foreground">
            {callouts.filter((c) => c.status === "open").length} open callouts
          </p>
        </div>
        <Button onClick={() => setLogDialogOpen(true)}>Log Callout</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Callout History</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : callouts.length === 0 ? (
            <p className="text-muted-foreground">No callouts recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Called Out</TableHead>
                  <TableHead>Replacement</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callouts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.staffFirstName} {c.staffLastName}
                    </TableCell>
                    <TableCell>{reasonLabels[c.reason] ?? c.reason}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.calledOutAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {c.replacementStaffId ? "Filled" : "-"}
                    </TableCell>
                    <TableCell>
                      {c.replacementSource
                        ? sourceLabels[c.replacementSource] ?? c.replacementSource
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            c.status === "filled"
                              ? "default"
                              : c.status === "open"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {c.status}
                        </Badge>
                        {c.status === "open" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => findReplacementForCallout(c.id)}
                          >
                            Find Replacement
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Log Callout Dialog */}
      <Dialog open={logDialogOpen} onOpenChange={(open) => {
        setLogDialogOpen(open);
        if (!open) { setStaffFilter(""); setSelectedAssignment(null); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log a Callout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Schedule</Label>
              <Select
                value={selectedScheduleId}
                onValueChange={(v) => {
                  setSelectedScheduleId(v);
                  setStaffFilter("");
                  setSelectedAssignment(null);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select schedule" /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {staffInSchedule.length > 0 && (
              <div>
                <Label>Staff member</Label>
                <Select
                  value={staffFilter}
                  onValueChange={(v) => {
                    setStaffFilter(v);
                    setSelectedAssignment(null);
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>
                    {staffInSchedule.map((s) => (
                      <SelectItem key={s.staffId} value={s.staffId}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {staffFilter && scheduleAssignments.length > 0 && (
              <div>
                <Label>Shift</Label>
                <Select
                  value={selectedAssignment?.assignmentId ?? ""}
                  onValueChange={(v) => {
                    const a = scheduleAssignments.find((x) => x.id === v);
                    if (a) {
                      setSelectedAssignment({
                        assignmentId: a.id,
                        staffId: a.staffId,
                        shiftId: a.shiftId,
                      });
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                  <SelectContent>
                    {scheduleAssignments.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.shiftDate} — {a.shiftName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Reason</Label>
              <Select value={calloutReason} onValueChange={setCalloutReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sick">Sick</SelectItem>
                  <SelectItem value="family_emergency">Family Emergency</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Details (optional)</Label>
              <Input
                value={calloutDetail}
                onChange={(e) => setCalloutDetail(e.target.value)}
                placeholder="Additional details..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLogDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleLogCallout} disabled={!selectedAssignment}>
                Log Callout
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Escalation Options Dialog */}
      <Dialog open={escalationDialogOpen} onOpenChange={setEscalationDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Replacement Candidates</DialogTitle>
          </DialogHeader>

          {/* Charge nurse warning banner */}
          {chargeNurseRequired && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Called-out nurse held the charge role — only charge-qualified staff are eligible
            </div>
          )}

          <div className="space-y-2">
            {escalationOptions.map((c, idx) => {
              const eligibleCount = escalationOptions.filter((x) => x.isEligible).length;
              const showDivider = !c.isEligible && idx > 0 && escalationOptions[idx - 1].isEligible;
              return (
                <div key={c.staffId}>
                  {showDivider && (
                    <p className="py-1 text-xs font-medium text-muted-foreground">
                      {eligibleCount === 0 ? "No eligible candidates" : "Not eligible"}
                    </p>
                  )}
                  <div
                    className={`rounded-md border px-3 py-2 ${
                      !c.isEligible
                        ? "border-red-200 bg-red-50 opacity-70"
                        : !c.isAvailable
                        ? "opacity-60"
                        : ""
                    }`}
                  >
                    {/* Name row */}
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">
                          {c.firstName} {c.lastName}
                        </span>
                        <Badge variant="secondary" className="text-xs">{c.role}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {sourceLabels[c.source] ?? c.source}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Lv {c.icuCompetencyLevel}/5
                        </span>
                        {c.hoursThisWeek > 0 && (
                          <Badge
                            className={`text-[10px] px-1 py-0 ${
                              c.wouldBeOvertime
                                ? "bg-orange-500 text-white"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {c.hoursThisWeek}h{c.wouldBeOvertime ? " OT" : " this wk"}
                          </Badge>
                        )}
                        {c.isEligible && !c.isAvailable && (
                          <span className="text-xs text-orange-500">Busy</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        disabled={!c.isAvailable || !c.isEligible}
                        onClick={() => handleFillCallout(c)}
                        className="ml-2 shrink-0"
                      >
                        Assign
                      </Button>
                    </div>

                    {/* Reasons */}
                    {c.isEligible && c.reasons.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 pl-1">
                        {c.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            · {r}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Ineligibility reasons */}
                    {!c.isEligible && c.ineligibilityReasons.length > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-1">
                        {c.ineligibilityReasons.map((r, i) => (
                          <li key={i} className="text-xs text-red-600">· {r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
            {escalationOptions.length === 0 && (
              <p className="text-sm text-muted-foreground">No candidates available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
