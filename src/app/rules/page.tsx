"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Rule {
  id: string;
  name: string;
  ruleType: string;
  category: string;
  description: string | null;
  parameters: Record<string, unknown>;
  weight: number;
  isActive: boolean;
}

interface CensusBand {
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
}

const CENSUS_TIER_DOT: Record<string, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  yellow: "bg-yellow-500",
  red:    "bg-red-500",
};

const CENSUS_TIER_LABEL: Record<string, string> = {
  blue:   "Blue — Low Census",
  green:  "Green — Normal",
  yellow: "Yellow — Elevated",
  red:    "Red — Critical",
};

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [bands, setBands] = useState<CensusBand[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBandId, setEditingBandId] = useState<string | null>(null);
  const [bandDraft, setBandDraft] = useState<Partial<CensusBand> | null>(null);
  const [bandSaving, setBandSaving] = useState(false);

  const fetchData = useCallback(async () => {
    const [rulesRes, bandsRes] = await Promise.all([
      fetch("/api/rules"),
      fetch("/api/census-bands"),
    ]);
    setRules(await rulesRes.json());
    setBands(await bandsRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function toggleRule(id: string, isActive: boolean) {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;

    await fetch(`/api/rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rule, isActive }),
    });
    fetchData();
  }

  async function updateWeight(id: string, weight: number) {
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;

    await fetch(`/api/rules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rule, weight }),
    });
    fetchData();
  }

  function startEditBand(band: CensusBand) {
    setEditingBandId(band.id);
    setBandDraft({ ...band });
  }

  function cancelEditBand() {
    setEditingBandId(null);
    setBandDraft(null);
  }

  async function saveBand() {
    if (!bandDraft || !editingBandId) return;
    setBandSaving(true);
    await fetch("/api/census-bands", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingBandId, ...bandDraft }),
    });
    setBandSaving(false);
    setEditingBandId(null);
    setBandDraft(null);
    fetchData();
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const hardRules = rules.filter((r) => r.ruleType === "hard");
  const softRules = rules.filter((r) => r.ruleType === "soft");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Rules Configuration</h1>
        <p className="mt-1 text-muted-foreground">
          {rules.filter((r) => r.isActive).length} of {rules.length} rules active
        </p>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Scheduling Rules</TabsTrigger>
          <TabsTrigger value="census">Census Bands</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Hard Rules (must be satisfied)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hardRules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.category}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {r.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.isActive ? "default" : "secondary"}>
                          {r.isActive ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleRule(r.id, !r.isActive)}
                        >
                          {r.isActive ? "Disable" : "Enable"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Soft Rules (scored with weights)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {softRules.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.category}</Badge>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {r.description}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="10"
                            step="0.5"
                            value={r.weight}
                            onChange={(e) =>
                              updateWeight(r.id, parseFloat(e.target.value))
                            }
                            className="w-20"
                          />
                          <span className="w-8 text-sm">{r.weight}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.isActive ? "default" : "secondary"}>
                          {r.isActive ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleRule(r.id, !r.isActive)}
                        >
                          {r.isActive ? "Disable" : "Enable"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="census">
          <Card>
            <CardHeader>
              <CardTitle>Census Bands</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Band</TableHead>
                    <TableHead>Patient Range</TableHead>
                    <TableHead>Required RNs</TableHead>
                    <TableHead>Required LPNs</TableHead>
                    <TableHead>Required CNAs</TableHead>
                    <TableHead>
                      Charge Nurses
                      <span className="block text-xs font-normal text-muted-foreground">(in RN count)</span>
                    </TableHead>
                    <TableHead>Ratio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bands.map((b) => {
                    const isEditing = editingBandId === b.id;
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2.5 w-2.5 rounded-full ${
                                CENSUS_TIER_DOT[b.color] ?? "bg-gray-400"
                              }`}
                            />
                            {CENSUS_TIER_LABEL[b.color] ?? b.name}
                          </span>
                        </TableCell>

                        {isEditing ? (
                          <>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  className="w-16 h-7 text-sm"
                                  value={bandDraft?.minPatients ?? b.minPatients}
                                  onChange={(e) => setBandDraft((d) => ({ ...d, minPatients: Number(e.target.value) }))}
                                />
                                <span className="text-muted-foreground">–</span>
                                <Input
                                  type="number"
                                  min={0}
                                  className="w-16 h-7 text-sm"
                                  value={bandDraft?.maxPatients ?? b.maxPatients}
                                  onChange={(e) => setBandDraft((d) => ({ ...d, maxPatients: Number(e.target.value) }))}
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="w-16 h-7 text-sm"
                                value={bandDraft?.requiredRNs ?? b.requiredRNs}
                                onChange={(e) => setBandDraft((d) => ({ ...d, requiredRNs: Number(e.target.value) }))}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="w-16 h-7 text-sm"
                                value={bandDraft?.requiredLPNs ?? b.requiredLPNs}
                                onChange={(e) => setBandDraft((d) => ({ ...d, requiredLPNs: Number(e.target.value) }))}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="w-16 h-7 text-sm"
                                value={bandDraft?.requiredCNAs ?? b.requiredCNAs}
                                onChange={(e) => setBandDraft((d) => ({ ...d, requiredCNAs: Number(e.target.value) }))}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                className="w-16 h-7 text-sm"
                                value={bandDraft?.requiredChargeNurses ?? b.requiredChargeNurses}
                                onChange={(e) => setBandDraft((d) => ({ ...d, requiredChargeNurses: Number(e.target.value) }))}
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                className="w-16 h-7 text-sm"
                                value={bandDraft?.patientToNurseRatio ?? b.patientToNurseRatio}
                                onChange={(e) => setBandDraft((d) => ({ ...d, patientToNurseRatio: e.target.value }))}
                              />
                            </TableCell>
                            <TableCell>
                              <Badge variant={b.isActive ? "default" : "secondary"}>
                                {b.isActive ? "Active" : "Disabled"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button size="sm" onClick={saveBand} disabled={bandSaving}>
                                  {bandSaving ? "Saving…" : "Save"}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={cancelEditBand}>
                                  Cancel
                                </Button>
                              </div>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell>
                              {b.minPatients} – {b.maxPatients} patients
                            </TableCell>
                            <TableCell>{b.requiredRNs}</TableCell>
                            <TableCell>{b.requiredLPNs}</TableCell>
                            <TableCell>{b.requiredCNAs}</TableCell>
                            <TableCell>{b.requiredChargeNurses}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">{b.patientToNurseRatio}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={b.isActive ? "default" : "secondary"}>
                                {b.isActive ? "Active" : "Disabled"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => startEditBand(b)}
                                disabled={editingBandId !== null}
                              >
                                Edit
                              </Button>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
