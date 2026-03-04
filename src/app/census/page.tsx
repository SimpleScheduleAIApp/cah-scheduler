"use client";

import { useEffect, useState, useCallback } from "react";
import { format, addDays, subDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type CensusShift = {
  id: string;
  date: string;
  acuityLevel: "blue" | "green" | "yellow" | "red" | null;
  censusBandId: string | null;
  shiftType: string;
  name: string;
  startTime: string;
  endTime: string;
  unit: string;
};

type CensusBand = {
  id: string;
  name: string;
  unit: string;
  color: "blue" | "green" | "yellow" | "red";
  minPatients: number;
  maxPatients: number;
  requiredRNs: number;
  requiredLPNs: number;
  requiredCNAs: number;
  requiredChargeNurses: number;
  patientToNurseRatio: string;
  isActive: boolean;
};

type PendingChange = {
  acuityLevel: "blue" | "green" | "yellow" | "red";
  censusBandId: string | null;
};

// ─── Tier helpers ─────────────────────────────────────────────────────────────

const TIERS: { value: "blue" | "green" | "yellow" | "red"; label: string; dot: string }[] = [
  { value: "blue",   label: "Blue — Low Census",      dot: "bg-blue-500"   },
  { value: "green",  label: "Green — Normal",          dot: "bg-green-500"  },
  { value: "yellow", label: "Yellow — Elevated",       dot: "bg-yellow-500" },
  { value: "red",    label: "Red — Critical",          dot: "bg-red-500"    },
];

function TierDot({ color }: { color: "blue" | "green" | "yellow" | "red" | null }) {
  if (!color) return <span className="text-muted-foreground text-sm">—</span>;
  const tier = TIERS.find((t) => t.value === color);
  if (!tier) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${tier.dot}`} />
      <span className="capitalize">{tier.value.charAt(0).toUpperCase() + tier.value.slice(1)}</span>
    </span>
  );
}

function tierLabel(color: "blue" | "green" | "yellow" | "red" | null): string {
  if (!color) return "Not set";
  const map: Record<string, string> = {
    blue: "Low Census",
    green: "Normal",
    yellow: "Elevated",
    red: "Critical",
  };
  return map[color] ?? color;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CensusPage() {
  const today = format(new Date(), "yyyy-MM-dd");

  const [date, setDate] = useState(today);
  const [shifts, setShifts] = useState<CensusShift[]>([]);
  const [bands, setBands] = useState<CensusBand[]>([]);
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load census bands once (used for tier → band lookup and Tab 2 display)
  useEffect(() => {
    fetch("/api/census-bands")
      .then((r) => r.json())
      .then(setBands);
  }, []);

  const fetchShifts = useCallback(async (d: string) => {
    setLoading(true);
    setPending({});
    setSaveMessage(null);
    const res = await fetch(`/api/census?date=${d}`);
    const data = await res.json();
    setShifts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchShifts(date);
  }, [date, fetchShifts]);

  // Default unset shifts to Green so the manager sees a baseline on every page open.
  // Only applies to shifts with no acuityLevel already saved — does not override
  // an in-progress pending selection.
  useEffect(() => {
    if (shifts.length === 0 || bands.length === 0) return;
    setPending((prev) => {
      const defaults: Record<string, PendingChange> = {};
      for (const s of shifts) {
        if (!s.acuityLevel && !prev[s.id]) {
          const bandId = bands.find((b) => b.unit === s.unit && b.color === "green")?.id ?? null;
          defaults[s.id] = { acuityLevel: "green", censusBandId: bandId };
        }
      }
      return Object.keys(defaults).length > 0 ? { ...defaults, ...prev } : prev;
    });
  }, [shifts, bands]);

  function findBandId(unit: string, color: "blue" | "green" | "yellow" | "red"): string | null {
    return bands.find((b) => b.unit === unit && b.color === color)?.id ?? null;
  }

  function handleTierChange(shift: CensusShift, color: "blue" | "green" | "yellow" | "red") {
    const censusBandId = findBandId(shift.unit, color);
    setPending((prev) => ({ ...prev, [shift.id]: { acuityLevel: color, censusBandId } }));
  }

  async function handleSave() {
    const entries = Object.entries(pending);
    if (entries.length === 0) return;

    setSaving(true);
    setSaveMessage(null);

    const results = await Promise.all(
      entries.map(([shiftId, change]) =>
        fetch(`/api/shifts/${shiftId}/acuity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acuityLevel: change.acuityLevel,
            censusBandId: change.censusBandId,
          }),
        })
      )
    );

    const allOk = results.every((r) => r.ok);
    setSaving(false);

    if (allOk) {
      setSaveMessage("Saved successfully.");
      await fetchShifts(date);
    } else {
      setSaveMessage("Some changes failed to save. Please try again.");
    }
  }

  // Group bands by unit for Tab 2
  const bandsByUnit = bands.reduce<Record<string, CensusBand[]>>((acc, b) => {
    if (!acc[b.unit]) acc[b.unit] = [];
    acc[b.unit].push(b);
    return acc;
  }, {});

  const hasPending = Object.keys(pending).length > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Daily Census</h1>
        <p className="mt-1 text-muted-foreground">
          Set the census tier for each shift. The selected tier determines minimum staffing
          requirements for that shift.
        </p>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily Census</TabsTrigger>
          <TabsTrigger value="thresholds">Band Thresholds</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Daily Census Entry ──────────────────────────────────────── */}
        <TabsContent value="daily" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDate(format(subDays(parseISO(date), 1), "yyyy-MM-dd"))
                  }
                >
                  ← Prev
                </Button>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))
                  }
                >
                  Next →
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setDate(today)}
                  disabled={date === today}
                >
                  Today
                </Button>
                <span className="ml-auto text-sm text-muted-foreground">
                  {format(parseISO(date), "EEEE, MMMM d, yyyy")}
                </span>
              </div>
            </CardHeader>

            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground py-4">Loading shifts…</p>
              ) : shifts.length === 0 ? (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No shifts found for this date.
                  <br />
                  Shifts are created when a schedule is generated.
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Shift</TableHead>
                        <TableHead>Hours</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead>Current Tier</TableHead>
                        <TableHead>Set Tier</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shifts.map((s) => {
                        const pendingColor = pending[s.id]?.acuityLevel ?? null;
                        const displayColor = pendingColor ?? s.acuityLevel;
                        const isDirty = !!pending[s.id];

                        return (
                          <TableRow key={s.id} className={isDirty ? "bg-muted/40" : ""}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{s.name}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {s.shiftType}
                                </Badge>
                                {isDirty && (
                                  <span className="text-xs text-amber-600 font-medium">
                                    unsaved
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {s.startTime} – {s.endTime}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {s.unit}
                            </TableCell>
                            <TableCell>
                              <TierDot color={s.acuityLevel} />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={displayColor ?? ""}
                                onValueChange={(v) =>
                                  handleTierChange(
                                    s,
                                    v as "blue" | "green" | "yellow" | "red"
                                  )
                                }
                              >
                                <SelectTrigger size="sm" className="w-48">
                                  <SelectValue placeholder="Select tier…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIERS.map((t) => (
                                    <SelectItem key={t.value} value={t.value}>
                                      <span className="flex items-center gap-2">
                                        <span
                                          className={`inline-block h-2 w-2 rounded-full ${t.dot}`}
                                        />
                                        {t.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <div className="mt-4 flex items-center gap-3">
                    <Button onClick={handleSave} disabled={!hasPending || saving}>
                      {saving ? "Saving…" : "Save Changes"}
                    </Button>
                    {hasPending && !saving && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPending({});
                          setSaveMessage(null);
                        }}
                      >
                        Discard
                      </Button>
                    )}
                    {saveMessage && (
                      <p
                        className={`text-sm ${
                          saveMessage.startsWith("Saved")
                            ? "text-green-600"
                            : "text-destructive"
                        }`}
                      >
                        {saveMessage}
                      </p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Band Thresholds (read-only reference) ──────────────────── */}
        <TabsContent value="thresholds" className="mt-4 space-y-4">
          {Object.keys(bandsByUnit).length === 0 ? (
            <p className="text-sm text-muted-foreground">No census bands configured.</p>
          ) : (
            Object.entries(bandsByUnit).map(([unit, unitBands]) => (
              <Card key={unit}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{unit}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tier</TableHead>
                        <TableHead>Patient Range</TableHead>
                        <TableHead>Required RNs</TableHead>
                        <TableHead>Required LPNs</TableHead>
                        <TableHead>Required CNAs</TableHead>
                        <TableHead>
                          Charge Nurses
                          <span className="block text-xs font-normal text-muted-foreground">(in RN count)</span>
                        </TableHead>
                        <TableHead>Ratio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...unitBands]
                        .sort((a, b) => a.minPatients - b.minPatients)
                        .map((b) => {
                          const tier = TIERS.find((t) => t.value === b.color);
                          return (
                            <TableRow key={b.id}>
                              <TableCell>
                                <span className="flex items-center gap-2 font-medium">
                                  <span
                                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                                      tier?.dot ?? "bg-gray-400"
                                    }`}
                                  />
                                  {tier ? tier.label : b.name}
                                </span>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {b.minPatients} – {b.maxPatients} patients
                              </TableCell>
                              <TableCell>{b.requiredRNs}</TableCell>
                              <TableCell>{b.requiredLPNs}</TableCell>
                              <TableCell>{b.requiredCNAs}</TableCell>
                              <TableCell>{b.requiredChargeNurses}</TableCell>
                              <TableCell>
                                <Badge variant="secondary">{b.patientToNurseRatio}</Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  <p className="mt-3 text-xs text-muted-foreground">
                    To edit patient ranges or staffing requirements, go to{" "}
                    <a href="/rules" className="underline hover:text-foreground">
                      Rules → Census Bands
                    </a>
                    .
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper used by assignment dialog (exported for reuse)
export { tierLabel, TierDot, TIERS };
