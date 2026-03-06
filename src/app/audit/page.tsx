"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  description: string;
  justification: string | null;
  performedBy: string;
  createdAt: string;
}

const actionLabels: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  override_hard_rule: "Hard Rule Override",
  override_soft_rule: "Soft Rule Override",
  published: "Published",
  archived: "Archived",
  callout_logged: "Callout Logged",
  callout_filled: "Callout Filled",
  scenario_selected: "Scenario Selected",
  scenario_rejected: "Scenario Rejected",
  swap_requested: "Swap Requested",
  swap_approved: "Swap Approved",
  open_swap_approved: "Open Swap Approved",
  swap_denied: "Swap Denied",
  forced_overtime: "Forced Overtime",
  manual_assignment: "Manual Assignment",
  leave_requested: "Leave Requested",
  leave_approved: "Leave Approved",
  leave_denied: "Leave Denied",
  schedule_auto_generated: "Schedule Generated",
  open_shift_created: "Open Shift Created",
  open_shift_filled: "Open Shift Filled",
};

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";
const actionColors: Record<string, BadgeVariant> = {
  created: "default",
  updated: "secondary",
  deleted: "destructive",
  override_hard_rule: "destructive",
  callout_logged: "destructive",
  callout_filled: "default",
  scenario_selected: "default",
  manual_assignment: "secondary",
  leave_requested: "outline",
  leave_approved: "default",
  leave_denied: "destructive",
  schedule_auto_generated: "secondary",
};

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function exportToCsv(logs: AuditEntry[]) {
  const header = ["Time (UTC)", "Action", "Entity", "Description", "Justification", "By"];
  const rows = logs.map((e) => [
    new Date(e.createdAt).toISOString().slice(0, 19).replace("T", " "),
    actionLabels[e.action] ?? e.action,
    e.entityType,
    e.description,
    e.justification ?? "",
    e.performedBy,
  ].map(csvField));
  const csv = "\uFEFF" + [header.map(csvField), ...rows].map((r) => r.join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const fetchLogs = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterEntity !== "all") params.set("entityType", filterEntity);
    if (filterAction !== "all") params.set("action", filterAction);
    if (filterFrom) params.set("from", filterFrom);
    if (filterTo) params.set("to", filterTo);
    params.set("limit", "200");

    const res = await fetch(`/api/audit?${params}`);
    setLogs(await res.json());
    setLoading(false);
  }, [filterEntity, filterAction, filterFrom, filterTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Trail</h1>
          <p className="mt-1 text-muted-foreground">
            Decision history and exception logs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchLogs()}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportToCsv(logs)} disabled={logs.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={filterEntity} onValueChange={setFilterEntity}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            <SelectItem value="assignment">Assignments</SelectItem>
            <SelectItem value="schedule">Schedules</SelectItem>
            <SelectItem value="callout">Callouts</SelectItem>
            <SelectItem value="leave">Leave</SelectItem>
            <SelectItem value="swap_request">Swaps</SelectItem>
            <SelectItem value="open_shift">Open Shifts</SelectItem>
            <SelectItem value="rule">Rules</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="scenario">Scenarios</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="manual_assignment">Manual Assignment</SelectItem>
            <SelectItem value="callout_logged">Callout Logged</SelectItem>
            <SelectItem value="callout_filled">Callout Filled</SelectItem>
            <SelectItem value="leave_requested">Leave Requested</SelectItem>
            <SelectItem value="leave_approved">Leave Approved</SelectItem>
            <SelectItem value="leave_denied">Leave Denied</SelectItem>
            <SelectItem value="scenario_selected">Scenario Selected</SelectItem>
            <SelectItem value="override_hard_rule">Hard Rule Override</SelectItem>
            <SelectItem value="swap_approved">Swap Approved</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="w-36"
            placeholder="From"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="w-36"
            placeholder="To"
          />
          {(filterFrom || filterTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setFilterFrom(""); setFilterTo(""); }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event Log ({logs.length} entries)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground">No audit entries found.</p>
          ) : (
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Time</TableHead>
                  <TableHead className="w-40">Action</TableHead>
                  <TableHead className="w-28">Entity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-28">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground align-top">
                      <div>{new Date(entry.createdAt).toLocaleDateString()}</div>
                      <div className="text-xs opacity-70">{new Date(entry.createdAt).toLocaleTimeString()}</div>
                    </TableCell>
                    <TableCell className="align-top overflow-hidden">
                      <Badge
                        variant={actionColors[entry.action] ?? "secondary"}
                      >
                        {actionLabels[entry.action] ?? entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top overflow-hidden">
                      <Badge variant="outline">{entry.entityType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm break-words align-top whitespace-normal">
                      <div>{entry.description}</div>
                      {entry.justification && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Justification: {entry.justification}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground align-top">
                      {entry.performedBy}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
