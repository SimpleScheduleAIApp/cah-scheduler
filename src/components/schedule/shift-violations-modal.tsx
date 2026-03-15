"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";

interface RuleViolation {
  ruleId: string;
  ruleName: string;
  ruleType: "hard" | "soft";
  shiftId: string;
  staffId?: string;
  description: string;
  penaltyScore?: number;
}

interface ShiftData {
  id: string;
  date: string;
  shiftType: string;
  name: string;
  requiredStaffCount: number;
  requiresChargeNurse: boolean;
  actualCensus: number | null;
  acuityLevel?: "blue" | "green" | "yellow" | "red" | null;
}

interface ShiftViolationsModalProps {
  open: boolean;
  onClose: () => void;
  shift: ShiftData | null;
  violations: RuleViolation[];
}

export function ShiftViolationsModal({
  open,
  onClose,
  shift,
  violations,
}: ShiftViolationsModalProps) {
  if (!shift) return null;

  const hardViolations = violations.filter((v) => v.ruleType === "hard");
  // All soft violations — shift-specific (e.g. preference match) and schedule-wide (e.g. overtime,
  // consecutive weekends) are shown together; schedule-wide items carry a "Schedule-wide" badge.
  const softViolations = violations.filter((v) => v.ruleType === "soft");

  const dateObj = parseISO(shift.date);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${hardViolations.length > 0 ? "text-red-500" : "text-yellow-500"}`} />
            Shift Issues
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {format(dateObj, "EEEE, MMMM d, yyyy")} - {shift.shiftType === "day" ? "Day Shift" : "Night Shift"}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hard Rule Violations */}
          {hardViolations.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <span className="font-medium text-red-800">
                  Hard Rule Violations ({hardViolations.length})
                </span>
                <Badge variant="destructive" className="ml-auto">Must Fix</Badge>
              </div>
              <p className="mb-2 text-xs text-red-700">
                These violations must be resolved before the schedule can be published.
              </p>
              <ul className="space-y-2">
                {hardViolations.map((v, idx) => (
                  <li key={idx} className="rounded bg-white p-2 text-sm shadow-sm">
                    <div className="font-medium text-red-900">{v.ruleName}</div>
                    <div className="text-red-700">{v.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Soft Rule Violations */}
          {softViolations.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="font-medium text-yellow-800">
                  Soft Rule Violations ({softViolations.length})
                </span>
                <Badge variant="outline" className="ml-auto border-yellow-600 text-yellow-700">
                  Preferences
                </Badge>
              </div>
              <p className="mb-2 text-xs text-yellow-700">
                These are preference violations that add penalties to the schedule score.
              </p>
              <ul className="space-y-2">
                {softViolations.map((v, idx) => (
                  <li key={idx} className="rounded bg-white p-2 text-sm shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-yellow-900">{v.ruleName}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {!v.shiftId && (
                          <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-700">
                            Schedule-wide
                          </Badge>
                        )}
                        {v.penaltyScore !== undefined && (
                          <Badge variant="secondary" className="text-xs">
                            -{v.penaltyScore.toFixed(1)} pts
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-yellow-700">{v.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No violations */}
          {hardViolations.length === 0 && softViolations.length === 0 && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center">
              <span className="text-green-800">No issues found for this shift.</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
