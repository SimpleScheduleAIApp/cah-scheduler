"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Schedule {
  id: string;
  name: string;
  status: string;
}

interface Scenario {
  id: string;
  scheduleId: string;
  name: string;
  description: string | null;
  overallScore: number | null;
  coverageScore: number | null;
  fairnessScore: number | null;
  costScore: number | null;
  preferenceScore: number | null;
  skillMixScore: number | null;
  status: string;
  hardViolations: unknown[];
  softViolations: unknown[];
}

interface JobStatus {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  currentPhase: string | null;
  error: string | null;
  warnings: {
    shiftId: string;
    date: string;
    shiftType: string;
    unit: string;
    required: number;
    assigned: number;
    reasons: string[];
  }[];
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  if (score === null) return null;
  const pct = Math.round((1 - score) * 100);
  const color =
    pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-xs text-right">{pct}%</span>
    </div>
  );
}

function ScenariosPageContent() {
  const searchParams = useSearchParams();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(
    searchParams.get("scheduleId") ?? ""
  );
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/schedules")
      .then((r) => r.json())
      .then(setSchedules);
  }, []);

  const fetchScenarios = useCallback(async (scheduleId: string) => {
    setLoading(true);
    const res = await fetch(`/api/scenarios?scheduleId=${scheduleId}`);
    setScenarios(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedScheduleId) {
      fetchScenarios(selectedScheduleId);
    }
  }, [selectedScheduleId, fetchScenarios]);

  // Stop polling when component unmounts
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/scenarios/generate/status?jobId=${jobId}`);
      const status: JobStatus = await res.json();
      setJobStatus(status);

      if (status.status === "completed" || status.status === "failed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        if (status.status === "completed" && selectedScheduleId) {
          await fetchScenarios(selectedScheduleId);
        }
      }
    }, 2000);
  }

  async function handleGenerate() {
    if (!selectedScheduleId) return;
    setJobStatus({ jobId: "", status: "pending", progress: 0, currentPhase: "Starting…", error: null, warnings: [] });

    const res = await fetch("/api/scenarios/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId: selectedScheduleId }),
    });

    if (!res.ok) {
      const err = await res.json();
      setJobStatus((prev) => ({ ...prev!, status: "failed", error: err.error ?? "Unknown error" }));
      return;
    }

    const { jobId } = await res.json();
    setJobStatus((prev) => ({ ...prev!, jobId, status: "pending" }));
    startPolling(jobId);
  }

  async function handleApply(scenarioId: string) {
    setApplyingId(scenarioId);
    await fetch(`/api/scenarios/${scenarioId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    await fetchScenarios(selectedScheduleId);
    setApplyingId(null);
  }

  async function handleReject(id: string) {
    await fetch(`/api/scenarios/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected" }),
    });
    fetchScenarios(selectedScheduleId);
  }

  const isGenerating =
    jobStatus?.status === "pending" || jobStatus?.status === "running";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Scenario Comparison</h1>
        <p className="mt-1 text-muted-foreground">
          Generate and compare schedule variants. The Balanced schedule is applied
          automatically; use Apply to switch to a different variant.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <Select value={selectedScheduleId} onValueChange={setSelectedScheduleId}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Select a schedule" />
          </SelectTrigger>
          <SelectContent>
            {schedules.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={handleGenerate}
          disabled={!selectedScheduleId || isGenerating}
        >
          {isGenerating ? "Generating…" : "Generate Schedule"}
        </Button>
      </div>

      {/* Progress bar while generating */}
      {isGenerating && jobStatus && (
        <div className="mb-6 rounded-lg border bg-muted/30 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {jobStatus.currentPhase ?? "Working…"}
            </span>
            <span className="text-sm text-muted-foreground">{jobStatus.progress}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-500"
              style={{ width: `${jobStatus.progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Running 3 variants in parallel (Balanced, Fairness-Optimized, Cost-Optimized)…
          </p>
        </div>
      )}

      {/* Error state */}
      {jobStatus?.status === "failed" && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          Generation failed: {jobStatus.error}
        </div>
      )}

      {/* Understaffed warnings */}
      {jobStatus?.status === "completed" && jobStatus.warnings.length > 0 && (
        <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 p-4">
          <p className="mb-2 text-sm font-medium text-yellow-800">
            {jobStatus.warnings.length} shift(s) could not be fully staffed
          </p>
          <ul className="space-y-1 text-xs text-yellow-700">
            {jobStatus.warnings.map((w) => (
              <li key={w.shiftId}>
                {w.date} {w.shiftType} ({w.unit}): {w.assigned}/{w.required} filled
                {w.reasons.length > 0 && ` — ${w.reasons.join("; ")}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading scenarios…</p>
      ) : scenarios.length === 0 && !isGenerating ? (
        <p className="text-muted-foreground">
          No scenarios yet. Select a schedule and click Generate Schedule.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {scenarios.map((s) => {
            const focus: Record<string, string> = {
              "Balanced": "Balances all priorities equally",
              "Fairness Optimized": "Maximises equal weekend & holiday distribution",
              "Cost Optimized": "Minimises overtime and agency/float use",
            };
            return (
            <Card
              key={s.id}
              className={
                s.status === "selected"
                  ? "border-green-400"
                  : s.status === "rejected"
                  ? "border-red-200 opacity-60"
                  : ""
              }
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <Badge
                    variant={
                      s.status === "selected"
                        ? "default"
                        : s.status === "rejected"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {s.status === "selected" ? "active" : s.status}
                  </Badge>
                </div>
                {focus[s.name] && (
                  <p className="text-xs font-medium text-primary/70">{focus[s.name]}</p>
                )}
                {s.description && (
                  <p className="text-xs text-muted-foreground">{s.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <ScoreBar label="Coverage" score={s.coverageScore} />
                  <ScoreBar label="Fairness" score={s.fairnessScore} />
                  <ScoreBar label="Cost" score={s.costScore} />
                  <ScoreBar label="Preference" score={s.preferenceScore} />
                  <ScoreBar label="Skill Mix" score={s.skillMixScore} />
                </div>

                <div className="flex items-center justify-between border-t pt-2">
                  <div>
                    <span className="text-sm font-medium">Overall: </span>
                    <span className="text-lg font-bold">
                      {s.overallScore !== null
                        ? Math.round((1 - s.overallScore) * 100) + "%"
                        : "-"}
                    </span>
                  </div>
                  {s.status === "selected" ? (
                    <span className="text-xs text-green-600 font-medium">Active schedule</span>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => handleApply(s.id)}
                        disabled={applyingId === s.id}
                      >
                        {applyingId === s.id ? "Applying…" : "Apply"}
                      </Button>
                      {s.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(s.id)}
                        >
                          Reject
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
          })}
        </div>
      )}
    </div>
  );
}

export default function ScenariosPage() {
  return (
    <Suspense>
      <ScenariosPageContent />
    </Suspense>
  );
}
