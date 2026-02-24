import { describe, it, expect } from "vitest";
import { overtimeRulesV2 } from "@/lib/engine/rules/overtime-v2";
import { makeContext, makeAssignment, makeStaff, makeShift } from "../helpers/context";

describe("overtime-v2 rule", () => {
  // Week: 2026-02-09 (Mon) to 2026-02-15 (Sun)
  const makeWeekShifts = (hours: number[], staffId = "staff-1", weekStartDate = "2026-02-09") => {
    const shifts: ReturnType<typeof makeShift>[] = [];
    const assignments: ReturnType<typeof makeAssignment>[] = [];
    hours.forEach((h, i) => {
      const date = new Date(weekStartDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      const shiftId = `s${i}`;
      shifts.push(makeShift({ id: shiftId, date: dateStr, durationHours: h, countsTowardStaffing: true }));
      assignments.push(makeAssignment({ id: `a${i}`, shiftId, staffId, date: dateStr, durationHours: h }));
    });
    return { shifts, assignments };
  };

  it("no violation when exactly at FTE hours (1.0 FTE = 40h/week)", () => {
    const staff = makeStaff({ id: "staff-1", fte: 1.0 });
    const { shifts, assignments } = makeWeekShifts([8, 8, 8, 8, 8]); // 40h
    const ctx = makeContext({
      assignments,
      shiftMap: new Map(shifts.map(s => [s.id, s])),
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(overtimeRulesV2.evaluate(ctx)).toHaveLength(0);
  });

  it("flags actual overtime (>40h) with HIGH penalty", () => {
    const staff = makeStaff({ id: "staff-1", fte: 1.0 });
    // 4 x 12h = 48h in one week → 8h OT
    const { shifts, assignments } = makeWeekShifts([12, 12, 12, 12]);
    const ctx = makeContext({
      assignments,
      shiftMap: new Map(shifts.map(s => [s.id, s])),
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = overtimeRulesV2.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe("overtime-v2");
    expect(violations[0].description).toContain("actual overtime");
    expect(violations[0].penaltyScore).toBeGreaterThan(0);
  });

  it("penalty for actual OT is proportional to overtime hours (8h OT = 8/12 × weight)", () => {
    const staff = makeStaff({ id: "staff-1", fte: 1.0 });
    // 48h total → 8h OT
    const { shifts, assignments } = makeWeekShifts([12, 12, 12, 12]);
    const ctx = makeContext({
      assignments,
      shiftMap: new Map(shifts.map(s => [s.id, s])),
      staffMap: new Map([["staff-1", staff]]),
      ruleParameters: { actualOtPenaltyWeight: 1.0, extraHoursPenaltyWeight: 0.3 },
    });
    const violations = overtimeRulesV2.evaluate(ctx);
    expect(violations[0].penaltyScore).toBeCloseTo(8 / 12, 5);
  });

  it("flags extra hours (above FTE but <= 40) with LOW penalty for 0.9 FTE", () => {
    // 0.9 FTE = 36h standard, working 40h total is NOT OT but IS extra hours
    const staff = makeStaff({ id: "staff-1", fte: 0.9 });
    const { shifts, assignments } = makeWeekShifts([8, 8, 8, 8, 8]); // 40h
    const ctx = makeContext({
      assignments,
      shiftMap: new Map(shifts.map(s => [s.id, s])),
      staffMap: new Map([["staff-1", staff]]),
      ruleParameters: { actualOtPenaltyWeight: 1.0, extraHoursPenaltyWeight: 0.3 },
    });
    const violations = overtimeRulesV2.evaluate(ctx);
    expect(violations).toHaveLength(1);
    expect(violations[0].description).toContain("above contracted hours");
    // Extra hours = 40 - 36 = 4h. Penalty = (4/12) * 0.3 ≈ 0.1
    expect(violations[0].penaltyScore).toBeCloseTo((4 / 12) * 0.3, 5);
  });

  it("OT penalty is strictly higher than extra-hours penalty for same delta", () => {
    // Staff A (1.0 FTE) works 48h → 8h actual OT penalty
    const staffA = makeStaff({ id: "staff-a", fte: 0.8 }); // 0.8 FTE = 32h standard
    // Staff A works 40h → 8h extra hours (not OT)
    const { shifts: shiftsA, assignments: assignmentsA } = makeWeekShifts([8, 8, 8, 8, 8], "staff-a");

    const staffB = makeStaff({ id: "staff-b", fte: 1.0 });
    // Staff B works 48h → 8h actual OT
    const { shifts: shiftsB, assignments: assignmentsB } = makeWeekShifts([12, 12, 12, 12], "staff-b", "2026-02-16");

    const allShifts = [...shiftsA, ...shiftsB];
    const allAssignments = [...assignmentsA, ...assignmentsB];

    const ctx = makeContext({
      assignments: allAssignments,
      shiftMap: new Map(allShifts.map(s => [s.id, s])),
      staffMap: new Map([["staff-a", staffA], ["staff-b", staffB]]),
      ruleParameters: { actualOtPenaltyWeight: 1.0, extraHoursPenaltyWeight: 0.3 },
    });

    const violations = overtimeRulesV2.evaluate(ctx);
    const extraHoursViolation = violations.find(v => v.staffId === "staff-a" && v.description.includes("above contracted hours"));
    const otViolation = violations.find(v => v.staffId === "staff-b" && v.description.includes("actual overtime"));

    expect(extraHoursViolation).toBeDefined();
    expect(otViolation).toBeDefined();
    expect(otViolation!.penaltyScore!).toBeGreaterThan(extraHoursViolation!.penaltyScore!);
  });

  it("does not flag shifts not counting toward staffing", () => {
    const staff = makeStaff({ id: "staff-1", fte: 1.0 });
    // 6 x 12h = 72h but none count toward staffing
    const shifts = Array.from({ length: 6 }, (_, i) => {
      const date = new Date("2026-02-09");
      date.setDate(date.getDate() + i);
      return makeShift({ id: `s${i}`, date: date.toISOString().split("T")[0], durationHours: 12, countsTowardStaffing: false });
    });
    const assignments = shifts.map((s, i) => makeAssignment({ id: `a${i}`, shiftId: s.id, staffId: "staff-1", date: s.date, durationHours: 12 }));
    const ctx = makeContext({
      assignments,
      shiftMap: new Map(shifts.map(s => [s.id, s])),
      staffMap: new Map([["staff-1", staff]]),
    });
    expect(overtimeRulesV2.evaluate(ctx)).toHaveLength(0);
  });

  it("evaluates each week independently", () => {
    const staff = makeStaff({ id: "staff-1", fte: 1.0 });
    // Week 1: 48h (OT), Week 2: 32h (under standard)
    const { shifts: shifts1, assignments: a1s } = makeWeekShifts([12, 12, 12, 12], "staff-1", "2026-02-09");
    const { shifts: shifts2, assignments: a2s } = makeWeekShifts([8, 8, 8, 8], "staff-1", "2026-02-16");
    const ctx = makeContext({
      assignments: [...a1s, ...a2s],
      shiftMap: new Map([...shifts1, ...shifts2].map(s => [s.id, s])),
      staffMap: new Map([["staff-1", staff]]),
    });
    const violations = overtimeRulesV2.evaluate(ctx);
    // Only week 1 should flag
    expect(violations).toHaveLength(1);
    expect(violations[0].description).toContain("week of 2026-02-09");
  });
});
