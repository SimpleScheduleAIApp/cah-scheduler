# Scheduler Performance Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate O(A²) per-iteration cost in local search by replacing full state rebuilds with incremental clone+remove+add operations, reducing 30-day schedule generation from 15+ minutes to under 60 seconds with no change to schedule quality.

**Architecture:** Add `removeAssignment()` to `SchedulerState`, expose `shiftMap` on `SchedulerContext` for O(1) lookups, refactor `computeTotalPenalty` and `isSwapValid` to accept a pre-built state instead of rebuilding from the raw array, and update all three sweep functions to maintain state incrementally. Batch DB writes in a transaction.

**Tech Stack:** TypeScript, better-sqlite3 (synchronous), existing `SchedulerState.clone()` method

---

## Task 1: Add `removeAssignment` to SchedulerState + remove sort from `addAssignment`

**Files:**
- Modify: `src/lib/engine/scheduler/state.ts`

- [ ] **Step 1: Remove the sort from `addAssignment`**

In `state.ts`, remove lines 56–58 (the `.sort()` call). The sort comment says "binary-search-ability" but no downstream method uses binary search — all use linear scans. Removing it makes `addAssignment` O(1) instead of O(n log n).

Old code to remove:
```typescript
staffList.sort((a, b) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.startTime < b.startTime ? -1 : 1
);
```

- [ ] **Step 2: Add `removeAssignment` method to `SchedulerState`**

Insert after the `addAssignment` method (after line 70):

```typescript
removeAssignment(draft: AssignmentDraft): void {
  // Remove from assignmentsByStaff
  const staffList = this.assignmentsByStaff.get(draft.staffId);
  if (staffList) {
    const idx = staffList.findIndex((a) => a.shiftId === draft.shiftId);
    if (idx !== -1) staffList.splice(idx, 1);
  }

  // Remove from assignmentsByShift
  const shiftList = this.assignmentsByShift.get(draft.shiftId);
  if (shiftList) {
    const idx = shiftList.findIndex((a) => a.staffId === draft.staffId);
    if (idx !== -1) shiftList.splice(idx, 1);
  }

  // Update workedDatesByStaff — only remove the date if no other assignment
  // for this staff on this date remains
  const remaining = this.assignmentsByStaff.get(draft.staffId) ?? [];
  if (!remaining.some((a) => a.date === draft.date)) {
    this.workedDatesByStaff.get(draft.staffId)?.delete(draft.date);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/scheduler/state.ts
git commit -m "perf: add removeAssignment to SchedulerState, remove O(n log n) sort from addAssignment"
```

---

## Task 2: Add `shiftMap` to `SchedulerContext`

**Files:**
- Modify: `src/lib/engine/scheduler/types.ts`
- Modify: `src/lib/engine/scheduler/index.ts`

- [ ] **Step 1: Add `shiftMap` field to `SchedulerContext` in types.ts**

After the `shifts: ShiftInfo[]` line, add:
```typescript
/** Shift lookup by ID — O(1) alternative to shifts.find() */
shiftMap: Map<string, ShiftInfo>;
```

- [ ] **Step 2: Populate `shiftMap` in `buildSchedulerContext` in index.ts**

The `ruleContext` already has `shiftMap` — it's used on line 17 to populate `shifts`. Add it to the returned object:

```typescript
return {
  scheduleId,
  shifts,
  shiftMap: ruleContext.shiftMap,   // ADD THIS LINE
  staffList,
  staffMap: ruleContext.staffMap,
  prnAvailability: ruleContext.prnAvailability,
  staffLeaves: ruleContext.staffLeaves,
  unitConfig: ruleContext.unitConfig,
  scheduleUnit: ruleContext.scheduleUnit,
  publicHolidays: ruleContext.publicHolidays,
  historicalWeekendCounts: ruleContext.historicalWeekendCounts,
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/scheduler/types.ts src/lib/engine/scheduler/index.ts
git commit -m "perf: expose shiftMap on SchedulerContext for O(1) shift lookups"
```

---

## Task 3: Refactor `computeTotalPenalty` and `isSwapValid` in local-search.ts

**Files:**
- Modify: `src/lib/engine/scheduler/local-search.ts`

This is the highest-impact task. Both functions currently rebuild `SchedulerState` from scratch on every call.

- [ ] **Step 1: Refactor `computeTotalPenalty` to accept pre-built state**

Replace the entire function (lines 41–77) with:

```typescript
/**
 * Compute a proxy total penalty from a flat list of assignments.
 * Accepts a pre-built SchedulerState — callers are responsible for keeping
 * it in sync with `assignments`. This eliminates the O(A²) rebuild on every call.
 */
function computeTotalPenalty(
  assignments: AssignmentDraft[],
  state: SchedulerState,
  context: SchedulerContext,
  weights: WeightProfile
): number {
  let total = 0;
  for (const a of assignments) {
    const staffInfo = context.staffMap.get(a.staffId);
    const shiftInfo = context.shiftMap.get(a.shiftId);
    if (!staffInfo || !shiftInfo) continue;

    const currentShiftAssignments = assignments.filter(
      (x) => x.shiftId === a.shiftId && x.staffId !== a.staffId
    );

    total += softPenalty(
      staffInfo,
      shiftInfo,
      state,
      weights,
      currentShiftAssignments,
      context.staffMap,
      a.isChargeNurse,
      context.unitConfig,
      context.historicalWeekendCounts ?? new Map()
    );
  }
  return total;
}
```

- [ ] **Step 2: Refactor `isSwapValid` to accept pre-built state and use clone+remove**

Replace the entire function (lines 84–165) with:

```typescript
/**
 * Quick hard-rule check for a proposed swap.
 * Accepts the current SchedulerState, clones it, removes the two assignments,
 * then checks hard rules — eliminating the O(A) full-array rebuild.
 */
function isSwapValid(
  currentState: SchedulerState,
  allAssignments: AssignmentDraft[],
  indexA: number,
  indexB: number,
  context: SchedulerContext
): boolean {
  const a = allAssignments[indexA];
  const b = allAssignments[indexB];

  const staffA = context.staffMap.get(a.staffId);
  const staffB = context.staffMap.get(b.staffId);
  const shiftA = context.shiftMap.get(a.shiftId);
  const shiftB = context.shiftMap.get(b.shiftId);

  if (!staffA || !staffB || !shiftA || !shiftB) return false;

  // Clone current state and remove the two assignments being swapped
  const tempState = currentState.clone();
  tempState.removeAssignment(a);
  tempState.removeAssignment(b);

  // ── Collective constraint checks ────────────────────────────────────────────

  if (a.isChargeNurse && (!staffB.isChargeNurseQualified || staffB.icuCompetencyLevel < 4)) return false;
  if (b.isChargeNurse && (!staffA.isChargeNurseQualified || staffA.icuCompetencyLevel < 4)) return false;

  if (isICUUnit(shiftA.unit)) {
    const remainingOnA = tempState.getShiftAssignments(shiftA.id);
    const hasLevel2OnA = remainingOnA.some(
      (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) === 2
    );
    if (hasLevel2OnA) {
      const stillHasLevel4OnA = remainingOnA.some(
        (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) >= 4
      );
      if (!stillHasLevel4OnA && staffB.icuCompetencyLevel < 4) return false;
    }
  }
  if (isICUUnit(shiftB.unit)) {
    const remainingOnB = tempState.getShiftAssignments(shiftB.id);
    const hasLevel2OnB = remainingOnB.some(
      (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) === 2
    );
    if (hasLevel2OnB) {
      const stillHasLevel4OnB = remainingOnB.some(
        (r) => (context.staffMap.get(r.staffId)?.icuCompetencyLevel ?? 0) >= 4
      );
      if (!stillHasLevel4OnB && staffA.icuCompetencyLevel < 4) return false;
    }
  }

  // ── Individual eligibility checks ────────────────────────────────────────────

  if (!passesHardRules(staffA, shiftB, tempState, context)) return false;
  const draftA: AssignmentDraft = {
    ...a,
    shiftId: shiftB.id,
    date: shiftB.date,
    shiftType: shiftB.shiftType,
    startTime: shiftB.startTime,
    endTime: shiftB.endTime,
    durationHours: shiftB.durationHours,
    unit: shiftB.unit,
    isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
    floatFromUnit: staffA.homeUnit && staffA.homeUnit !== shiftB.unit ? (staffA.homeUnit ?? null) : null,
  };
  tempState.addAssignment(draftA);
  if (!passesHardRules(staffB, shiftA, tempState, context)) return false;

  return true;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/scheduler/local-search.ts
git commit -m "perf: eliminate full state rebuild from computeTotalPenalty and isSwapValid"
```

---

## Task 4: Update `localSearch` to maintain incremental state

**Files:**
- Modify: `src/lib/engine/scheduler/local-search.ts`

- [ ] **Step 1: Rewrite `localSearch` to build state once and update incrementally**

Replace the `localSearch` function body (lines 192–267):

```typescript
export function localSearch(
  result: GenerationResult,
  context: SchedulerContext,
  weights: WeightProfile,
  maxIterations = 500,
  seed = 0
): GenerationResult {
  if (result.assignments.length < 4) return result;

  const rand = mulberry32(seed);

  let assignments = [...result.assignments];

  // Build state once — updated incrementally on every accepted swap
  let state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);

  let currentPenalty = computeTotalPenalty(assignments, state, context, weights);

  const laBuffer = new Array<number>(LA_BUFFER_SIZE).fill(currentPenalty);
  let laIdx = 0;

  let bestPenalty = currentPenalty;
  let bestAssignments = [...assignments];

  for (let iter = 0; iter < maxIterations; iter++) {
    const i = Math.floor(rand() * assignments.length);
    let j = Math.floor(rand() * assignments.length);
    let tries = 0;
    while ((j === i || assignments[i].shiftId === assignments[j].shiftId) && tries < 10) {
      j = Math.floor(rand() * assignments.length);
      tries++;
    }
    if (j === i || assignments[i].shiftId === assignments[j].shiftId) continue;

    if (!isSwapValid(state, assignments, i, j, context)) continue;

    const a = assignments[i];
    const b = assignments[j];
    const shiftA = context.shiftMap.get(a.shiftId)!;
    const shiftB = context.shiftMap.get(b.shiftId)!;
    const staffA = context.staffMap.get(a.staffId)!;
    const staffB = context.staffMap.get(b.staffId)!;

    const newA: AssignmentDraft = {
      ...a,
      staffId: b.staffId,
      unit: shiftA.unit,
      isFloat: !!(staffB.homeUnit && staffB.homeUnit !== shiftA.unit),
      floatFromUnit: staffB.homeUnit && staffB.homeUnit !== shiftA.unit ? (staffB.homeUnit ?? null) : null,
    };
    const newB: AssignmentDraft = {
      ...b,
      staffId: a.staffId,
      unit: shiftB.unit,
      isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
      floatFromUnit: staffA.homeUnit && staffA.homeUnit !== shiftB.unit ? (staffA.homeUnit ?? null) : null,
    };

    const swapped = [...assignments];
    swapped[i] = newA;
    swapped[j] = newB;

    // Build candidate state incrementally from current state
    const candidateState = state.clone();
    candidateState.removeAssignment(a);
    candidateState.removeAssignment(b);
    candidateState.addAssignment(newA);
    candidateState.addAssignment(newB);

    const newPenalty = computeTotalPenalty(swapped, candidateState, context, weights);

    if (newPenalty <= laBuffer[laIdx]) {
      assignments = swapped;
      state = candidateState;  // adopt incremental state
      currentPenalty = newPenalty;

      if (newPenalty < bestPenalty) {
        bestPenalty = newPenalty;
        bestAssignments = [...swapped];
      }
    }

    laBuffer[laIdx] = currentPenalty;
    laIdx = (laIdx + 1) % LA_BUFFER_SIZE;
  }

  return { assignments: bestAssignments, understaffed: result.understaffed };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/engine/scheduler/local-search.ts
git commit -m "perf: maintain incremental SchedulerState in localSearch instead of rebuilding each iteration"
```

---

## Task 5: Update `overtimeReductionSweep` to maintain incremental state

**Files:**
- Modify: `src/lib/engine/scheduler/local-search.ts`

- [ ] **Step 1: Rewrite `overtimeReductionSweep` to use incremental state**

Replace the function body of `overtimeReductionSweep` (lines 299–366):

```typescript
export function overtimeReductionSweep(
  initialAssignments: AssignmentDraft[],
  context: SchedulerContext,
  weights: WeightProfile
): AssignmentDraft[] {
  let assignments = [...initialAssignments];

  // Build state once
  let state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);

  let currentPenalty = computeTotalPenalty(assignments, state, context, weights);
  let madeProgress = true;

  while (madeProgress) {
    madeProgress = false;
    recomputeOvertimeFlags(assignments);

    const otIndices = assignments
      .map((_, i) => i)
      .filter((i) => assignments[i].isOvertime);

    if (otIndices.length === 0) break;

    outer: for (const otIdx of otIndices) {
      for (let j = 0; j < assignments.length; j++) {
        if (j === otIdx) continue;
        if (assignments[otIdx].shiftId === assignments[j].shiftId) continue;
        if (!isSwapValid(state, assignments, otIdx, j, context)) continue;

        const a = assignments[otIdx];
        const b = assignments[j];
        const shiftA = context.shiftMap.get(a.shiftId)!;
        const shiftB = context.shiftMap.get(b.shiftId)!;
        const staffA = context.staffMap.get(a.staffId)!;
        const staffB = context.staffMap.get(b.staffId)!;

        const newA: AssignmentDraft = {
          ...a,
          staffId: b.staffId,
          isFloat: !!(staffB.homeUnit && staffB.homeUnit !== shiftA.unit),
          floatFromUnit:
            staffB.homeUnit && staffB.homeUnit !== shiftA.unit
              ? (staffB.homeUnit ?? null)
              : null,
        };
        const newB: AssignmentDraft = {
          ...b,
          staffId: a.staffId,
          isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
          floatFromUnit:
            staffA.homeUnit && staffA.homeUnit !== shiftB.unit
              ? (staffA.homeUnit ?? null)
              : null,
        };

        const swapped = [...assignments];
        swapped[otIdx] = newA;
        swapped[j] = newB;

        const candidateState = state.clone();
        candidateState.removeAssignment(a);
        candidateState.removeAssignment(b);
        candidateState.addAssignment(newA);
        candidateState.addAssignment(newB);

        const newPenalty = computeTotalPenalty(swapped, candidateState, context, weights);
        if (newPenalty < currentPenalty) {
          assignments = swapped;
          state = candidateState;
          currentPenalty = newPenalty;
          madeProgress = true;
          break outer;
        }
      }
    }
  }

  return assignments;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/engine/scheduler/local-search.ts
git commit -m "perf: maintain incremental SchedulerState in overtimeReductionSweep"
```

---

## Task 6: Update `weekendRedistributionSweep` to maintain incremental state

**Files:**
- Modify: `src/lib/engine/scheduler/local-search.ts`

- [ ] **Step 1: Rewrite `weekendRedistributionSweep` to use incremental state**

Replace the function body of `weekendRedistributionSweep` (lines 380–475):

```typescript
export function weekendRedistributionSweep(
  initialAssignments: AssignmentDraft[],
  context: SchedulerContext,
  weights: WeightProfile
): AssignmentDraft[] {
  let assignments = [...initialAssignments];

  // Build state once
  let state = new SchedulerState();
  for (const a of assignments) state.addAssignment(a);

  let currentPenalty = computeTotalPenalty(assignments, state, context, weights);
  let madeProgress = true;

  while (madeProgress) {
    madeProgress = false;

    const weekendCounts = new Map<string, number>();
    for (const id of new Set(assignments.map((a) => a.staffId))) {
      weekendCounts.set(id, 0);
    }
    for (const a of assignments) {
      const day = new Date(a.date + "T00:00:00Z").getUTCDay();
      if (day === 0 || day === 6) {
        weekendCounts.set(a.staffId, (weekendCounts.get(a.staffId) ?? 0) + 1);
      }
    }

    const counts = [...weekendCounts.values()];
    if (counts.length < 2) break;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;

    const deficitStaffIds = new Set(
      [...weekendCounts.entries()]
        .filter(([, c]) => c < mean)
        .map(([id]) => id)
    );

    const excessIndices = assignments
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => {
        const day = new Date(a.date + "T00:00:00Z").getUTCDay();
        return (day === 0 || day === 6) && (weekendCounts.get(a.staffId) ?? 0) > mean;
      })
      .map(({ i }) => i);

    if (excessIndices.length === 0) break;

    outer: for (const exIdx of excessIndices) {
      for (let j = 0; j < assignments.length; j++) {
        if (j === exIdx) continue;
        if (assignments[exIdx].shiftId === assignments[j].shiftId) continue;
        if (!deficitStaffIds.has(assignments[j].staffId)) continue;
        if (!isSwapValid(state, assignments, exIdx, j, context)) continue;

        const a = assignments[exIdx];
        const b = assignments[j];
        const shiftA = context.shiftMap.get(a.shiftId)!;
        const shiftB = context.shiftMap.get(b.shiftId)!;
        const staffA = context.staffMap.get(a.staffId)!;
        const staffB = context.staffMap.get(b.staffId)!;

        const newA: AssignmentDraft = {
          ...a,
          staffId: b.staffId,
          isFloat: !!(staffB.homeUnit && staffB.homeUnit !== shiftA.unit),
          floatFromUnit:
            staffB.homeUnit && staffB.homeUnit !== shiftA.unit
              ? (staffB.homeUnit ?? null)
              : null,
        };
        const newB: AssignmentDraft = {
          ...b,
          staffId: a.staffId,
          isFloat: !!(staffA.homeUnit && staffA.homeUnit !== shiftB.unit),
          floatFromUnit:
            staffA.homeUnit && staffA.homeUnit !== shiftB.unit
              ? (staffA.homeUnit ?? null)
              : null,
        };

        const swapped = [...assignments];
        swapped[exIdx] = newA;
        swapped[j] = newB;

        const candidateState = state.clone();
        candidateState.removeAssignment(a);
        candidateState.removeAssignment(b);
        candidateState.addAssignment(newA);
        candidateState.addAssignment(newB);

        const newPenalty = computeTotalPenalty(swapped, candidateState, context, weights);
        if (newPenalty < currentPenalty) {
          assignments = swapped;
          state = candidateState;
          currentPenalty = newPenalty;
          madeProgress = true;
          break outer;
        }
      }
    }
  }

  return assignments;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/engine/scheduler/local-search.ts
git commit -m "perf: maintain incremental SchedulerState in weekendRedistributionSweep"
```

---

## Task 7: Batch DB writes in `writeAssignments`

**Files:**
- Modify: `src/lib/engine/scheduler/runner.ts`

- [ ] **Step 1: Wrap all inserts in a single SQLite transaction**

Replace the for loop in `writeAssignments` (lines 147–184) with a transaction wrapper:

```typescript
function writeAssignments(
  drafts: AssignmentDraft[],
  scheduleId: string,
  context: SchedulerContext
): void {
  const holidayDateToName = new Map<string, string>();
  for (const h of context.publicHolidays) {
    holidayDateToName.set(h.date, getLogicalHolidayName(h.name));
  }

  const doInserts = db.transaction(() => {
    for (const draft of drafts) {
      const id = crypto.randomUUID();

      db.insert(assignment)
        .values({
          id,
          shiftId: draft.shiftId,
          staffId: draft.staffId,
          scheduleId,
          status: "assigned",
          isChargeNurse: draft.isChargeNurse,
          isOvertime: draft.isOvertime,
          isFloat: draft.isFloat,
          floatFromUnit: draft.floatFromUnit,
          assignmentSource: "auto_generated",
        })
        .run();

      const logicalHoliday = holidayDateToName.get(draft.date);
      if (logicalHoliday) {
        const year = new Date(draft.date).getFullYear();
        try {
          db.insert(staffHolidayAssignment)
            .values({
              staffId: draft.staffId,
              holidayName: logicalHoliday,
              year,
              shiftId: draft.shiftId,
              assignmentId: id,
            })
            .run();
        } catch {
          // Ignore unique constraint violation
        }
      }
    }
  });

  doInserts();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/engine/scheduler/runner.ts
git commit -m "perf: batch writeAssignments inserts in a single SQLite transaction"
```

---

## Task 8: Verify the fix works

- [ ] **Step 1: Start dev server and generate a 14-day schedule**

Run `npm run dev` and generate a 14-day schedule. It should complete in under 15 seconds (was ~2 minutes).

- [ ] **Step 2: Generate a 30-day schedule**

Generate a 30-day schedule. It should complete in under 60 seconds (was 15+ minutes).

- [ ] **Step 3: Spot-check schedule quality**

Verify the generated schedule looks reasonable:
- Hard violations count should be 0 or close to the same as before
- All 3 variants (Balanced, Fairness, Cost) are generated correctly
- Scenario Comparison page shows all 3 variants with scores

- [ ] **Step 4: Final commit if everything looks good**

```bash
git add -A
git commit -m "perf: verify scheduler performance fix — 30-day generation under 60s"
```
