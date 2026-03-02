"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { format, parseISO } from "date-fns";

interface CandidateRecommendation {
  staffId: string;
  staffName: string;
  role?: string;
  icuCompetencyLevel?: number;
  source: "float" | "per_diem" | "overtime" | "agency";
  reasons: string[];
  score: number;
  isOvertime: boolean;
  hoursThisWeek: number;
  restHoursBefore?: number;
  isChargeNurseQualified?: boolean;
  weekendsThisPeriod?: number;
  consecutiveDaysBeforeShift?: number;
}

interface CoverageRequestData {
  id: string;
  shiftId: string;
  originalStaffId: string;
  reason: string;
  reasonDetail: string | null;
  status: "pending_approval" | "approved" | "filled" | "cancelled" | "no_candidates";
  priority: "low" | "normal" | "high" | "urgent";
  recommendations: CandidateRecommendation[];
  escalationStepsChecked: string[];
  selectedStaffId: string | null;
  selectedSource: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  filledAt: string | null;
  filledByStaffId: string | null;
  shiftDate: string;
  shiftType: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  unit: string;
  originalStaffFirstName: string;
  originalStaffLastName: string;
  originalWasChargeNurse?: boolean | null;
}

const PRIORITY_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  low: "secondary",
  normal: "outline",
  high: "default",
  urgent: "destructive",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending_approval: "default",
  approved: "secondary",
  filled: "secondary",
  cancelled: "outline",
  no_candidates: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending Approval",
  approved: "Approved",
  filled: "Filled",
  cancelled: "Cancelled",
  no_candidates: "No Candidates",
};

const SOURCE_LABELS: Record<string, string> = {
  float: "Float Pool",
  per_diem: "PRN",
  overtime: "Overtime",
  agency: "Agency",
};

const SOURCE_COLORS: Record<string, string> = {
  float: "bg-blue-100 text-blue-800",
  per_diem: "bg-green-100 text-green-800",
  overtime: "bg-yellow-100 text-yellow-800",
  agency: "bg-red-100 text-red-800",
};

export default function CoverageRequestsPage() {
  const [requests, setRequests] = useState<CoverageRequestData[]>([]);
  const [loading, setLoading] = useState(true);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<CoverageRequestData | null>(null);
  const [filter, setFilter] = useState<"pending_approval" | "filled" | "cancelled" | "all">("pending_approval");

  const fetchData = useCallback(async () => {
    const res = await fetch("/api/open-shifts");
    const data = await res.json();
    setRequests(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleApproveClick(request: CoverageRequestData) {
    setSelectedRequest(request);
    setApproveDialogOpen(true);
  }

  async function handleApproveCandidate(candidateStaffId: string) {
    if (!selectedRequest) return;

    await fetch(`/api/open-shifts/${selectedRequest.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        selectedStaffId: candidateStaffId,
      }),
    });

    setApproveDialogOpen(false);
    setSelectedRequest(null);
    fetchData();
  }

  async function handleCancel(requestId: string) {
    if (!confirm("Are you sure you want to cancel this coverage request?")) return;

    await fetch(`/api/open-shifts/${requestId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });

    fetchData();
  }

  const filteredRequests = requests.filter((r) => {
    if (filter === "all") return true;
    if (filter === "pending_approval") return r.status === "pending_approval" || r.status === "no_candidates";
    return r.status === filter;
  });

  const pendingCount = requests.filter((r) => r.status === "pending_approval" || r.status === "no_candidates").length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Coverage Requests</h1>
          <p className="mt-1 text-muted-foreground">
            {pendingCount} request{pendingCount !== 1 ? "s" : ""} pending approval
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-2">
        {(["pending_approval", "filled", "cancelled", "all"] as const).map((status) => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(status)}
          >
            {status === "pending_approval" ? "Pending" : status.charAt(0).toUpperCase() + status.slice(1)}
            {status === "pending_approval" && pendingCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendingCount}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coverage Recommendations</CardTitle>
          <CardDescription>
            Review and approve replacement candidates for shifts needing coverage
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : filteredRequests.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No {filter !== "all" ? filter.replace("_", " ") : ""} coverage requests found.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Original Staff</TableHead>
                  <TableHead>Top Recommendation</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((req) => {
                  const topCandidate = req.recommendations?.[0];
                  return (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        {format(parseISO(req.shiftDate), "EEE, MMM d")}
                      </TableCell>
                      <TableCell>
                        <div>{req.shiftName}</div>
                        <div className="text-xs text-muted-foreground">
                          {req.startTime} - {req.endTime}
                        </div>
                      </TableCell>
                      <TableCell>{req.unit}</TableCell>
                      <TableCell>
                        {req.originalStaffFirstName} {req.originalStaffLastName}
                      </TableCell>
                      <TableCell>
                        {topCandidate ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{topCandidate.staffName}</span>
                              <span className={`text-xs px-2 py-0.5 rounded ${SOURCE_COLORS[topCandidate.source]}`}>
                                {SOURCE_LABELS[topCandidate.source]}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {topCandidate.reasons[0]}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic">No candidates found</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={PRIORITY_VARIANTS[req.priority]}>
                          {req.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[req.status]}>
                          {STATUS_LABELS[req.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(req.status === "pending_approval" || req.status === "no_candidates") && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              onClick={() => handleApproveClick(req)}
                              disabled={!req.recommendations?.length}
                            >
                              Review
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCancel(req.id)}
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Approval Dialog with Candidate Selection */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approve Coverage</DialogTitle>
            <DialogDescription>
              Select a replacement candidate to fill this shift
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              {/* Shift Info */}
              <div className="rounded-lg border p-3 text-sm bg-muted/50">
                <p>
                  <strong>Date:</strong>{" "}
                  {format(parseISO(selectedRequest.shiftDate), "EEEE, MMMM d, yyyy")}
                </p>
                <p>
                  <strong>Shift:</strong> {selectedRequest.shiftName} ({selectedRequest.startTime} - {selectedRequest.endTime})
                </p>
                <p>
                  <strong>Unit:</strong> {selectedRequest.unit}
                </p>
                <p>
                  <strong>Original Staff:</strong> {selectedRequest.originalStaffFirstName} {selectedRequest.originalStaffLastName}
                </p>
                <p>
                  <strong>Reason:</strong> {selectedRequest.reasonDetail || selectedRequest.reason}
                </p>
              </div>

              {/* Escalation Steps */}
              <div className="text-sm text-muted-foreground">
                <strong>Checked:</strong> {selectedRequest.escalationStepsChecked?.map(s => SOURCE_LABELS[s] || s).join(" → ")}
              </div>

              {/* Charge nurse warning banner */}
              {selectedRequest.originalWasChargeNurse &&
                !selectedRequest.recommendations?.some(c => c.isChargeNurseQualified) && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <span className="font-medium">⚠️ The original nurse was the charge nurse for this shift.</span>{" "}
                  None of the recommended candidates are charge nurse qualified (Level 4+). Approving any option
                  will assign an unqualified nurse as charge nurse, creating a hard rule violation.
                </div>
              )}

              {/* Candidate Recommendations */}
              <div className="space-y-3">
                <h4 className="font-medium">Top 3 Recommendations</h4>
                {selectedRequest.recommendations?.map((candidate, index) => (
                  <div
                    key={candidate.staffId}
                    className="rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        {/* Name row */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {index + 1}. {candidate.staffName}
                          </span>
                          {candidate.staffId !== "agency" && candidate.role && (
                            <Badge variant="secondary" className="text-xs">{candidate.role}</Badge>
                          )}
                          {candidate.staffId !== "agency" && candidate.icuCompetencyLevel !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              Lv {candidate.icuCompetencyLevel}/5
                            </span>
                          )}
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${SOURCE_COLORS[candidate.source]}`}>
                            {SOURCE_LABELS[candidate.source]}
                          </span>
                        </div>

                        {/* Pros */}
                        {candidate.reasons.length > 0 && (
                          <ul className="space-y-0.5">
                            {candidate.reasons.map((reason, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                                <span className="mt-px shrink-0 text-green-600 font-medium">✓</span>
                                {reason}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* Cons */}
                        {(() => {
                          const cons: { text: string; red?: boolean }[] = [];
                          if (candidate.isOvertime)
                            cons.push({ text: `Overtime — ${candidate.hoursThisWeek}h this week (+${selectedRequest.durationHours}h = OT cost)` });
                          if ((candidate.weekendsThisPeriod ?? 0) >= 3)
                            cons.push({ text: `${candidate.weekendsThisPeriod} weekends already worked this period` });
                          if ((candidate.consecutiveDaysBeforeShift ?? 0) >= 4)
                            cons.push({ text: `${candidate.consecutiveDaysBeforeShift} consecutive days — this would be day ${(candidate.consecutiveDaysBeforeShift ?? 0) + 1}` });
                          if (selectedRequest.originalWasChargeNurse && !candidate.isChargeNurseQualified && candidate.staffId !== "agency")
                            cons.push({ text: "Not charge nurse qualified — will create hard rule violation", red: true });
                          if (cons.length === 0) return null;
                          return (
                            <ul className="space-y-0.5">
                              {cons.map((con, i) => (
                                <li key={i} className={`flex items-start gap-1.5 text-xs ${con.red ? "text-red-600" : "text-amber-600"}`}>
                                  <span className="mt-px shrink-0">✗</span>
                                  {con.text}
                                </li>
                              ))}
                            </ul>
                          );
                        })()}

                        {/* Rest before shift */}
                        {candidate.staffId !== "agency" && (
                          <p className={`text-xs ${
                            candidate.restHoursBefore !== undefined && candidate.restHoursBefore < 12
                              ? "text-amber-600"
                              : "text-muted-foreground"
                          }`}>
                            · Rest before shift:{" "}
                            {candidate.restHoursBefore !== undefined
                              ? `${Math.round(candidate.restHoursBefore)}h${candidate.restHoursBefore < 12 ? " — short turnaround" : ""}`
                              : "24h+"}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => handleApproveCandidate(candidate.staffId)}
                        variant={index === 0 ? "default" : "outline"}
                        className="shrink-0"
                      >
                        {candidate.staffId === "agency" ? "Contact Agency" : "Approve"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
