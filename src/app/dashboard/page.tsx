"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DashboardData {
  staffCount: number;
  totalFTE: number;
  unitsCount: number;
  scheduleInfo: {
    id: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
  } | null;
  totalShifts: number;
  totalAssignments: number;
  totalSlots: number;
  fillRate: number;
  understaffedShifts: number;
  overstaffedShifts: number;
  openCallouts: number;
  pendingLeaveCount: number;
  openShiftsCount: number;
  prnMissingCount: number;
  scheduleEndingSoon: { daysUntilEnd: number } | null;
  recentAudit: {
    id: string;
    action: string;
    description: string;
    entityType: string;
    createdAt: string;
  }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [gettingStartedDismissed, setGettingStartedDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData);
    setGettingStartedDismissed(localStorage.getItem("gettingStartedDismissed") === "true");
  }, []);

  function dismissGettingStarted() {
    localStorage.setItem("gettingStartedDismissed", "true");
    setGettingStartedDismissed(true);
  }

  if (!data) {
    return <p className="text-muted-foreground">Loading dashboard...</p>;
  }

  const gettingStartedSteps = [
    { label: "Import your staff roster", done: data.staffCount > 0, href: "/setup" },
    { label: "Configure units & rules", done: data.unitsCount > 0, href: "/settings/units" },
    { label: "Create a schedule period", done: data.scheduleInfo !== null, href: "/schedule" },
  ];
  const allStepsDone = gettingStartedSteps.every((s) => s.done);
  const showGettingStarted = !gettingStartedDismissed && !allStepsDone;

  const attentionItems: { href: string; text: string; urgent: boolean; info?: boolean }[] = [
    ...(data.overstaffedShifts > 0 && data.scheduleInfo
      ? [{
          href: `/schedule/${data.scheduleInfo.id}`,
          text: `${data.overstaffedShifts} shift${data.overstaffedShifts > 1 ? "s have" : " has"} excess staff — consider flex-home or VTO`,
          urgent: false,
          info: true,
        }]
      : []),
    ...(data.pendingLeaveCount > 0
      ? [{ href: "/leave", text: `${data.pendingLeaveCount} leave request${data.pendingLeaveCount > 1 ? "s" : ""} pending approval`, urgent: false }]
      : []),
    ...(data.openShiftsCount > 0
      ? [{ href: "/open-shifts", text: `${data.openShiftsCount} open shift${data.openShiftsCount > 1 ? "s" : ""} need${data.openShiftsCount === 1 ? "s" : ""} coverage`, urgent: true }]
      : []),
    ...(data.prnMissingCount > 0
      ? [{ href: "/availability", text: `${data.prnMissingCount} PRN staff haven't submitted availability`, urgent: false }]
      : []),
    ...(data.scheduleEndingSoon
      ? [{
          href: "/schedule",
          text: `Current schedule ends in ${data.scheduleEndingSoon.daysUntilEnd} day${data.scheduleEndingSoon.daysUntilEnd !== 1 ? "s" : ""} — create next period`,
          urgent: true,
        }]
      : []),
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      {/* Getting Started checklist — shown until all steps done or dismissed */}
      {showGettingStarted && (
        <Card className="mb-6 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-semibold text-amber-900 dark:text-amber-200">Getting Started</p>
                <p className="mt-0.5 text-sm text-amber-800/70 dark:text-amber-300/70">
                  Complete these steps to create your first schedule.
                </p>
                <ol className="mt-4 space-y-2">
                  {gettingStartedSteps.map((step, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          step.done
                            ? "bg-green-500 text-white"
                            : "border-2 border-amber-400 text-amber-700"
                        }`}
                      >
                        {step.done ? "✓" : i + 1}
                      </span>
                      {step.done ? (
                        <span className="text-sm text-muted-foreground line-through">{step.label}</span>
                      ) : (
                        <Link href={step.href} className="text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-200">
                          {step.label} →
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              <Button variant="ghost" size="sm" className="text-amber-700 hover:text-amber-900" onClick={dismissGettingStarted}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current schedule — primary CTA */}
      <Card className="mb-6">
        <CardContent className="flex items-center justify-between pt-5 pb-5">
          {data.scheduleInfo ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current Schedule
                </p>
                <p className="mt-0.5 text-lg font-bold">{data.scheduleInfo.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge
                    variant={
                      data.scheduleInfo.status === "published"
                        ? "default"
                        : data.scheduleInfo.status === "draft"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {data.scheduleInfo.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {new Date(data.scheduleInfo.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" – "}
                    {new Date(data.scheduleInfo.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
              </div>
              <Link href={`/schedule/${data.scheduleInfo.id}`}>
                <Button>Open Schedule Builder →</Button>
              </Link>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Current Schedule
                </p>
                <p className="mt-0.5 text-lg font-bold">No active schedule</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a schedule period to get started.
                </p>
              </div>
              <Link href="/schedule">
                <Button>Create Schedule →</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      {/* Needs Attention */}
      <Card className="mb-6">
        <CardContent className="pt-5 pb-4">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs Attention
          </p>
          {attentionItems.length === 0 ? (
            <p className="text-sm font-medium text-green-600">Everything looks good.</p>
          ) : (
            <ul className="space-y-2">
              {attentionItems.map((item, i) => (
                <li key={i}>
                  <Link
                    href={item.href}
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                      item.urgent
                        ? "text-orange-700 dark:text-orange-400"
                        : item.info
                        ? "text-blue-700 dark:text-blue-400"
                        : "text-yellow-700 dark:text-yellow-400"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${item.urgent ? "bg-orange-500" : item.info ? "bg-blue-500" : "bg-yellow-500"}`} />
                      {item.text}
                    </span>
                    <span className="text-xs text-muted-foreground">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Alert cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Active Staff</p>
            <p className="text-2xl font-bold">{data.staffCount}</p>
            <p className="text-xs text-muted-foreground">
              {data.totalFTE.toFixed(1)} total FTE
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Fill Rate</p>
            <p
              className={`text-2xl font-bold ${
                data.fillRate >= 80
                  ? "text-green-600"
                  : data.fillRate >= 50
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {data.fillRate}%
            </p>
            <p className="text-xs text-muted-foreground">
              {data.totalAssignments}/{data.totalSlots} slots filled
            </p>
          </CardContent>
        </Card>

        <Card className={data.understaffedShifts > 0 ? "border-yellow-400" : ""}>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Understaffed Shifts</p>
            <p
              className={`text-2xl font-bold ${
                data.understaffedShifts > 0 ? "text-yellow-600" : "text-green-600"
              }`}
            >
              {data.understaffedShifts}
            </p>
            <p className="text-xs text-muted-foreground">
              of {data.totalShifts} total shifts
            </p>
          </CardContent>
        </Card>

        <Card className={data.overstaffedShifts > 0 ? "border-blue-400" : ""}>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Excess Staff Shifts</p>
            <p
              className={`text-2xl font-bold ${
                data.overstaffedShifts > 0 ? "text-blue-600" : "text-green-600"
              }`}
            >
              {data.overstaffedShifts}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.overstaffedShifts > 0 ? "Flex-home candidates" : "Staffing on target"}
            </p>
          </CardContent>
        </Card>

        <Card className={data.openCallouts > 0 ? "border-red-400" : ""}>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Open Callouts</p>
            <p
              className={`text-2xl font-bold ${
                data.openCallouts > 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {data.openCallouts}
            </p>
            <p className="text-xs text-muted-foreground">
              {data.openCallouts > 0 ? "Needs attention" : "All resolved"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <Link href="/staff">
          <Card className="cursor-pointer transition-colors hover:bg-accent">
            <CardContent className="pt-4">
              <p className="text-sm font-medium">Manage Staff</p>
              <p className="text-xs text-muted-foreground">
                {data.staffCount} active members
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/callouts">
          <Card className="cursor-pointer transition-colors hover:bg-accent">
            <CardContent className="pt-4">
              <p className="text-sm font-medium">Callout Management</p>
              <p className="text-xs text-muted-foreground">
                {data.openCallouts} open
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity.</p>
          ) : (
            <div className="space-y-2">
              {data.recentAudit.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {entry.entityType}
                    </Badge>
                    <span className="text-sm">{entry.description}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
