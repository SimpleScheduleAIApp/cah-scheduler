# Changelog

All notable changes to the CAH Scheduler project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.6.11] - 2026-03-15

### Fixed

- **Violation modal: "Staff Schedule Issues" merged into "Soft Rule Violations"** (`src/components/schedule/shift-violations-modal.tsx`): The shift violations modal previously had three sections — Hard Rule Violations (red), Soft Rule Violations (yellow), and a separate Staff Schedule Issues (orange) for schedule-wide soft violations such as overtime and consecutive weekends. From the manager's perspective, all penalties belong in one place. The two soft-violation sections are now merged: all soft violations — whether shift-specific (preference mismatch) or schedule-wide (consecutive weekends, overtime) — appear in the single "Soft Rule Violations" section. Schedule-wide items carry an inline "Schedule-wide" badge so managers can still distinguish them from shift-specific penalties. The `WEEKEND_ONLY_RULE_IDS` filter (which prevents consecutive-weekend violations from appearing on weekday shifts) is unchanged.

### Files Modified

- `src/components/schedule/shift-violations-modal.tsx` — `staffViolations` filter removed; `softViolations` now includes all `ruleType === "soft"` violations; "Schedule-wide" badge rendered inline for items with no `shiftId`

---

## [1.6.10] - 2026-03-15

### Fixed

- **Performance regression on 28-day schedules restored** (`src/lib/engine/scheduler/scoring.ts`, `src/lib/engine/scheduler/state.ts`): The v1.6.9 consecutive-weekend penalty introduced an O(n) loop inside `softPenalty()` — it called `state.getStaffAssignments()` on every invocation and iterated every assignment for that staff member to build a set of weekend IDs. For a 28-day schedule this created ~2.25 million `Date` allocations across the ~125,000 `softPenalty()` calls made during local search and the redistribution sweeps, causing extreme GC pressure and a 14.7× regression (93s → 1,374s). The loop has been replaced with an O(maxConsecutive) bounded backward/forward scan using a new `hasWorkedDate()` method on `SchedulerState`, which performs an O(1) Set lookup against the already-maintained `workedDatesByStaff` index. For the default `maxConsecutiveWeekends = 2`, each call now performs at most 8 Date allocations and 8 Set lookups regardless of schedule length, restoring linear scaling.

- **Consecutive-weekend penalty no longer conflicts with weekend-equity bonus** (`src/lib/engine/scheduler/scoring.ts`): The v1.6.9 section 3b penalty fired unconditionally for all staff below AND above their weekend quota. For staff below quota, section 3 awards a bonus of `−weights.weekendCount × 0.5` to incentivise filling required weekends, but section 3b immediately applied a penalty of `weights.consecutiveWeekends × 0.5` (same magnitude when both weights equal 1.0), effectively cancelling the bonus and causing the FAIR profile's fairness score to get worse after the fix (28-day: 0.25 → 0.35). Section 3b now only fires when the staff member is AT or ABOVE their required weekend count — the same condition under which section 3 switches from bonus to penalty. Staff below quota are never penalised for consecutive weekends during greedy construction; the scheduler is free to fill their required weekends even on back-to-back Saturdays/Sundays.

### Files Modified

- `src/lib/engine/scheduler/state.ts` — `hasWorkedDate(staffId, date): boolean` public method added (O(1) Set lookup via existing `workedDatesByStaff` index)
- `src/lib/engine/scheduler/scoring.ts` — section 3b rewritten: O(n) assignment loop replaced with O(maxConsecutive) bounded scan; quota gate added so penalty only fires when `weekendCount >= required`

---

## [1.6.9] - 2026-03-15

### Fixed

- **Consecutive weekends penalty now active in the scheduler** (`src/lib/engine/scheduler/scoring.ts`): The `consecutiveWeekends` weight was defined in all three weight profiles (Balanced 1.0, Fairness-Optimized 3.0, Cost-Optimized 1.0) but `softPenalty()` never read it — the scheduler assigned consecutive weekends freely and the FAIR profile's high weight of 3.0 had no effect. `softPenalty()` now includes a consecutive-weekend component: on every weekend shift, it collects the staff member's existing weekend assignments, checks whether adding this shift would extend a consecutive streak past the unit maximum (default 2), and applies a penalty of `weights.consecutiveWeekends × (0.5 + excess × 0.5)` if so. Saturday and Sunday of the same weekend share one ID (Sunday anchors back to Saturday) so working both days never double-penalises. This mirrors the post-hoc `consecutiveWeekendRule` evaluator so the scheduler now avoids building these violations during greedy construction and local search rather than merely detecting them after generation.

- **Weekend-specific violations scoped to weekend shifts** (`src/app/schedule/[id]/page.tsx`): `consecutive-weekends` and `weekend-fairness` violations are now only attached to Sat/Sun shifts in the violations map. Previously, all staff-level violations (those with an empty `shiftId`) were propagated to every shift the staff member was assigned to — including weekday shifts — so clicking on a Monday Day Shift would show a "Consecutive Weekends Penalty" with nothing actionable the manager could do from that shift. These violations are only relevant on the weekend shifts where the pattern actually occurs.

### Files Modified

- `src/lib/engine/scheduler/scoring.ts` — consecutive-weekend penalty component added to `softPenalty()`
- `src/app/schedule/[id]/page.tsx` — `WEEKEND_ONLY_RULE_IDS` filter applied to staff-level violation propagation
- `RULES_SPECIFICATION.md` — §12.4 penalty table updated; document version 1.6.0

---

## [1.6.8] - 2026-03-15

### Fixed

- **OT-aware charge nurse selection** (`src/lib/engine/scheduler/greedy.ts`): The greedy scheduler now applies a non-OT filter before the Level 5 charge preference. Within the charge-qualified pool, candidates who would stay ≤ 40h are evaluated first; Level 5 is preferred within that non-OT pool. A Level 4 nurse with non-OT capacity is now selected over a Level 5 nurse who would enter overtime. Previously the algorithm exclusively preferred Level 5 nurses for all charge slots regardless of their weekly hours, causing any Level 5 nurse who specialised in a single shift type to be assigned charge duty every eligible shift until the 60h hard ceiling stopped them — resulting in 5 charge shifts/week (60h) for that nurse every single week while Level 4 stand-ins were unused. This concentrated overtime on one or two nurses per shift type and made all three schedule variants produce identical results (no swap could improve total OT because those nurses were already at the weekly maximum).

- **Schedule generation time: 15 minutes → under 2 minutes** (`src/lib/engine/scheduler/local-search.ts`, `src/lib/engine/scheduler/scoring.ts`): Three performance fixes applied to the local search and post-processing sweeps:
  1. *Delta swap evaluation* — instead of recomputing softPenalty for all ~280 assignments per swap attempt, only the ~15–30 assignments whose penalty actually changes are rescored (coworkers on both affected shifts + both staff members' same-week assignments for OT delta). This reduces per-swap work from O(all assignments) to O(shift size), cutting softPenalty calls from ~420,000 to ~20,000 across a full local-search run.
  2. *In-place state mutation* — `isSwapValid` now temporarily removes and restores assignments directly instead of cloning the full state object. This eliminates 1,500+ Map clones per schedule run (each clone copied ~800 entries).
  3. *Fast day-name lookup* — replaced `new Date().toLocaleDateString("en-US", { weekday: "long" })` (a slow V8 locale API) with a pre-built array lookup in `softPenalty`.

### Files Modified

- `src/lib/engine/scheduler/greedy.ts` — non-OT filter applied to charge candidate pool before Level 5 preference
- `src/lib/engine/scheduler/local-search.ts` — delta penalty helpers (`buildAffectedSet`, `scoreSubset`, `computeSwapDeltaPenalty`); `isSwapValid` refactored to in-place mutation with try/finally restoration; all three phase functions updated to use delta evaluation
- `src/lib/engine/scheduler/scoring.ts` — `DAY_NAMES` constant replaces `toLocaleDateString` call
- `src/lib/engine/scheduler/state.ts` — `addAssignment` now maintains the staff list in sorted order (date then startTime)
- `src/__tests__/scheduler/local-search.test.ts`, `src/__tests__/integration/scheduler-pipeline.test.ts`, `src/__tests__/integration/scheduler-output.test.ts`, `src/app/api/shifts/[id]/eligible-staff/route.ts` — added `shiftMap` to `SchedulerContext` construction (required field added when `shiftMap` was introduced in v1.6.7)
- `RULES_SPECIFICATION.md` — §12.2 charge selection updated; document version 1.5.9

---

## [1.6.7] - 2026-03-15

### Fixed

- **Fairness-Optimized and Cost-Optimized variants derived from Balanced base** (`src/lib/engine/scheduler/runner.ts`): Both alternative variants are now built from the Balanced result using deterministic post-processing sweeps instead of independent greedy + local-search runs. This guarantees that Fairness-Optimized never has worse weekend equity than Balanced, and Cost-Optimized never has more overtime than Balanced — properties that could not be reliably guaranteed when using independent random seeds. The root cause of the Fairness failure was that the high `preference` weight (2.0) in the FAIR profile respected `avoidWeekends` flags so strongly that it concentrated weekend assignments on fewer staff, paradoxically producing a worse weekend-equity score than Balanced. Building from the same Balanced base avoids this structural conflict.

- **Composite cost score formula** (`src/lib/engine/scheduler/runner.ts`): The scenario cost score now measures composite labor cost: `(agencyCount × 4 + otCount × 1 + floatCount × 0.2) / (total × 4)`. Previously it counted only overtime assignments, making agency and float optimisations invisible in the displayed score. The new formula reflects real hospital cost premiums: agency nurses carry a 2–3× markup over base pay (weight 4.0), overtime costs 1.5× base pay (weight 1.0), and float differentials are typically ~10% above base (weight 0.2). This matches what Cost-Optimized actually optimises for.

- **`computeTotalPenalty` O(n²) → O(n)** (`src/lib/engine/scheduler/local-search.ts`): The function previously called `assignments.filter()` inside a loop over assignments, scanning all n assignments n times. A `shiftId → coworkers` map is now precomputed once per call, reducing per-assignment lookup to O(shift_size) ≈ O(3). For a typical 84-assignment schedule this cuts from ~7,000 comparisons per call to ~252. Since `computeTotalPenalty` is called thousands of times during local search and the two deterministic sweeps, this significantly reduces generation time.

### Added

- **Verification script** (`scripts/verify-scores.ts`): Standalone script that generates all three schedule variants and asserts the score ordering guarantees: `cost(Cost) ≤ cost(Balanced)`, `fairness(Fair) ≤ fairness(Balanced)`, and `OT(Cost) ≤ OT(Balanced)`. Run with `npx tsx scripts/verify-scores.ts` after `npm run db:seed`.

### Files Modified

- `src/lib/engine/scheduler/runner.ts` — composite cost formula; Fair and Cost variants built from Balanced base + sweeps; removed independent FAIR generation and fairSeed
- `src/lib/engine/scheduler/local-search.ts` — precomputed shiftCoworkers map in `computeTotalPenalty`
- `scripts/verify-scores.ts` — new verification script
- `RULES_SPECIFICATION.md` — §12.1, §12.2 Phase 3, §12.6 updated; document version 1.5.8
- `docs/11-generating-schedules.md` — updated variant descriptions and FAQ answer

---

## [1.6.6] - 2026-03-10

### Fixed

- **Setup page sheet count** (`src/app/setup/page.tsx`): The helper text under "Download Template" incorrectly stated the template contained 3 sheets. Updated to correctly list all 5 sheets: Staff, Units, Holidays, Census Bands, and Staff Leave. Census Bands and Staff Leave were added in v1.4.6 and v1.5.0 respectively but the UI label was never updated.

- **Docs: missing Census Bands sheet** (`docs/09-using-the-app.md`): The Excel Template Sheets section listed only 4 sheets and omitted Census Bands entirely. Added Sheet 4 (Census Bands) with its fields. Also corrected the "First time setup" description and the export workflow step to include Census Bands.

### Files Modified

- `src/app/setup/page.tsx` — updated sheet count label from 3 to 5; listed all sheet names
- `docs/09-using-the-app.md` — added Census Bands as Sheet 4; corrected first-time setup description and export workflow copy

---

## [1.6.5] - 2026-03-06

### Added

- **Overstaffed shifts on Dashboard** (`src/app/dashboard/page.tsx`, `src/app/api/dashboard/route.ts`).

  The Dashboard now surfaces shifts where assigned active staff exceed the census-tier-required count:

  - **"Excess Staff Shifts" stat card** — shown in the metrics row alongside Understaffed Shifts and Open Callouts. Displays the count in blue when non-zero, green when all shifts are on target.
  - **"Needs Attention" alert** — when any overstaffed shifts exist, a blue-dot entry appears at the top of the Needs Attention list: *"X shift(s) have excess staff — consider flex-home or VTO"*, linking directly to the schedule grid where the manager can open any blue-bordered cell to see ranked flex-home recommendations.

  The API already computed `understaffedShifts` by iterating every shift with the same census-band-aware `getEffectiveRequired()` logic. The same loop now counts overstaffed shifts (`assigned > required`) in parallel at no additional query cost.

### Files Modified

- `src/app/api/dashboard/route.ts` — added `overstaffedShifts` counter in the staffing loop; added field to API response
- `src/app/dashboard/page.tsx` — added `overstaffedShifts` to `DashboardData` interface; blue-dot Needs Attention item; "Excess Staff Shifts" stat card; grid changed to responsive 5-column layout

---

## [1.6.4] - 2026-03-06

### Added

- **Overstaffed shift indicator in schedule grid** (`src/components/schedule/schedule-grid.tsx`).

  When a census tier change causes assigned staff to exceed the shift's required count (e.g., census drops to Blue and 5 nurses are assigned vs. 3 required), the shift cell now shows a **blue border** and a **"+X excess" badge** in the top-right corner. A single-line hint — "X excess — click for flex-home suggestions" — appears at the bottom of the cell. This makes low-census overstaffing immediately visible without cluttering the grid.

- **Flex-home / VTO recommendation panel in assignment dialog** (`src/components/schedule/assignment-dialog.tsx`).

  When a shift is overstaffed, a blue-highlighted panel appears at the top of the assignment dialog (above "Currently Assigned"), listing which staff to offer flex-home or voluntary time off first. Staff are ranked using the following priority:

  1. **On overtime** — sending them home stops the OT clock; immediate payroll saving
  2. **Agency staff** — flex before permanent staff
  3. **PRN staff** — flex before full-time employees
  4. **At or above FTE target hours** — already at their contracted weekly hours
  5. **Lower competency level** — retain the most experienced nurses on the floor

  The charge nurse is never included in recommendations regardless of any other factor. Each entry shows the staff member's name, role, competency level, OT badge (if applicable), and the specific reason(s) for the recommendation. The note at the bottom of the panel reminds the manager to use the Remove button below if staff accept flex-home, so the schedule reflects the change.

### Files Modified

- `src/components/schedule/schedule-grid.tsx` — overstaffed detection; blue border; `+X excess` badge; hint text; border priority order updated (hard → soft → overstaffed → full → partial)
- `src/components/schedule/assignment-dialog.tsx` — `getFlexRecommendations()` helper; flex-home panel; staff count badge styled blue when overstaffed

---

## [1.6.3] - 2026-03-06

### Added

- **Hard rules now have configurable parameters** (`src/app/rules/page.tsx`).

  Previously, each hard rule could only be toggled Active or Inactive. Rules with numeric thresholds or level requirements now show their current parameter values in the table and expose an inline **Edit** button. Clicking it expands an editor row directly in the table — no modal, no page navigation.

  Parameters available per rule:

  | Rule | Parameter(s) |
  |------|-------------|
  | Minimum Rest Between Shifts | `minRestHours` — number input; amber warning if < 8 h |
  | Maximum Consecutive Days | `maxConsecutiveDays` — number input; amber warning if > 5 |
  | Maximum Hours (7-Day Rolling) | `maxHours` — number input; amber warning if < 40 or > 72 |
  | ICU Competency Minimum | `minLevel` — level selector (1–5) |
  | Level 1 Must Have Preceptor | `minPreceptorLevel` — level selector (1–5) |
  | Level 2 ICU/ER Supervision | `minSupervisorLevel` — level selector (1–5) |
  | On-Call Limits | `maxOnCallPerWeek`, `maxOnCallWeekendsPerMonth` — number inputs |

  On-call limits were previously only configurable via unit configuration; they are now controlled here as rule parameters. The `no-overlapping-shifts` rule shows an "Always active" badge and cannot be toggled or edited.

  The rule engine already read from `context.ruleParameters` with fallbacks — no engine changes were needed. Only the UI and seed defaults were updated.

- **Audit trail: readable descriptions for manual assignments** (`src/app/api/schedules/[id]/assignments/route.ts`).

  Assignment log entries now show full names and shift context instead of raw UUIDs:
  - Before: `Assigned staff 63457c30-... to shift 820ca5a0-...`
  - After: `Assigned Sarah Chen to Day Shift on 2026-03-06` (with `(charge nurse)` appended when applicable)
  - Delete entries: `Removed Sarah Chen from Day Shift on 2026-03-06`

  The fix looks up `staff.firstName`/`lastName` and `shiftDefinition.name`/`shiftType` at log time. If a lookup fails (deleted record), the UUID falls back gracefully.

- **Audit trail: census tier changes now reliably logged** (`src/app/api/shifts/[id]/acuity/route.ts`).

  Census tier saves were being written to the DB by the acuity route, but used `db.insert(exceptionLog)` directly without an explicit timestamp, inconsistent with every other route. Switched to `logAuditEvent()` for consistency. Also fixed a gap: changes to `censusBandId` alone (without an `acuityLevel` change) were previously not logged. Now any change to either field triggers a log entry.

  The description now includes the shift definition name and unit: `"Census tier changed from green to blue for Day Shift (ICU) on 2026-03-06"`.

- **Audit trail page: census and shift events now visible** (`src/app/audit/page.tsx`).

  The `actionLabels` map was missing entries for `acuity_changed` and `census_changed`, causing those entries to render as raw key strings. Added human-readable labels ("Census Tier Changed", "Census Count Changed") and badge colors. Added "Shifts / Census" to the entity filter dropdown and "Census Tier Changed" / "Census Count Changed" to the action filter dropdown.

### Files Modified

- `src/app/rules/page.tsx` — full rewrite; `RULE_PARAMS` config; inline edit row; parameter inputs with warnings; `LOCKED_RULES` set
- `src/lib/engine/rules/competency-pairing.ts` — `level1-preceptor` reads `minPreceptorLevel`; `level2-supervision` reads `minSupervisorLevel`
- `src/lib/engine/rules/on-call-limits.ts` — reads `maxOnCallPerWeek` and `maxOnCallWeekendsPerMonth` from `ruleParameters` before falling back to unit config
- `src/db/seed.ts` — default parameter values seeded for configurable hard rules
- `src/app/api/schedules/[id]/assignments/route.ts` — POST and DELETE log human-readable staff name and shift label
- `src/app/api/shifts/[id]/acuity/route.ts` — switched to `logAuditEvent()`; logs on `censusBandId` change too; includes shift name and unit in description
- `src/app/audit/page.tsx` — added `acuity_changed`/`census_changed` labels; "Shifts / Census" entity filter; census action filters

---

## [1.6.2] - 2026-03-06

### Added

- **Schedule Excel export** (`src/app/api/schedules/[id]/export/route.ts`, `src/app/schedule/[id]/page.tsx`).

  An **Export** button now appears in the schedule detail page header. Clicking it downloads a `.xlsx` workbook with three sheets:

  - **Schedule Grid** — rows = dates, columns = shift names. Each cell lists all assigned nurses for that date+shift, with ★ prefixed for the charge nurse. Works for both draft and published schedules.
  - **Leave & Callouts** — all leave records for staff during the schedule period, plus any callout records for shifts in the schedule. Shows leave type, date range, status, and reason.
  - **Per-Staff List** — every assignment sorted by staff name then date, with shift name, start/end time, charge nurse flag, and overtime flag. Suitable for distributing individual schedules or importing into payroll systems.

  Column widths are pre-set so the file is readable without manual adjustment. The file is named after the schedule (e.g. `ICU-2nd-Mar-2026-schedule.xlsx`).

- **Audit trail CSV fix** (`src/app/audit/page.tsx`).

  Three bugs corrected in the Export CSV function:

  1. **Timestamp comma** — `toLocaleString()` returned locale-specific strings like "6/3/2026, 4:23:37 pm" whose comma pushed all subsequent columns right. Fixed: `toISOString().slice(0,19).replace("T"," ")` produces `2026-03-06 16:12:19` (no comma, UTC, sortable).
  2. **Unquoted fields** — Action, Entity, and Performed By were not quoted, so values containing commas would break column alignment. Fixed: every field is now wrapped with `csvField()` which double-escapes internal quotes.
  3. **Encoding** — no UTF-8 BOM caused em dashes and other Unicode characters to render as mojibake in Excel. Fixed: `\uFEFF` prepended to the blob content. Line endings changed to CRLF (`\r\n`) per Windows CSV convention.

### Files Modified

- `src/app/api/schedules/[id]/export/route.ts` — new file; Excel export endpoint
- `src/app/schedule/[id]/page.tsx` — Export button added; `handleExport()` function
- `src/app/audit/page.tsx` — `exportToCsv()` timestamp, quoting, and BOM fixed

---

## [1.6.1] - 2026-03-06

### Added

- **Publish / Unpublish button on schedule detail page** (`src/app/schedule/[id]/page.tsx`).

  A **Publish** button now appears in the schedule header alongside "Generate Schedule" and "Re-evaluate". Clicking it changes the schedule status from `draft` to `published` (calls `PUT /api/schedules/[id]`). Once published, the button becomes **Unpublish** to revert to draft. The Publish button is disabled and shows a tooltip ("Fix hard violations before publishing") when any hard violations are present.

### Fixed

- **Apply button in Schedule Variants page silently did nothing** (`src/app/api/scenarios/[id]/route.ts`, `src/app/scenarios/page.tsx`).

  When clicking Apply on the Fairness Optimized or Cost Optimized scenario, the page showed no change. Root cause: the frontend never checked whether the API responded with an error — it always proceeded to re-fetch the unchanged data. Separately, the Apply API performed a delete + batch insert outside a transaction, so any insert failure (unique constraint, FK, etc.) left the assignment table partially empty.

  Fixes:
  - The delete and all snapshot inserts are now wrapped in `db.transaction()` — if any insert fails, the delete is rolled back and the schedule remains intact.
  - A `try/catch` around the transaction returns a descriptive `500` on failure instead of crashing silently.
  - The frontend now checks `res.ok` and displays the error message in a red banner when Apply fails. If the error is a missing snapshot ("regenerate the schedule to fix this"), the message tells the user exactly what to do.

- **PRN nurses shown as callout replacement candidates without verifying availability** (`src/lib/coverage/find-candidates.ts`).

  A per diem nurse could be recommended as a callout replacement even when their `availableDates` did not include the shift date. Root cause: the check used `Array.includes()` on the raw DB value, which can behave unexpectedly when the JSON column is not properly parsed into an array. The rule engine uses a `Set` built by iterating the array with a `for...of` loop — a stricter approach.

  Fix: replaced the `.some((a) => a.availableDates?.includes(date))` check with the same Set-building logic used by the rule engine: iterate all availability records for the staff member, add each date string to a `Set`, then use `.has()` for an exact match. A PRN nurse with no availability records, or one who did not mark the shift date, is now correctly excluded from candidate recommendations.

### Files Modified

- `src/app/api/scenarios/[id]/route.ts` — Apply wrapped in transaction with try/catch; missing snapshot error message improved
- `src/app/scenarios/page.tsx` — `handleApply` checks response status; error banner shown on failure
- `src/app/schedule/[id]/page.tsx` — Publish/Unpublish button added to header; disabled on hard violations
- `src/lib/coverage/find-candidates.ts` — PRN availability check hardened to use Set matching

---

## [1.6.0] - 2026-03-06

### Added

- **Sidebar navigation reorganized into labeled groups** (`src/components/layout/sidebar.tsx`).

  The flat 15-item list is now divided into five sections with visual group headers:
  - *(no label)* — Dashboard
  - **Scheduling** — Schedule, Census, Schedule Variants
  - **Daily Management** — Callouts, Open Shifts, Leave, Shift Swaps, PRN Availability
  - **Configuration** — Staff, Rules, Units, Holidays
  - **System** — Import / Export, Audit Trail

  Three items were also renamed to better reflect their purpose: "Scenarios" → **Schedule Variants**, "Coverage" → **Open Shifts**, "Setup" → **Import / Export**. The nav area gained `overflow-y-auto` so it scrolls if the window is short.

- **Dashboard Getting Started checklist** (`src/app/dashboard/page.tsx`).

  An amber guidance card appears for new installs until all three setup steps are complete:
  1. Import your staff roster
  2. Configure units & rules
  3. Create a schedule period

  Each step links directly to the relevant page and shows a checkmark when done. The card has a dismiss button that persists the choice in `localStorage`. It hides automatically once all steps are complete.

- **Dashboard Needs Attention section** (`src/app/dashboard/page.tsx`).

  A live alert row appears between the schedule card and the metric cards when any of the following are true:
  - Pending leave requests awaiting approval (links to Leave page)
  - Open shifts needing coverage (links to Open Shifts page)
  - PRN staff who haven't submitted availability (links to PRN Availability page)
  - Current schedule ending within 7 days with no next schedule created (links to Schedule page)

- **Current schedule elevated to full-width card on Dashboard** (`src/app/dashboard/page.tsx`).

  The current schedule card is now the first element on the page. When a schedule exists, it shows a primary **"Open Schedule Builder →"** button. When no schedule exists, it shows a **"Create Schedule →"** button. The duplicate "Open Schedule Builder" quick-link card was removed and quick links were consolidated to a 2-column grid.

- **Unit staff count and warnings in the New Schedule dialog** (`src/app/schedule/page.tsx`, `src/app/api/units/route.ts`).

  The unit dropdown in the New Schedule dialog now shows the staff count next to each unit name (e.g., "ICU — 33 staff"). Two guard conditions prevent accidental schedule creation for under-resourced units:
  - **0 staff (red error)**: an inline error message explains the problem and links to Import / Export; the **Create Schedule** button is disabled.
  - **1–4 staff (yellow caution)**: a warning note is shown but the button remains enabled.

  The dialog now smart-defaults to the unit used in the most recent non-archived schedule, falling back to the first unit alphabetically. Previously it always defaulted to the first unit in the list.

- **Empty state on Staff page** (`src/components/staff/staff-table.tsx`).

  When no staff members exist (fresh install before import), the staff table now shows a friendly empty state with a link to Import / Export rather than an empty table.

- **Post-import success screen CTA updated** (`src/app/setup/page.tsx`).

  After a successful Excel import, the primary button is now **"Create Your First Schedule →"** rather than "Review Staff", guiding new users through the natural next step. "Review Staff" is retained as a secondary outline button.

### Fixed

- **Dashboard fill rate showing 148%** (`src/app/api/dashboard/route.ts`).

  Two bugs compounded to produce inflated fill rates:
  1. `totalSlots` used the shift definition's base `requiredStaffCount` (3 or 4), not the census-band-aware count (e.g., 5 for Green tier). Fixed by implementing the same 3-priority `getEffectiveRequired()` logic used in the schedule detail API.
  2. `totalAssignments` counted all assignments including `status = "cancelled"` (leave) and `status = "called_out"` (callouts). Fixed by loading all assignments in a single `inArray` batch query and skipping cancelled and called-out statuses before counting.

- **PRN missing count showing 5 instead of 1** (`src/app/api/dashboard/route.ts`).

  The query filtered `prnAvailability` by `scheduleId = latestSchedule.id`, but all records imported via Excel use the fixed anchor `PRN_TEMPLATE_SCHEDULE_ID = "00000000-0000-0000-0000-000000000001"` — meaning no imported records ever matched. Fixed by removing the `scheduleId` filter and checking only whether a staff member has *any* prnAvailability record at all, which matches the behavior of the PRN Availability page.

- **PRN Import Template appearing as "Current Schedule" on dashboard** (`src/app/api/dashboard/route.ts`).

  The PRN Import Template schedule has `status = "archived"` but a far-future `startDate`, so it sorted first and was selected as the latest schedule. Fixed by adding `ne(schedule.status, "archived")` to the `latestSchedule` query.

- **Getting Started checklist not appearing on first run** (`src/app/dashboard/page.tsx`, `src/app/api/dashboard/route.ts`).

  Same root cause as the PRN Import Template bug: the archived template counted as an active schedule, so step 3 ("Create a schedule period") was already marked done — hiding the checklist before it was ever useful. The archived-schedule fix above resolves this.

### Files Modified

- `src/components/layout/sidebar.tsx` — navItems refactored into navGroups with section labels; three items renamed
- `src/components/staff/staff-table.tsx` — empty state added
- `src/app/setup/page.tsx` — post-import CTA hierarchy updated
- `src/app/dashboard/page.tsx` — Getting Started checklist, Needs Attention section, schedule card elevated
- `src/app/api/dashboard/route.ts` — fill rate fix, PRN count fix, archived-schedule exclusion, new counts added
- `src/app/api/units/route.ts` — `staffCount` per unit added to GET response
- `src/app/schedule/page.tsx` — unit staff count in dropdown, smart default unit, staff warnings

---

## [1.5.7] - 2026-03-04

### Fixed

- **On-leave staff shown as active in schedule grid** (`src/components/schedule/schedule-grid.tsx`).

  When a staff member's leave was approved, the system correctly cancelled their assignments (`status = "cancelled"`). However, the schedule grid rendered cancelled assignments identically to active ones and included them in the staffing count — causing a shift to display "5/5 staff" (full) even though one person was on approved leave. The rule engine correctly fired a hard violation, but the full count masked the understaffing.

  Root cause: the `ShiftAssignment` TypeScript interface had no `status` field, and `staffCount` was computed as `shift.assignments.length` (all statuses). The API already returned `status` in every assignment object; the grid simply wasn't using it.

  Changes:
  - Added `status: string` to the `ShiftAssignment` interface.
  - `staffCount` and `hasCharge` now computed from active-only assignments (`status !== "cancelled"`).
  - Cancelled assignments are rendered below active ones with a strikethrough name, orange dot, and "Leave" badge.
  - "No staff assigned" empty-state only shown when there are no assignments of any status.

### Files Modified

- `src/components/schedule/schedule-grid.tsx` — `status` field added to type; count and charge-nurse detection use active assignments only; on-leave visual indicator

---

## [1.5.6] - 2026-03-04

### Added

- **`checkForUnexplainedUnderstaffing` validation utility** (`src/lib/engine/scheduler/validate-output.ts`).

  New pure function that scans the scheduler's `understaffed` output for shifts where:
  - No hard-rule rejection reasons were recorded, AND
  - Enough potentially available staff (active, not on leave, PRN with availability) existed to fill the shift.

  A non-empty result is a signal of a scheduler logic bug — the scheduler stopped filling a shift without a documented reason despite having sufficient staff. The v1.5.5 bug (requiredStaffCount mismatch) would have been caught by this check at generation time.

- **Integration test: census-band-aware scheduler output** (`src/__tests__/integration/scheduler-output.test.ts`).

  15 new tests across two describe blocks:
  - Unit tests for `checkForUnexplainedUnderstaffing` covering all branches: documented reasons, genuine shortage, leave-blocked staff, PRN without availability, inactive staff, and the suspicious (bug-signal) path.
  - Full pipeline test with a 25-staff / 7-day / 14-shift ICU fixture where each shift uses `requiredStaffCount = 5` (Green band: 4 RNs + 1 CNA) and `requiresChargeNurse = true`. Verifies full coverage, charge nurse assignment, no overlapping shifts, local-search preservation, and a named regression test for the v1.5.5 bug.

- **Runtime audit check in `runner.ts`**: after generating the Balanced schedule, calls `checkForUnexplainedUnderstaffing` and records `suspiciousUnderstaffingCount` and `suspiciousUnderstaffing` in the audit log's `newState`. A count of 0 means the scheduler is working correctly; a non-zero count flags a logic issue for investigation.

- **Tests run as part of `npm run build`**: `package.json` build script updated to `npm run test && npm run db:push && npm run db:seed && next build`. A failing test now blocks the build, preventing broken scheduler logic from shipping.

### Fixed

- **Seed FK delete order** (`src/db/seed.ts`): `open_shift.filledByAssignmentId` and `open_shift.originalStaffId` have no `ON DELETE CASCADE`. If a user used the Open Shifts feature before running a build, those rows blocked `DELETE FROM assignment`, causing `FOREIGN KEY constraint failed` in the seed. Added explicit `DELETE FROM open_shift`, `DELETE FROM generation_job`, and `DELETE FROM staff_holiday_assignment` in the correct order before their parent tables.

- **Stale `patient-ratio` tests** (`src/__tests__/rules/patient-ratio.test.ts`): two tests still expected the pre-v1.5.1 RN+LPN counting behaviour. Updated to reflect the current RN-only AACN standard: "flags when there are patients but no RNs assigned" (corrected message) and "does NOT count LPNs toward the RN ratio" (corrected assertion).

### Files Modified

- `src/lib/engine/scheduler/validate-output.ts` — new file
- `src/__tests__/integration/scheduler-output.test.ts` — new file
- `src/lib/engine/scheduler/runner.ts` — import and call `checkForUnexplainedUnderstaffing`; include in audit `newState`
- `package.json` — `build` script prepends `npm run test &&`
- `src/db/seed.ts` — FK-safe delete order with missing tables added
- `src/__tests__/rules/patient-ratio.test.ts` — stale test assertions corrected

---

## [1.5.5] - 2026-03-04

### Fixed

- **Auto-scheduler now fills shifts to the census-band-aware required count.**

  The scheduler was filling Day shifts to 4 and Night shifts to 3 even when the Green census tier
  (4 RNs + 1 CNA = 5 total) was applied. The root cause: `greedy.ts` and `repair.ts` both compute
  `required = shift.requiredStaffCount + shift.acuityExtraStaff`. When a `censusBandId` is set, the
  acuity API correctly zeroes `acuityExtraStaff` to prevent double-counting, but `requiredStaffCount`
  remained the shift definition's base count (4 for Day, 3 for Night) — not the census band total.

  Fix: `buildContext` in `rule-engine.ts` now adds a pass after loading census bands. For every shift
  that has a `censusBandId` set, it overrides `requiredStaffCount` with `band.requiredRNs + band.requiredCNAs`
  and clears `acuityExtraStaff` to 0. This keeps the fix entirely in one place and ensures the
  scheduler, repair phase, and rule engine all see a consistent, census-aware required count.

  The display API already computed this correctly via `getEffectiveRequired()`. The grid now shows
  the same required count that the scheduler targets (e.g. "5/5" when staffed for Green, "3/5" when
  understaffed), eliminating the false "4/4 — fully staffed" display that hid real violations.

### Files Modified

- `src/lib/engine/rule-engine.ts` — `buildContext` overrides `requiredStaffCount` from census band when `censusBandId` is set

---

## [1.5.4] - 2026-03-04

### Fixed

- **Excel import no longer destroys census tier colors.**

  Importing an Excel file deleted all census bands and recreated them without the `color` field, causing every band to fall back to the schema default `"green"`. This meant all tiers displayed as "Green — Normal" regardless of the actual tier and the census tier system stopped working after any import.

  Fixes applied:
  - `createDefaultCensusBands` (fallback when no Census Bands sheet is provided) now explicitly sets `color` for each of the four default bands: `blue`, `green`, `yellow`, `red`.
  - When a Census Bands sheet is present but rows have no Color column, colors are derived automatically by sorting each unit's bands by `minPatients` and assigning `blue → green → yellow → red` in order.
  - The export (`GET /api/import`) now includes a "Color" column in the Census Bands sheet so round-trip import/export preserves colors.
  - The Excel template now includes a Census Bands sheet with the Color column and four example rows.
  - The Excel parser (`parseCensusBandsSheet`) now reads the "Color" or "Tier" column and stores it in `CensusBandImport`.

- **Newly created schedules now start with Green tier on every shift.**

  Schedule creation (`POST /api/schedules`) built shift instances with `acuityLevel = null` and `censusBandId = null`. Because the `getEffectiveRequired` fallback Priority 2 requires `acuityLevel` to be non-null, all new shifts fell through to `baseRequired` regardless of census tier settings. The schedule API now looks up the Green census band for the unit and seeds every new shift with `acuityLevel = "green"` and `censusBandId` pointing to the Green band. This ensures the grid always shows census-aware required counts, and the manager only needs to change tiers that deviate from normal on the Census page.

### Files Modified

- `src/lib/import/parse-excel.ts` — `CensusBandImport` gains `color?` field; `parseCensusBandsSheet` reads Color/Tier column; `generateTemplate` adds Census Bands sheet
- `src/app/api/import/route.ts` — `createDefaultCensusBands` sets explicit colors; `importData` derives and persists color on census band insert; `exportCurrentData` includes Color column
- `src/lib/schedules/build-shifts.ts` — `ShiftInsertValues` gains `acuityLevel` and `censusBandId`; `buildShiftInserts` accepts and propagates default tier
- `src/app/api/schedules/route.ts` — looks up Green band for the unit and passes it to `buildShiftInserts`

---

## [1.5.3] - 2026-03-04

### Fixed

- **Schedule grid now correctly shows required count from census tier for all shifts.**

  Two bugs prevented the v1.5.2 `getEffectiveRequired` fix from working in practice:

  1. **Seed data had no `censusBandId`** — every shift created by `db:seed` had `censusBandId = null`. With no band ID stored, the lookup fell through to `actualCensus` (which matched the Green band, not the actual acuity set on the shift), causing the grid to show the wrong required count.

  2. **No `acuityLevel + unit` fallback** — even when a user saves a census tier through the Census page (which correctly writes `censusBandId`), a subsequent `npm run build` re-seeds the database with new UUIDs for census bands, making the stored `censusBandId` stale and the lookup would silently fail.

  The schedule grid now uses a three-priority lookup in `getEffectiveRequired`:
  - **Priority 1:** Direct `censusBandId` ID lookup (correct under normal conditions)
  - **Priority 2:** `acuityLevel + unit` color match — e.g. "yellow" + "ICU" → finds the Yellow ICU band regardless of UUID stability. Handles stale IDs and seeded shifts.
  - **Priority 3:** `actualCensus` numeric range lookup (legacy path — keeps `Math.max` so base is floor)

  Blue and Yellow tier selections no longer apply `Math.max` against the base required count, so Blue can legitimately reduce staffing below the shift definition default (low census = send staff home).

### Files Modified

- `src/db/seed.ts` — build `bandIdByColor` map after creating census bands; seeded shifts now include `censusBandId`
- `src/app/api/schedules/[id]/route.ts` — add `defUnit` to shifts query; `getEffectiveRequired` updated with `acuityLevel + unit` fallback

---

## [1.5.2] - 2026-03-03

### Fixed

- **Census page: unset shifts now default to Green tier on page load.**

  Shifts with no acuityLevel previously showed "Select tier…" in the dropdown, requiring the manager to explicitly select Green even when nothing had changed from the normal baseline. The page now pre-populates `pending` with Green for every unset shift as soon as both shifts and bands have loaded. The manager can still change the tier before saving; only the initial blank is filled in.

- **Band Thresholds tab: tier color labels and dots now display correctly.**

  The Tier column on both the Census page Band Thresholds tab and the Rules → Census Bands tab was showing the raw database band name ("Low Census", "Normal Census", etc.) and all dots appeared green. The column now derives the label from the tier color ("Blue — Low Census", "Green — Normal", "Yellow — Elevated", "Red — Critical") and the dot color correctly reflects the tier (blue, green, yellow, red).

- **Schedule grid now reflects census tier staffing requirement.**

  Selecting a tier on the Census page writes `censusBandId` to the shift but leaves `actualCensus` as null. The `getEffectiveRequired()` helper in the schedule detail API previously only checked `actualCensus` for a band match, so it fell back to the shift definition's base count — making the shift appear fully staffed even when the selected tier required more people. The function now checks `censusBandId` first (direct tier lookup by ID, no `Math.max` so Blue low-census can correctly require fewer staff than the base), then falls back to `actualCensus` for the legacy numeric path.

### Files Modified

- `src/app/census/page.tsx` — Green-default useEffect; tier color labels in Band Thresholds tab
- `src/app/rules/page.tsx` — `CENSUS_TIER_LABEL` constant; tier color labels in Census Bands tab
- `src/app/api/schedules/[id]/route.ts` — `getEffectiveRequired` checks `censusBandId` first

---

## [1.5.1] - 2026-03-03

### Fixed

- **Patient-to-nurse ratio rule corrected to RN-only counting.**

  The rule previously counted both RNs and LPNs as "licensed staff" when evaluating the 2:1 ICU nurse:patient ratio. Per AACN standards and state law, the ICU ratio is specifically RN-to-patient: LPNs cannot perform IV push medications, patient admissions, or blood administration in ICU settings and cannot substitute for RNs in the clinical ratio. The rule now counts RNs only. LPNs assigned to a shift still count toward total headcount (min-staff rule) but no longer inflate the ratio denominator.

- **ICU census band staffing numbers corrected for strict 2:1 RN:patient ratio.**

  The previous Green band required 3 RNs for up to 8 patients (8 ÷ 3 = 2.67:1 — a ratio violation). All tier RN counts have been increased so that the `requiredRNs` value alone satisfies the 2:1 standard at the peak patient count for each tier:

  | Tier   | Patient Range | RNs (before) | RNs (after) | Ratio at peak |
  |--------|---------------|--------------|-------------|---------------|
  | Blue   | 1 – 4 pts     | 2            | 2           | 4 ÷ 2 = 2:1 ✓ |
  | Green  | 5 – 8 pts     | 3            | **4**       | 8 ÷ 4 = 2:1 ✓ |
  | Yellow | 9 – 10 pts    | 4            | **5**       | 10 ÷ 5 = 2:1 ✓ |
  | Red    | 11 – 12 pts   | 5            | **6**       | 12 ÷ 6 = 2:1 ✓ |

  `requiredLPNs` set to 0 for all ICU bands — ICU scope-of-practice does not include LPN staffing targets.

### Added

- **Census Bands are now inline-editable on the Rules page.**

  The Rules → Census Bands tab previously showed a read-only table. Each row now has an **Edit** button that switches the row to inline inputs for `minPatients`, `maxPatients`, `requiredRNs`, `requiredLPNs`, `requiredCNAs`, `requiredChargeNurses`, and `patientToNurseRatio`. Saving calls the existing `PUT /api/census-bands` endpoint and refreshes the row without a page reload. Only one row is editable at a time.

### Changed

- **"Charge Nurses" column now labeled "(in RN count)"** on both the Rules → Census Bands tab and the Census page Band Thresholds tab. The charge nurse is one of the RNs — not a separate additional person — and the previous column header was misleading.

### Files Modified

- `src/lib/engine/rules/patient-ratio.ts` — RN-only ratio counting; updated rule name and comments
- `src/db/seed.ts` — corrected ICU census band RN counts; `requiredLPNs` = 0; updated rule description
- `src/app/rules/page.tsx` — inline editing for Census Bands rows; `requiredLPNs` column; Charge note
- `src/app/census/page.tsx` — Charge Nurses column clarification note
- `RULES_SPECIFICATION.md` — §3.3 updated; document version bumped to 1.5.1

---

## [1.5.0] - 2026-03-03

### Added

- **Daily Census Management page (`/census`) with a 4-tier Blue / Green / Yellow / Red color system.**

  Patient census was previously entered as a raw number inside the individual shift assignment dialog, forcing the nurse manager to open each shift separately. This has been replaced with a dedicated Census page accessible from the sidebar.

  **Tab 1 — Daily Census:** The manager selects a date (with prev/next navigation), sees all shifts for that day, and picks a census tier from a color-coded dropdown. Saving writes both `acuityLevel` and `censusBandId` to every affected shift in a single batch — one page, one save, all shifts for the day.

  **Tab 2 — Band Thresholds:** A read-only reference table showing the patient ranges and staffing requirements for each census tier per unit. Links to Rules → Census Bands for editing.

- **4 census tiers unified with the census band configuration.**

  The four existing census bands (Low, Normal, High, Critical) now each carry a `color` field (`blue`, `green`, `yellow`, `red`). This links the operationally meaningful color tier to the staffing-requirements record in a single lookup, eliminating the two-step count → band → staffing chain.

  | Tier   | Meaning                | Triggers                        |
  |--------|------------------------|---------------------------------|
  | 🔵 Blue  | Low occupancy          | Low census protocol (send home) |
  | 🟢 Green | Normal census          | Standard staffing               |
  | 🟡 Yellow| Elevated census        | Call in extra staff             |
  | 🔴 Red   | Critical census        | All hands on deck               |

- **Rules → Census Bands tab now shows color dots** next to each band name (🔵🟢🟡🔴) for quick visual identification.

- **New API endpoint `GET /api/census?date=YYYY-MM-DD`** returns all shifts for a given date joined with their shift definition (name, type, unit, start/end time, current tier).

### Changed

- **Assignment dialog: patient census input removed; replaced with a read-only census tier badge.**

  The per-shift number input ("Enter patient count" / Update button) has been removed. When a census tier has been set on the Census page, the assignment dialog now shows a small color-coded badge (e.g., "🟡 Elevated") with a link to the Census page. If no tier is set the badge is omitted.

- **Rule engine: `min-staff` now uses `censusBandId` directly when set.**

  Previously the minimum-staffing rule looked up the census band by matching `actualCensus` against patient-count ranges. When a tier is selected from the Census page, `censusBandId` is set on the shift. The rule now prefers a direct ID lookup, which is faster and avoids edge-case mismatches at band boundaries. The legacy count-range lookup is retained as a fallback for shifts that only have `actualCensus` set.

- **Acuity extra-staff modifier zeroed when `censusBandId` is set.**

  Each census band's staffing spec is now absolute (requiredRNs + requiredCNAs define the total). Setting `censusBandId` clears `acuityExtraStaff` to 0 in the `POST /api/shifts/[id]/acuity` handler to prevent double-counting with the unit-level `acuityYellowExtraStaff` / `acuityRedExtraStaff` modifiers.

### Files Modified

- `src/db/schema.ts` — `color` column added to `censusBand` table; `shift.acuityLevel` enum extended to include `"blue"`
- `src/db/seed.ts` — census band inserts now include `color` field
- `src/app/api/census/route.ts` — **NEW** — `GET /api/census?date=` endpoint
- `src/app/api/census-bands/route.ts` — `color` included in POST and PUT body handling
- `src/app/api/shifts/[id]/acuity/route.ts` — accepts `censusBandId`; zeroes `acuityExtraStaff` when band is set
- `src/app/census/page.tsx` — **NEW** — Daily Census page (2 tabs)
- `src/components/layout/sidebar.tsx` — Census nav item added (Activity icon)
- `src/components/schedule/assignment-dialog.tsx` — census input removed; read-only tier badge added; `onCensusChange` prop removed
- `src/components/schedule/schedule-grid.tsx` — `acuityLevel` added to `ShiftData` interface
- `src/components/schedule/shift-violations-modal.tsx` — `acuityLevel` added to `ShiftData` interface
- `src/app/schedule/[id]/page.tsx` — `acuityLevel` added to `ShiftData`; `handleCensusChange` and `onCensusChange` prop removed
- `src/lib/engine/rules/types.ts` — `censusBandId` added to `ShiftInfo`
- `src/lib/engine/rule-engine.ts` — `censusBandId` passed when building `ShiftInfo`
- `src/lib/engine/rules/min-staff.ts` — direct `censusBandId` lookup takes priority over count-range fallback
- `src/app/rules/page.tsx` — color dot badge added to Census Bands tab

---

## [1.4.35] - 2026-03-02

### Fixed

- **Coverage Requests dialog: "Charge nurse qualified" no longer appears twice for qualified candidates.**

  The text was being added to `reasons[]` in `find-candidates.ts` (all three tier builders) *and* again as a hardcoded JSX bullet in `open-shifts/page.tsx`. The redundant JSX block has been removed; `reasons[]` is the single source of truth.

- **Coverage Requests dialog is now scrollable.**

  The `DialogContent` was missing `max-h-[85vh] overflow-y-auto`, so dialogs with many candidates or a tall charge nurse warning banner could overflow off screen with no way to scroll. The dialog now behaves identically to the Callouts replacement dialog.

- **"PRN Import Template" no longer appears in the Schedule Builder.**

  The archived anchor schedule (ID `00000000-0000-0000-0000-000000000001`) used as a foreign-key target for `prn_availability` records was being returned by `GET /api/schedules` alongside real schedule periods. The GET handler now filters out any schedule with `status = 'archived'`, so the synthetic anchor row is hidden from the UI without deleting the DB record (which would break PRN availability data).

### Files Modified

- `src/app/open-shifts/page.tsx` — removed duplicate "Charge nurse qualified" JSX bullet; added `max-h-[85vh] overflow-y-auto` to `DialogContent`
- `src/app/api/schedules/route.ts` — GET query now excludes `status = 'archived'` rows

---

## [1.4.34] - 2026-02-28

### Added

- **Candidate recommendations now show a Pros / Cons breakdown on both the Callouts and Coverage Requests pages.**

  Previously all candidate information was presented as a flat bullet list with no distinction between strengths and trade-offs. Critical risks were buried — most importantly, if the original nurse held the charge role, a non-qualified replacement could be approved without any visible warning.

  **Pros (green ✓):** float/PRN source, competency match, reliability signals, charge-qualified confirmation (when the original was charge).

  **Cons (amber/red ✗):** overtime cost (`isOvertime`), weekend burden (≥ 3 weekends already worked this period), consecutive-day fatigue (≥ 4 consecutive days before the shift), and — in red — "Not charge nurse qualified — hard rule violation" when the original was charge but this candidate is not.

  **Charge nurse warning banner:** a prominent banner appears at the top of the dialog when the original nurse held the charge role and no recommended candidate is charge-qualified.

- **Two new scheduling signals computed for every candidate:** `weekendsThisPeriod` (count of weekends worked in the current schedule period) and `consecutiveDaysBeforeShift` (count of consecutive working days immediately before the target shift). These are computed from live DB data each time escalation options are requested, so they reflect the most current schedule state.

- **Coverage requests API now exposes `originalWasChargeNurse`** via a left join on the original assignment record, enabling the Coverage Requests page to show the charge nurse warning banner.

### Files Modified

- `src/lib/callout/escalation.ts` — `weekendsThisPeriod` and `consecutiveDaysBeforeShift` added to `ReplacementCandidate` interface and computed via two new helper functions; overtime text removed from `reasons` array (now surfaced as a con in the UI)
- `src/lib/coverage/find-candidates.ts` — `isChargeNurseQualified`, `weekendsThisPeriod`, and `consecutiveDaysBeforeShift` added to `CandidateRecommendation` interface and populated for all tiers (float, PRN, overtime, agency); overtime text removed from reasons in the overtime tier
- `src/app/api/open-shifts/route.ts` — GET handler adds `originalWasChargeNurse` via `aliasedTable` left join on `assignment`
- `src/app/callouts/page.tsx` — interface updated; charge nurse banner improved; candidate card restructured with Pros / Cons sections
- `src/app/open-shifts/page.tsx` — interfaces updated; charge nurse warning banner added; candidate card restructured with Pros / Cons sections

---

## [1.4.33] - 2026-02-28

### Fixed

- **Audit trail text no longer overlaps columns.**

  The description column previously used an invalid Tailwind class (`wrap-break-word`) and the table had no `table-fixed` layout, so column widths were ignored by the browser and long descriptions pushed into adjacent columns. The table is now rendered with `table-layout: fixed` and the description cell overrides the Radix `TableCell` default `whitespace-nowrap` with `whitespace-normal`, so text wraps within the allocated column width.

- **Audit entries now appear in correct chronological order.**

  Audit writes that went directly to `db.insert(exceptionLog)` (leave approval, callout creation from leave, open shift fill/cancel) were omitting `createdAt`, letting SQLite default to `datetime('now')` which produces a space-separated UTC string (e.g. `2026-02-28 10:04:06`). Entries written through `logAuditEvent` used `new Date().toISOString()` which produces a T-separated string (e.g. `2026-02-28T10:04:06.000Z`). Because space (ASCII 32) sorts before T (ASCII 84), all T-format entries appeared above all space-format entries regardless of actual wall-clock time. All direct `db.insert(exceptionLog)` calls now explicitly pass `createdAt: new Date().toISOString()`, and `logAuditEvent` in `logger.ts` also sets `createdAt` explicitly.

- **Leave approval callout audit logged with correct entity ID and staff name.**

  When a leave approval triggered an urgent callout (shift within the callout threshold), the callout insert used `.run()` which discards the returned row, so the audit entry used `a.assignmentId` as the entity ID instead of the new callout's own ID. The description also embedded the raw staff UUID instead of the staff's full name. The insert is now `.returning().get()` so `newCallout.id` is captured and used as `entityId`, and `staffName` is resolved before the function is called and passed through to the description string.

- **Schedule generation progress tracker replaced static label with animated step indicator.**

  The progress overlay during schedule generation previously showed a static line "Running 3 variants in parallel (Balanced, Fairness-Optimized, Cost-Optimized)…". This has been replaced with a three-column step tracker that highlights the currently active variant (Balanced / Fairness / Cost) in real time based on the job's reported progress percentage, and marks completed steps with a check mark.

### Files Modified

- `src/app/audit/page.tsx` — `table-fixed w-full` on table, `whitespace-normal` on description cell, `ExpandableText` component removed, time cell split to date + time lines
- `src/lib/audit/logger.ts` — explicit `createdAt: new Date().toISOString()` on all inserts
- `src/app/api/staff-leave/[id]/route.ts` — callout insert changed to `.returning().get()`, `newCallout.id` as audit entityId, `staffName` passed to `handleLeaveApproval`, `createdAt` added to all direct audit inserts
- `src/app/api/open-shifts/[id]/route.ts` — `createdAt: new Date().toISOString()` added to all four direct audit inserts (agency fill, approve fill, legacy fill, cancel)
- `src/app/scenarios/page.tsx` — animated 3-step tracker replacing static progress label

---

## [1.4.32] - 2026-02-28

### Fixed

- **Railway production build no longer fails on the scenarios page.**

  Next.js 15+ requires components that call `useSearchParams()` to be wrapped in a `<Suspense>` boundary, or the build fails with a static generation error. The scenarios page was calling `useSearchParams` at the top level of a client component without a boundary. The page is now split into a thin `ScenariosPage` shell (the default export) that wraps `ScenariosPageContent` in `<Suspense>`, which satisfies the Next.js build requirement.

### Files Modified

- `src/app/scenarios/page.tsx` — `ScenariosPageContent` extracted and wrapped in `<Suspense>` inside the default export

---

## [1.4.31] - 2026-02-26

### Fixed

- **Callout fill no longer silently drops audit entries when the replacement is already assigned to the shift.**

  The `PUT /api/callouts/[id]` handler inserts a replacement assignment after marking the callout filled. If the replacement staff already had an assignment on that shift (e.g. a double-submit or an edge case where they appear in both the schedule and the escalation list), the `UNIQUE(shiftId, staffId)` constraint on the assignment table caused an uncaught exception. Because `better-sqlite3` auto-commits each statement, the `callout.status = "filled"` update was already persisted when the error occurred, and both subsequent `logAuditEvent` calls (`manual_assignment` and `callout_filled`) were never reached. The assignment insert is now wrapped in a try-catch; a UNIQUE constraint failure skips the duplicate insert but execution always falls through to write the `callout_filled` audit event.

- **Callout fill UI no longer silently ignores a server error response.**

  `handleFillCallout` previously had no check on the fetch response status. If the PUT returned a non-2xx response for any reason, the escalation dialog would close as if successful while nothing was written to the DB or audit trail. The function now checks `res.ok` and shows an alert with the server error message so the manager knows the fill did not complete.

- **Audit Trail page now has a Refresh button.**

  The audit trail page only re-fetched log data when a filter value changed. If the user kept the page open in a tab and performed callout or leave actions elsewhere, the page would display stale data with no way to reload short of changing a filter or navigating away and back. A "Refresh" button has been added next to Export CSV to trigger an immediate re-fetch without changing any filter.

### Files Modified

- `src/app/api/callouts/[id]/route.ts` — try-catch around assignment insert; `callout_filled` audit always written
- `src/app/callouts/page.tsx` — `res.ok` check in `handleFillCallout`; alert on error
- `src/app/audit/page.tsx` — Refresh button added to page header

---

## [1.4.30] - 2026-02-26

### Changed

- **Callout Management — replacement name, shift context, and detail view.**

  The callout history table previously showed only "Filled" where the replacement nurse's name should appear, because the GET API never joined the staff table a second time for the replacement record. The API now joins `staff` twice (aliased), and also joins `shift` + `shiftDefinition` to surface the shift date and shift type. The history table now shows the replacement nurse's full name, the shift date and type, and the callout reason detail inline. A "View" button opens a detail dialog for resolved callouts showing: shift, reason, called-out timestamp, replacement, source, resolved timestamp, and any escalation steps taken.

- **Callout and leave audit log descriptions now use staff names instead of UUIDs.**

  Callout POST and PUT audit entries previously embedded raw UUIDs (`Callout logged for staff <uuid>`). Both routes now look up the staff name before writing to the exception log, producing readable entries (`Callout logged for Maria Garcia (sick)`, `Callout filled — John Smith assigned via overtime`).

- **Leave Management — denial reason required, detail view, day count, submitted date.**

  Denying a leave request now opens a dedicated dialog requiring a written denial reason before the denial can be confirmed. The API enforces this server-side (HTTP 400 if `denialReason` is absent on a `denied` status change). The leave list no longer truncates notes; all requests now have a "View" button that opens a detail dialog showing: staff, leave type, date range with day count, status, submitted timestamp, and (depending on status) either the approval timestamp/approver or the denial reason. Duration in calendar days is now shown inline on the list.

- **Leave audit trail now includes `leave_requested` events.**

  The POST `/api/staff-leave` route previously wrote no audit entry when a leave request was created. It now logs a `leave_requested` event with the staff name, leave type, and date range. The `leave_approved` and `leave_denied` entries previously embedded staff UUIDs in the description; these now use the staff name and include the denial reason when applicable.

- **Audit Trail — text overflow fixed, new filters, CSV export.**

  Long UUID strings in description cells caused text to overlap adjacent columns. The description cell now uses `wrap-break-word`. Added entity filters for Leave and Swaps (previously absent from the dropdown). Added a date range filter (`from` / `to`) backed by API support (`gte`/`lte` on `createdAt`). Added an Export CSV button that downloads the current filtered view. Action label map extended to cover `leave_requested`, `leave_approved`, `leave_denied`, `schedule_auto_generated`, `open_shift_created`, `open_shift_filled`, and swap variants.

### Files Modified

- `src/app/api/callouts/route.ts` — alias join for replacement staff, shift/shiftDefinition join, readable audit descriptions
- `src/app/api/callouts/[id]/route.ts` — readable audit descriptions using staff names
- `src/app/api/staff-leave/route.ts` — return `submittedAt`, `approvedAt`, `approvedBy`, `denialReason`, `reason`; add `leave_requested` audit event
- `src/app/api/staff-leave/[id]/route.ts` — require `denialReason` on denial (400 if absent), readable audit descriptions with staff name and denial reason
- `src/app/api/audit/route.ts` — `from`/`to` date range filter params; limit raised to 200
- `src/app/callouts/page.tsx` — replacement name column, shift column, reason detail, detail dialog
- `src/app/audit/page.tsx` — overflow fix, Leave/Swap entity filters, date range UI, CSV export, extended action labels
- `src/app/leave/page.tsx` — day count, submitted date column, required denial reason dialog, detail dialog, View button for all statuses

---

## [1.4.29] - 2026-02-26

### Changed

- **Local search upgraded from hill climbing to Late Acceptance metaheuristic.**

  The previous local search accepted a swap only when it strictly reduced the total penalty (steepest-descent hill climbing). Hill climbing gets permanently stuck once no immediate improvement exists, even if a short sequence of neutral or slightly-worse moves would lead to a much better solution. Replaced with Late Acceptance (Burke &amp; Bykov, 2012): a move is accepted if it scores no worse than the solution 200 iterations ago. This lets the search cross shallow local optima and score plateaus while remaining deterministic and parameter-free (no cooling schedule to tune). The best solution seen during the run is tracked separately and returned.

- **Local search is now reproducible via a seed.**

  The local search previously called `Math.random()` directly. Replaced with a seeded `mulberry32` PRNG. `runner.ts` generates one base seed per generation job, derives three independent variant seeds from it, and records both in the audit log (`exception_log.newState`). `generateSchedule` falls back to a time-based seed when called without one, so the API is backwards compatible.

### Files Modified

- `src/lib/engine/scheduler/local-search.ts` — `mulberry32` PRNG, Late Acceptance, seed parameter, bestAssignments tracking
- `src/lib/engine/scheduler/index.ts` — `generateSchedule` accepts optional seed, passes to `localSearch`
- `src/lib/engine/scheduler/runner.ts` — generates baseSeed + 3 variant seeds, records in audit log

---

## [1.4.28] - 2026-02-26

### Fixed

- **Coverage candidate finder: three bugs corrected in `find-candidates.ts`.**

  1. **Rest-hours formula (primary fix — was excluding available staff).** The D-1 rest calculation used `newStartHour − prevEndHour`, which treats both ends as being on the same calendar day. A nurse finishing a day shift at 19:00 on D-1 has 24 hours of rest before a shift starting 19:00 on D, but the formula computed 0 hours and silently excluded them. The correct formula spans midnight: `24h − prevEnd + newStart` for a regular D-1 shift, `newStart − prevEnd` for an overnight D-1 shift (which ends early on D). Also added a D+1 check that was entirely missing: if the candidate has a shift on the day after the new shift, the code now verifies they have ≥10 hours rest after finishing it.

  2. **Role rank check (was surfacing CNAs for RN vacancies).** The three tier functions (float, PRN, regular) had no role compatibility check. A CNA could appear as a recommended candidate for an RN vacancy because the only filter was unit qualification. Added `ROLE_RANK` and `buildVacancyContext` which looks up the original staff member's role; candidates whose role rank is below the vacancy rank are skipped entirely.

  3. **Scoring imbalance (was suppressing better-qualified regular staff).** Flat base scores of 100/80/60 for float/PRN/regular gave PRN a structural +20 advantage that no amount of competency difference could overcome — a Level 2 PRN CNA outranked a Level 4 regular RN. Replaced with competency-relative scoring: `effectiveLevel × 10 + source bonus (30/20/10)`, matching the correct scoring in `escalation.ts`. A non-overtime regular nurse at the same competency level as a PRN nurse now scores identically (overtime source bonus 10 + non-OT bonus 10 = 20 = PRN source bonus 20). Charge nurse awareness added: if the original assignment carried the charge role, candidates who are charge-nurse-qualified receive a +15 bonus, surfacing Level 4+ staff appropriately.

- **Schema: `open_swap_approved` added to `exceptionLog.action` enum.**

  The v1.4.27 open-swap approval path inserted an audit log with action `"open_swap_approved"`, but that value was not in the schema enum, causing a TypeScript error. Added to the allowed values.

- **Schema: `"evening"` added to `staffPreferences.preferredShift` enum.**

  The seed data has used `"evening"` as a shift preference since v1.2.0 but the schema enum only included `"day"`, `"night"`, and `"any"`, causing a long-standing TypeScript error.

### Files Modified

- `src/lib/coverage/find-candidates.ts` — rest-hours formula fix, D+1 check, role rank guard, competency-relative scoring, charge nurse awareness
- `src/db/schema.ts` — `open_swap_approved` action value, `"evening"` preference value

---

## [1.4.27] - 2026-02-25

### Fixed

- **Swap approval now validates hard scheduling rules before performing the swap.**

  Approving a directed swap previously swapped the two staff members' assignment IDs without any eligibility check. This allowed swaps such as a Level 3 nurse taking a charge nurse slot (which requires Level 4+), or a Level 2 nurse being placed on a shift with no Level 4+ supervisor remaining. The `PUT /api/swap-requests/[id]` route now runs five hard-rule checks before performing the swap:

  1. **ICU competency** — both incoming staff members must be Level 2 or above.
  2. **Charge nurse** — if the assignment carries the charge nurse role (`isChargeNurse: true`), the incoming staff must be Level 4 or above.
  3. **Level 2 supervision** — if the incoming staff is Level 2, a Level 4+ coworker must remain on the shift after the swap.
  4. **Approved leave conflict** — staff cannot take a shift on a date covered by approved leave.
  5. **Same-date overlap** — staff cannot take a shift that overlaps with another assignment they already hold on the same date.
  6. **Rest hours** — staff must have at least 10 hours rest between this shift and any adjacent assignment on the day before or day after.

  If any violation is found, the route returns `422 Unprocessable Entity` with a `violations` array and the swap is NOT performed. The swaps page shows a dialog listing each violation with the rule name and description.

- **Approving an open swap request now creates a coverage request.**

  Previously, approving an open swap request (no target staff selected) set the swap status to `approved` but took no further action — the requesting staff member was still scheduled, and no coverage was sought. The approve flow now sets the requesting assignment to `swapped` and creates an `open_shift` coverage record so it appears on the Coverage Requests page for the manager to find a replacement.

### Files Modified

- `src/lib/swap/validate-swap.ts` — **new** pure validation library; exports `validateSwapSide`, `validateSwap`, `shiftsOverlap`, `computeRestGapMins`
- `src/app/api/swap-requests/[id]/route.ts` — validation before directed swap; open swap creates coverage request
- `src/app/swaps/page.tsx` — violation dialog shown when API returns 422
- `src/__tests__/swap/validate-swap.test.ts` — **new** 20-test suite covering all validation rules
- `docs/06-managing-requests.md` — added rest-hours check to the swap validation table

---

## [1.4.26] - 2026-02-25

### Added

- **Shift Swap Request creation UI.**

  The Shift Swap Requests page previously had no way to create a swap request — the page was read-only (approve/deny only). Added a "Log Swap Request" button that opens a dialog matching the style and two-step pattern of the callouts page:

  1. **Requesting staff** — select any staff member, then choose one of their upcoming assignments as the shift they want to swap away.
  2. **Target staff** (optional) — select a second staff member and their assignment for a directed swap, or leave blank to create an open swap request that any eligible staff can be matched to.
  3. **Notes** — optional free-text reason.

  On submit, the dialog calls `POST /api/swap-requests` (existing endpoint). The new request then appears in the table with `pending` status and the manager's usual Approve/Deny actions.

  The existing `PUT /api/swap-requests/[id]` approve flow atomically swaps `staffId` on both assignments — that logic was already in place; only the creation UI was missing.

- **`GET /api/assignments` endpoint.**

  New API endpoint used by the swap request dialog to populate assignment dropdowns. Accepts `?staffId=X` and returns that staff member's upcoming assignments (today onwards, excluding `called_out` and `cancelled`), joined with shift definition and schedule names so the dialog can display human-readable labels (e.g. "Mon, Mar 2 — Day Shift (07:00–19:00) ★ Charge").

- **`src/components/ui/textarea.tsx`** — new Radix-style Textarea component used by the notes field in the swap request dialog.

### Files Modified

- `src/app/swaps/page.tsx` — "Log Swap Request" button, dialog with staff/assignment selectors and notes field
- `src/app/api/assignments/route.ts` — new `GET /api/assignments?staffId=X` endpoint
- `src/components/ui/textarea.tsx` — new UI component

---

## [1.4.25] - 2026-02-25

### Fixed

- **Leave-conflict hard violation no longer fires for called-out nurses.**

  `buildContext` in `src/lib/engine/rule-engine.ts` fetched all assignments for the schedule without filtering by status. This caused `called_out` assignments to be included in the rule evaluation context, so rules like the staff-on-leave check would still fire for staff members who were removed from the shift via the callout or coverage-request workflow. Added `ne(assignment.status, "called_out")` and `ne(assignment.status, "cancelled")` filters to the DB query so the rule engine only evaluates assignments for staff who are actually working the shift.

- **Role-incompatible staff no longer appear as coverage candidates.**

  `getEscalationOptions` in `src/lib/callout/escalation.ts` was classifying role-incompatible candidates (e.g. a CNA for an RN vacancy) as `isEligible: false` and surfacing them in the "ineligible" section of the recommendations list. A CNA cannot perform RN duties under any circumstances, so their presence in any candidate list is misleading. Role rank below the called-out nurse's role now causes the candidate to be skipped entirely rather than flagged as ineligible.

- **Replacement assignment now inherits the charge nurse role from the called-out nurse.**

  `PUT /api/open-shifts/[id]` (approve and fill actions) and `PUT /api/callouts/[id]` all hardcoded `isChargeNurse: false` when creating the replacement assignment. Approving a replacement for a charge nurse vacancy therefore immediately introduced a "Charge Nurse Required" hard violation — and, in ICU shifts with Level 2 staff already present, a "Level 2 Supervision" violation as well. All three route handlers now look up the original assignment's `isChargeNurse` flag and inherit it for the replacement.

### Changed

- **Replacement candidate cards now show ICU competency level, role, and rest hours before the shift.**

  Both the Coverage Requests approval dialog (`src/app/open-shifts/page.tsx`) and the Callout replacement dialog (`src/app/callouts/page.tsx`) previously omitted clinically relevant details that managers need to make the right call:

  - **ICU competency level (Lv X/5)** and **role (RN/LPN/CNA)** — now displayed in the name row of each candidate card so qualifications are visible without navigating to the staff page.
  - **Rest hours before shift** — the hours between the candidate's last preceding shift and the shift being covered. Candidates with ≥24h since their last shift show "24h+". Candidates with a recent preceding shift (e.g., 12h rest after a night shift) show the exact hours. Values below 12h are highlighted in amber with a "short turnaround" label to flag potential fatigue.

  `CandidateRecommendation` in `src/lib/coverage/find-candidates.ts` and `ReplacementCandidate` in `src/lib/callout/escalation.ts` both gained a `restHoursBefore?: number` field. The D-1 rest check in both libraries already computed this value to enforce the ≥10h minimum — it is now also tracked and returned so the UI can display it.

### Files Modified

- `src/lib/engine/rule-engine.ts` — DB query now excludes `called_out` and `cancelled` assignments; added `ne` to drizzle import
- `src/lib/callout/escalation.ts` — role-incompatible staff skipped with `continue` instead of added as ineligible candidates; `restHoursBefore` computed and added to candidate data
- `src/lib/coverage/find-candidates.ts` — `role`, `icuCompetencyLevel`, `restHoursBefore` added to `CandidateRecommendation`; rest tracking added to `checkStaffAvailability`
- `src/app/open-shifts/page.tsx` — candidate cards show role badge, Lv X/5, rest hours
- `src/app/callouts/page.tsx` — candidate cards show rest hours before shift
- `src/app/api/open-shifts/[id]/route.ts` — approve and fill actions inherit `isChargeNurse` from original assignment
- `src/app/api/callouts/[id]/route.ts` — replacement assignment creation inherits `isChargeNurse` from original assignment

---

## [1.4.24] - 2026-02-25

### Fixed

- **Coverage recommendations no longer suggest staff with zero rest hours between same-day shifts.**

  `findCandidatesForShift` in `src/lib/coverage/find-candidates.ts` checked for overlapping shifts on the same date, but a Day shift (07:00–19:00) and a Night shift (19:00–07:00) on the same date share a boundary minute and do not technically overlap. The ≥10-hour rest check only looked at D-1 assignments (overnight shifts ending on the shift's date), so a staff member finishing a Day shift at 19:00 was incorrectly listed as available for the Night shift starting at 19:00. Added `sameDayShiftGapMinutes` helper and a post-overlap rest check that catches adjacent same-day shifts with insufficient gaps.

- **Original nurse now removed from schedule grid when a coverage request is filled.**

  `PUT /api/open-shifts/[id]` (both the `approve` and legacy `fill` actions) created the replacement assignment but never marked the original nurse's assignment as `called_out`. The schedule grid's existing filter already excludes `called_out` assignments; this fix ensures the `open-shifts` approval path sets that status the same way the callout path does.

### Changed

- **Scheduler now runs a targeted weekend-redistribution sweep after the OT sweep (Phase 5).**

  The Fairness Optimized variant was only marginally better than Balanced on fairness (74% vs 69%) despite having a 3× higher weekend equity weight. Root cause: the greedy processes shifts in constraint-difficulty order, not in "spread weekends evenly" order. By the time weekend slots are assigned, staff are already partially committed to constrained weekday ICU slots, leaving fewer degrees of freedom. The random local search rarely targets weekend-heavy staff specifically.

  **Phase 5 — `weekendRedistributionSweep`** — is inserted after the OT sweep. It deterministically iterates over weekend assignments held by staff with above-average weekend counts and tries swapping each with an assignment from a staff member with below-average weekend counts. Accepts the first swap that reduces total weighted penalty and restarts, converging when no improving swap exists. Uses each variant's own weights as the acceptance criterion:
  - **Fairness Optimized** aggressively redistributes (weekend equity weight 3.0)
  - **Balanced** accepts redistribution swaps only when they reduce overall penalty
  - **Cost Optimized** skips swaps that would increase overtime cost

### Files Modified

- `src/lib/coverage/find-candidates.ts` — added `sameDayShiftGapMinutes` helper; same-day adjacent-shift rest check added after overlap check
- `src/app/api/open-shifts/[id]/route.ts` — `approve` and `fill` actions now set original assignment to `called_out`; added `and` to drizzle import
- `src/lib/engine/scheduler/local-search.ts` — new exported `weekendRedistributionSweep` function
- `src/lib/engine/scheduler/index.ts` — imports `weekendRedistributionSweep`; Phase 5 call after OT sweep

---

## [1.4.21] - 2026-02-24

### Fixed

- **Called-out nurse now reliably removed from schedule grid when replacement is assigned.**

  `PUT /api/callouts/[id]` (the "Assign" action in the replacement dialog) creates the replacement assignment but previously did not guarantee that the original nurse's assignment was hidden from the grid. The `POST /api/callouts` route already sets `status = "called_out"` when the callout is first logged, but this defensive update in the PUT handler ensures the original assignment is hidden even in leave-based or manual workflows where the POST may not have been called. The schedule grid already filters out `called_out` assignments; this fix closes the gap where the filter had nothing to act on.

### Changed

- **Log Callout dialog: staff name filter replaces flat assignment dropdown.**

  The "Assignment" dropdown previously listed every staff–shift combination across the full schedule period in a single list (98+ entries for a 2-week ICU schedule), making it very difficult to find a specific person's shift. The dialog now has two sequential steps: first select the staff member from an alphabetically sorted list, then select the specific shift from that person's assignments only. The shift dropdown is hidden until a staff member is chosen.

- **Open callouts now have a "Find Replacement" button in the callout history table.**

  Previously, replacement candidates were shown only in the dialog immediately after logging a new callout. Closing that dialog (e.g. to navigate to the schedule grid and check for rest-hour conflicts) made the candidates permanently inaccessible — there was no way to reopen them. Each open callout row now has a "Find Replacement" button that fetches fresh escalation options and reopens the replacement candidates dialog.

  `GET /api/callouts/[id]` was extended to return `escalationOptions` and `chargeNurseRequired` alongside the callout record, enabling this re-fetch without a new POST.

### Files Modified

- `src/app/api/callouts/[id]/route.ts` — GET now returns `escalationOptions` + `chargeNurseRequired`; PUT ensures original assignment status is set to `called_out`
- `src/app/callouts/page.tsx` — staff filter + shift dropdown in Log dialog; "Find Replacement" button on open rows; `findReplacementForCallout` helper; state reset on dialog close

---

## [1.4.20] - 2026-02-24

### Changed

- **Cost Optimized greedy phase now uses Balanced weights to eliminate structural overtime.**

  After v1.4.19's targeted OT sweep reduced overtime for all variants, Cost Optimized (5 OT) was still producing more overtime than Balanced (3 OT) on the same schedule. The residual gap came from the greedy construction phase: a high OT penalty weight (3.0) caused the greedy to deplete low-hour staff on early, high-priority shifts, leaving high-hour staff for later slots and creating structural overtime patterns that 2-way swaps could not fully resolve post-hoc.

  `generateSchedule` now accepts an optional `greedyWeights` parameter separate from the improvement-phase `weights`. When running Cost Optimized, `BALANCED` is passed as `greedyWeights`: the greedy builds a well-distributed, capacity-aware initial schedule (its actual job), and the variant's cost personality — OT weight 3.0, preference 0.5, agency 5.0 — is then applied fully in local search and the OT sweep, where it can make effective targeted improvements from a better starting point.

  Balanced and Fairness Optimized variants are unaffected; they continue to use their own weights throughout all phases.

### Files Modified

- `src/lib/engine/scheduler/index.ts` — `generateSchedule` gains optional 4th parameter `greedyWeights?: WeightProfile`; greedy phase uses `greedyWeights ?? weights`
- `src/lib/engine/scheduler/runner.ts` — Cost Optimized call passes `BALANCED` as `greedyWeights`

---

## [1.4.19] - 2026-02-24

### Changed

- **Scheduler now runs a targeted OT-reduction sweep after local search (Phase 4).**

  The Cost Optimized variant was paradoxically producing more overtime violations than the Balanced variant (9 OT vs 6 OT in testing). Root cause: the greedy algorithm processes shifts in constraint-difficulty order (most constrained first), not calendar order. A higher overtime penalty weight (3.0) causes the greedy to deplete low-hour staff on early, constrained shifts, leaving high-hour staff to fill later slots and pushing them into overtime. The subsequent random local search (1000 iterations) had only a ~9% chance per iteration of even targeting an OT assignment, making it unlikely to find and correct these cascading decisions.

  **Phase 4 — `overtimeReductionSweep`** — is now inserted after the existing `recomputeOvertimeFlags` pass. It deterministically iterates over every assignment flagged as overtime, tries swapping it with every other assignment on a different shift, and accepts the first swap that reduces total weighted penalty. This exhausts the 2-assignment-swap neighbourhood for OT assignments (e.g. 9 OT × 89 non-OT = 801 combinations per pass) rather than sampling randomly, and repeats until convergence.

  The sweep uses each variant's own penalty weights as the acceptance criterion, so:
  - **Cost Optimized** aggressively accepts OT-reducing swaps (OT weight 3.0 makes each elimination worth ~2× the Balanced equivalent)
  - **Balanced** accepts swaps only where the OT reduction outweighs any soft-rule cost (OT and preference weights are equal at 1.5)
  - **Fairness Optimized** rarely accepts OT swaps because the weekend equity penalty (3.0) typically overrides the OT gain (0.5) — which is the intended behaviour

  Additionally, Cost Optimized random local search iterations were increased from 1000 to 2000 to give the random phase more chance to escape the greedy local optimum before the targeted sweep runs.

### Files Modified

- `src/lib/engine/scheduler/local-search.ts` — added exported `recomputeOvertimeFlags` (moved from `index.ts`) and new `overtimeReductionSweep` function; added `getWeekStart` to state import
- `src/lib/engine/scheduler/index.ts` — removed private `recomputeOvertimeFlags` definition; imports `recomputeOvertimeFlags` and `overtimeReductionSweep` from `./local-search`; Phase 4 call added to `generateSchedule`
- `src/lib/engine/scheduler/runner.ts` — Cost Optimized `localSearchIterations` 1000 → 2000

---

## [1.4.18] - 2026-02-24

### Changed

- **Callout escalation now returns top 3 scored recommendations with reasons.**

  The escalation dialog previously listed every eligible nurse in a flat list sorted only by employment tier (float first, agency last), with competency as a last-resort tiebreaker. A Level 3 float would outrank a Level 5 full-timer even when the called-out nurse was Level 5 — the opposite of what is clinically sensible.

  The function is now score-based, modelled after the coverage-request recommendation engine in `find-candidates.ts`:

  | Signal | Points |
  |---|---|
  | Source tier base (float 100 / PRN 80 / OT 60 / Agency 10) | base |
  | Available on the date | +50 |
  | Competency ≥ called-out nurse | +20 |
  | Absolute competency (per level) | +level × 4 |
  | Reliability rating | +rating × 3 |
  | Charge nurse qualified (when required) | +15 |
  | Extra shift within 40 h (no OT cost) | +10 |
  | Fewer hours scheduled this week | +(40−h) × 0.2 |

  A Level 5 full-timer with 12 h this week now outscores a Level 3 float when the called-out nurse was Level 5. Output is limited to **top 3 eligible** + up to 3 ineligible (shown for awareness).

- **Charge nurse vacancy triggers a hard eligibility requirement.**

  If the called-out nurse was the charge nurse (`assignment.isChargeNurse = true`), any candidate without `isChargeNurseQualified` is marked ineligible. An amber banner appears at the top of the dialog to alert the manager.

- **Each candidate shows human-readable recommendation reasons.**

  The dialog card for each candidate now includes a bullet list: source priority, competency match vs. the called-out nurse, charge qualification (when applicable), hours this week (with an orange OT badge when the shift would exceed 40 h), and reliability rating when ≥ 4/5.

### Files Modified

- `src/lib/callout/escalation.ts` — complete rewrite: score-based ranking; charge nurse hard gate; weekly hours batch query; `reasons`, `score`, `hoursThisWeek` fields on `ReplacementCandidate`; output limited to top 3 eligible + 3 ineligible
- `src/app/api/callouts/route.ts` — `chargeNurseRequired` computed from original assignment and included in POST response
- `src/app/callouts/page.tsx` — interface updated; `chargeNurseRequired` state; amber charge banner; per-candidate reason list; hours/OT badge; ineligible divider

---

## [1.4.17] - 2026-02-24

### Fixed

- **Callout escalation candidates now filtered by role compatibility.**

  Previously, `getEscalationOptions()` returned every active staff member regardless of role — CNAs appeared as replacement options for RN positions. The function now applies a role-rank hierarchy (`RN > LPN > CNA`): a candidate must have an equal or higher rank than the nurse who called out. A CNA cannot cover an RN slot; an LPN can cover a CNA slot; an RN can cover any slot.

- **Callout escalation now checks approved leave and adjacent-shift rest.**

  Two additional eligibility gates are now enforced before a candidate is offered as a replacement:
  1. **Approved leave** — any staff member with an approved leave record covering the shift date is ineligible.
  2. **Adjacent-shift rest** — the 10-hour rest rule is checked across date boundaries. If a nurse ended an overnight shift (D-1) within 10 hours of the new shift (D), or if the new shift would leave fewer than 10 hours before a next-day assignment (D+1), the candidate is marked ineligible.

  Ineligible candidates are still shown in the dialog (for manager awareness) but are visually distinguished with a red border, a reason label, and a disabled Assign button.

- **Escalation query rewritten to eliminate N+1 loop.**

  The original code fetched all assignments across the entire DB, then re-queried each shift individually inside `.filter()` to match the date — one DB round-trip per assignment. The rewrite issues a single JOIN query for dates D-1/D/D+1, groups results in memory, and performs all checks in one pass.

- **Schedule grid no longer shows called-out nurses.**

  When a nurse called out, their assignment was marked `called_out` but still rendered on the schedule grid because the API returned all assignments. The `GET /api/schedules/[id]` handler now skips assignments with `status = "called_out"` when grouping by shift.

- **Filling a callout now creates a replacement assignment on the grid.**

  The `PUT /api/callouts/[id]` handler only updated the callout record — it never created a new `assignment` row for the replacement nurse, so the schedule grid never updated. The handler now inserts a `callout_replacement` assignment with the correct `scheduleId`, `isFloat`, and `isOvertime` flags. Float determination is based on whether the replacement staff member's `homeUnit` differs from the schedule's unit.

### Files Modified

- `src/lib/callout/escalation.ts` — complete rewrite: role-rank check, leave check, adjacent-day rest check, efficient batch query; `isEligible` and `ineligibilityReasons` fields added to `ReplacementCandidate`
- `src/app/api/callouts/[id]/route.ts` — `assignment`, `shift`, `schedule`, `staff` imported; replacement assignment inserted in PUT handler
- `src/app/api/schedules/[id]/route.ts` — `called_out` assignments skipped when building `assignmentsByShift`
- `src/app/callouts/page.tsx` — `ReplacementCandidate` interface updated with `isEligible` and `ineligibilityReasons`; escalation dialog shows ineligibility reasons; Assign button disabled when ineligible

---

## [1.4.16] - 2026-02-23

### Added

- **Staff Leave tab in Excel export and template.**

  The Excel file downloaded from `/setup` now includes a "Staff Leave" sheet with every existing leave record (all 7 leave types: vacation, sick, maternity, medical, personal, bereavement, other). The blank template also includes this sheet with 7 example rows spanning March–June 2026 — one per leave type — so it is immediately clear what values are accepted.

  Imported leave rows are inserted into `staff_leave` and the scheduler will block those staff from being assigned during their leave period (same as leaves entered through the UI). Staff are matched by First Name + Last Name. If the name does not match an existing staff member the row is skipped silently.

  The "Staff Leave" sheet is fully backwards-compatible: older Excel files without this sheet import without error.

- **"Evening" shift preference removed from Excel and database.**

  The application only defines Day (07:00–19:00) and Night (19:00–07:00) shift templates. Staff who had `preferredShift = "evening"` set — either through an older Excel import or manual entry — would never have their preference matched, because no evening shift exists. This preference value is now removed everywhere.

  At first export after this update, any staff preferences currently set to "evening" in the database are migrated idempotently to alternating "day" / "night" values (sorted by staff ID, even indices → day, odd indices → night). The template and import parser no longer accept "evening" — incoming values fall through to the `"any"` default.

### Files Modified

- `src/db/schema.ts` — `"evening"` removed from the `preferredShift` enum in `staff_preferences`
- `src/lib/import/parse-excel.ts` — `"evening"` removed from `StaffImport.preferredShift` type and `VALID_PREFERRED_SHIFTS` constant; `LeaveImport` interface added; `leaves` field added to `ImportResult`; `parseLeaves()` function added; `parseExcelFile()` now parses the "Staff Leave" sheet; `generateTemplate()` now includes a "Staff Leave" sheet with 7 sample rows
- `src/app/api/import/route.ts` — `eq` imported from drizzle-orm; idempotent evening migration runs at the start of `exportCurrentData()`; "Staff Leave" sheet added to `exportCurrentData()`; leave records inserted in `importData()` (step 3c); `leaves` count included in validation preview and success response

---

## [1.4.15] - 2026-02-23

### Fixed

- **Scheduler no longer repeats the same weekend roster every period.**

  The greedy algorithm is fully deterministic — given identical inputs, it always picks the same nurse for a given slot. With no memory of prior schedules, every new schedule started with `weekendCount = 0` for all staff. The weekend scoring bonus/penalty only saw within-period history, so the same nurses (those with the highest reliability rating or competency level) always won the tie-break for weekend shifts period after period.

  The fix: at context-build time, `buildContext()` now queries all weekend assignments in the one prior schedule period (a `schedulePeriodWeeks`-week window before the new schedule's start date) and builds a `historicalWeekendCounts` map. This is passed through `SchedulerContext` to `softPenalty()`, which adds the historical count to the in-schedule count before evaluating the bonus/penalty:

  - A nurse who worked 3 weekends last period (at the required quota) enters the new period with an effective count of 3 = already at quota → penalised for additional weekends → scheduler prefers other nurses.
  - A nurse who was light on weekends last period enters below quota → gets the full assignment bonus → scheduler prefers them for weekend slots.
  - New hires and nurses with no historical record start at 0, same as the below-quota case.

  No new database table is required — the existing `assignment` table joined to `shift` has all the data needed. The lookback query runs once per context build and is fast (date-range filter on an indexed column).

### Files Modified

- `src/lib/engine/rules/types.ts` — `historicalWeekendCounts?: Map<string, number>` added to `RuleContext`
- `src/lib/engine/scheduler/types.ts` — same field added to `SchedulerContext`
- `src/lib/engine/rule-engine.ts` — `lt` added to drizzle-orm import; lookback query + map construction added to `buildContext()`; field included in return value
- `src/lib/engine/scheduler/index.ts` — `historicalWeekendCounts` passed through in `buildSchedulerContext()`
- `src/lib/engine/scheduler/scoring.ts` — 9th parameter `historicalWeekendCounts` (default `new Map()`) added to `softPenalty()`; effective weekend count = historical + current-schedule
- `src/lib/engine/scheduler/greedy.ts` — both `softPenalty` calls in `pickBest()` pass `context.historicalWeekendCounts ?? new Map()`
- `src/lib/engine/scheduler/local-search.ts` — `softPenalty` call in `computeTotalPenalty()` passes `context.historicalWeekendCounts ?? new Map()`

---

## [1.4.14] - 2026-02-23

### Changed

- **Overtime and extra-hours violations now display under separate rule names.** Previously both violation types were grouped under the label `"Overtime & Extra Hours"`, which caused two problems: managers could not distinguish a genuine payroll-cost event (>40h at 1.5×) from a scheduling preference issue (above FTE target but still at regular pay), and the violation count shown in the schedule's "By rule" summary conflated these two very different concerns.

  The two cases now emit distinct rule names:

  | Scenario | Rule Name | Why |
  |----------|-----------|-----|
  | Nurse's weekly hours exceed 40 | **"Overtime"** | Triggers FLSA 1.5× pay — a direct payroll cost increase. |
  | Nurse exceeds FTE target but stays ≤ 40h | **"Extra Hours Above FTE"** | Paid at regular rate — a scheduling preference concern, not a cost concern. |

  This change makes the violations panel actionable: an "Overtime" flag means a real cost issue that the Cost-Optimized variant actively penalises; an "Extra Hours Above FTE" flag means a part-time nurse was over-scheduled relative to their contracted hours, which is a fairness and workload concern worth reviewing but carries no payroll premium.

  The scenario scores (Cost %, Fairness %, etc.) are computed from `isOvertime` flags on assignments, not from rule violation counts, so they are unaffected by this rename.

### Files Modified

- `src/lib/engine/rules/overtime-v2.ts` — Case 1 violation `ruleName` changed from `"Overtime & Extra Hours"` → `"Overtime"`, `ruleId` unchanged (`"overtime-v2"`). Case 2 violation `ruleName` changed to `"Extra Hours Above FTE"`, `ruleId` changed to `"extra-hours"`. Description wording updated ("above contracted hours").
- `RULES_SPECIFICATION.md` — §4.1 rewritten to document the split; inline changelog updated to v1.4.14.

---

## [1.4.13] - 2026-02-23

### Fixed

- **OT badge now appears on all overtime shifts, not just the one that first crossed 40 hours.**

  Previously, the `isOvertime` flag on each assignment was set during greedy construction in the order shifts were processed — most-constrained first. Weekend shifts (Saturday, Sunday) are harder to fill and therefore processed *before* the weekday shifts in the same week. As a result, a nurse's Saturday and Sunday assignments were built when the state only showed their hours from earlier in the construction run, not their full calendar-week total. The weekday shift that was processed last (say, Thursday) accumulated the construction-order total and triggered `isOvertime: true`, while Saturday and Sunday remained `false` — even though they sit *after* Thursday on the calendar and are therefore also overtime hours.

  **Fix:** A `recomputeOvertimeFlags` post-processing pass now runs after all three phases (greedy + repair + local search) complete. It sorts every draft by date/startTime (calendar order), accumulates weekly hours per staff member, and re-marks `isOvertime = true` on every shift where the running total exceeds 40 hours — not just the construction-order trigger. The OT badge in the schedule grid and the assignment dialog now correctly appear on *all* overtime shifts in the week.

- **Manual assignments now also compute `isOvertime` correctly.** Previously, `handleAssign` in the schedule page did not pass `isOvertime` to the API, so every manually-created assignment was stored with `isOvertime: false` regardless of the nurse's actual weekly hours. The assignment creation API now computes `isOvertime` server-side: it sums the staff member's existing assignments in the same calendar week (via a join through `shiftDefinition` to get `durationHours`) and sets the flag accurately before inserting the new record.

### Files Modified

- `src/lib/engine/scheduler/index.ts` — `AssignmentDraft` and `getWeekStart` imported; `recomputeOvertimeFlags` helper added; called after `localSearch` in `generateSchedule`
- `src/app/api/schedules/[id]/assignments/route.ts` — `shiftDefinition`, `gte`, `lte`, `getWeekStart` imported; shift lookup moved to top of handler; `isOvertime` computed from weekly hours sum before insert; duplicate `shiftRecord` fetch removed

---

## [1.4.12] - 2026-02-23

### Changed

- **Assignment dialog now shows scheduling context for currently assigned staff.** Previously, the "Currently Assigned" section only displayed each nurse's name, role, Charge/OT badges, and competency level. It gave no indication of how many hours that nurse was already working that week or whether their preferences were being honoured. A manager who wanted to consider swapping someone out had to remember those details or navigate elsewhere.

  The dialog now shows a second detail line under each assigned nurse — identical in layout to the detail line already shown for available staff — including:
  - **Xh this week** — total hours in the same week as this shift, *including* this shift (since the nurse is already assigned). Shown in amber if this puts the nurse above their part-time FTE target.
  - **FTE target** — shown in parentheses for part-time staff only (e.g., `20h this week (20h FTE target)`).
  - **Preference mismatches** — amber labels for a preferred shift type conflict, a preferred day off, or weekend avoidance, exactly as shown for available staff.

  The `isOvertime` badge was already present and remains unchanged — it is the authoritative flag computed when the assignment was made.

  The context is loaded from the same `/api/shifts/[id]/eligible-staff` endpoint, which now also returns already-assigned staff (with `alreadyAssigned: true`) alongside the existing eligible/ineligible pool. The dialog separates them by flag — assigned staff enrich the "Currently Assigned" section; non-assigned staff populate "Available Staff" and "Unavailable" as before.

### Files Modified

- `src/app/api/shifts/[id]/eligible-staff/route.ts` — `StaffInfo` imported; `staffContext` helper extracted; `assignedResults` pass added (skips eligibility check, `alreadyAssigned: true`); both arrays combined in response; non-assigned results gain `alreadyAssigned: false`
- `src/components/schedule/assignment-dialog.tsx` — `alreadyAssigned` added to `StaffOption`; `assignedContext` state (Map) populated from fetch response; "Currently Assigned" rows expanded to `flex-col` layout with preference mismatch + FTE context detail line

---

## [1.4.10] - 2026-02-22

### Fixed

- **Local search no longer corrupts charge nurse assignments or Level 2 supervision.** This was the root cause of hard violations ("Charge Nurse Required", "Level 2 ICU/ER Supervision") surviving even after the repair phase had correctly fixed them.

  The local search improves a schedule by randomly swapping two staff members between different shifts. Two gaps in the swap validity check allowed the search to create new hard violations:

  **Gap 1 — Charge-slot inheritance:** When two assignments are swapped, the code uses `{...a, staffId: b.staffId}` to build the new slot. This spreads all of assignment `a`'s properties — including `isChargeNurse: true` — onto the incoming staff member, regardless of whether that person is actually charge-qualified. A Level 4+ charge nurse could be swapped out and a Level 3 nurse would inherit the `isChargeNurse = true` flag. The individual `passesHardRules` check does not catch this because it only verifies the incoming person's general eligibility for the shift (rest, hours, ICU competency ≥ 2), not whether they can serve as charge nurse. Result: a Level 3 nurse shows the "Charge" badge in the UI, but the charge-nurse hard rule correctly flags the shift as lacking a valid charge nurse.

  **Gap 2 — Level 2 supervision:** When a Level 4+ nurse is swapped out of an ICU/ER shift, any Level 2 nurses already on that shift lose their supervisor. The `passesHardRules` call only validates the incoming staff member's individual eligibility — it does not check whether Level 2 nurses already on the shift are now unsupervised after the Level 4+ departs.

  **Fixes added to `isSwapValid`:**
  1. Block any swap where a non-charge-qualified (or Level 1–3) staff member would inherit a `isChargeNurse = true` slot.
  2. After building the temporary state (both swap candidates removed), check each ICU/ER shift: if it still has Level 2 nurses after removing the outgoing staff, the incoming staff must be Level 4+ or the shift must retain another Level 4+ from its remaining roster. If neither is true, the swap is rejected.

### Files Modified

- `src/lib/engine/scheduler/local-search.ts` — `isICUUnit` imported; two collective constraint guards added to `isSwapValid` before individual `passesHardRules` calls

---

## [1.4.9] - 2026-02-22

### Fixed

- **Part-time nurses working extra hours are now always scheduled before full-time nurses go into overtime.** Previously, the scheduler relied purely on penalty weights to express this preference — an OT penalty of 1.5× could still be outweighed by competing soft penalties (float differential, skill mix, preference mismatch), causing the scheduler to pick a full-time nurse into actual overtime when a part-time nurse was available and eligible. The rule is now enforced as a hard separation in Pass 2 of greedy construction: all eligible candidates are split into a non-OT pool (weekly hours + this shift ≤ 40h) and an OT pool. The non-OT pool is used exclusively when it is non-empty; the full pool is only used as a fallback if every eligible candidate would cause overtime. This guarantees that a 0.5 FTE nurse working above their 20h/week target (extra hours, but no payroll OT cost) is always preferred over a full-time nurse who would cross 40h, regardless of float or preference penalties.

- **Extra-hours violations now appear on every shift above the FTE target, not just the first.** Previously, once a part-time nurse was flagged for going above their standard hours (e.g., 20h/week for a 0.5 FTE nurse), every subsequent shift in the same week showed nothing — even though each additional shift compounded the over-scheduling. The rule now flags every shift in the "above FTE, below 40h" zone. The penalty for each such shift uses only the **marginal** extra hours that shift contributes: if the nurse is already above FTE when this shift starts, the full shift duration is counted as extra; if this is the threshold-crossing shift, only the portion above the FTE target is counted. Actual OT (>40h) continues to be flagged once, on the shift that first crosses 40h.

### Files Modified

- `src/lib/engine/scheduler/greedy.ts` — Pass 2 eligible pool split into `allEligible` / `nonOTEligible`; non-OT candidates used first with OT fallback
- `src/lib/engine/rules/overtime-v2.ts` — removed `extraHoursFlagged` gate; added `prevCumulative` tracking; marginal extra-hours calculation per shift

---

## [1.4.8] - 2026-02-22

### Fixed

- **Hard violations are now automatically repaired after greedy construction.** Previously, if the greedy phase produced a schedule with a charge nurse violation or an understaffed ICU shift, the system left it unresolved and surfaced it to the manager for manual correction. The manager had to open the assignment dialog, find an eligible nurse, and assign them — a manual step that should not have been necessary when eligible staff existed somewhere in the schedule.

  A new **repair phase** runs after greedy construction and before local search. It scans the constructed schedule for hard violations (missing charge nurse, missing Level 4+ ICU supervisor, minimum staffing shortfall) and attempts to fix each one using two strategies:

  **Strategy A — Direct assignment:** If any eligible staff member is not yet on the violated shift, they are assigned immediately. This handles cases where the greedy's charge-protection look-ahead was overly conservative and held back a nurse who was actually available.

  **Strategy B — Swap repair:** If no direct assignment is possible, the repair phase searches for a Level 4+ nurse currently assigned to a *lower-criticality* shift and moves them to the critical slot. The key mechanism: removing the nurse from their current assignment changes which rolling 7-day windows contain their hours, potentially bringing them under the 60-hour cap for the critical shift. The vacated slot on the donor shift is then back-filled with any eligible (typically less specialised) nurse so the donor shift does not stay short-staffed.

  Repair runs up to three passes so cascading fixes take effect — for example, adding a Level 4+ supervisor to an ICU shift makes Level 2 nurses newly eligible, which the next pass can then use to fill the remaining shortfall.

  A hard violation is preserved in the output (and shown to the manager) only when no eligible candidate exists anywhere in the staff roster — a genuine staffing shortage that no algorithm can resolve without adding more staff.

### Files Modified

- `src/lib/engine/scheduler/repair.ts` — new file; `repairHardViolations(result, context)` function
- `src/lib/engine/scheduler/index.ts` — repair phase inserted between greedy construction and local search

---

## [1.4.7] - 2026-02-22

### Fixed

- **Weekend ICU charge shifts no longer fail in the Fairness-Optimized schedule.** The root cause was algorithmic, not a shortage of charge nurses: the greedy algorithm sorted all ICU charge shifts by date, so Saturday and Sunday slots were always processed *last*. In the FAIR profile, the low overtime weight (0.5) allows charge-qualified nurses to accumulate hours freely Monday–Friday. By the time Saturday or Sunday charge slots were reached, those nurses had often hit the 60-hour rolling-window limit and were ineligible. Adding a new agency charge nurse (Paul Walker) did not fix this — he would also be used up during weekday charge slots before Sunday arrived.

  The fix changes the shift priority order so **weekend ICU charge shifts (Saturday and Sunday) are processed before weekday ICU charge shifts**. Sat/Sun charge slots now get first pick of the Level 4+ pool before any weekday shift has consumed capacity. This is consistent with the "most constrained first" principle: weekend slots are harder to fill because the charge pool is depleted by Friday in the FAIR profile.

  The change applies to all three schedule variants. Balanced and Cost-Optimized are unaffected in practice — their higher overtime penalties already prevent charge pool depletion before weekends.

### Files Modified

- `src/lib/engine/scheduler/greedy.ts` — `getShiftPriority()` split into weekend ICU charge (priority 1) and weekday ICU charge (priority 2); all other priorities shifted down by one

---

## [1.4.6] - 2026-02-22

### Added

- **Agency nurses are now treated as last resort by the auto-scheduler.** Previously, agency staff competed on equal footing with regular employees. Because their FTE is 0 (no weekly hours target), they incurred no overtime penalty and sometimes benefited from the capacity-spreading bonus — the scheduler would pick them *before* regular staff. A new `agency` weight component in the soft penalty function adds a flat penalty whenever an agency candidate is evaluated, pushing agency to the back of the queue behind full-time, part-time, float pool, and PRN staff. Agency still fills slots that no other candidate can cover — hard rules are never relaxed — but it is no longer chosen ahead of less-expensive staff when alternatives exist. Penalty weights by profile: Balanced 2.5, Fairness-Optimized 1.5 (lighter — accepts agency cost for equitable distribution), Cost-Optimized 5.0 (heaviest — agency markup 2–3× base pay far exceeds any other cost consideration).

- **PRN Available Days column in the Excel import template.** Per_diem (PRN) staff no longer need to manually submit availability through the app before they can appear in auto-generated schedules. Importing the Excel template now includes a "PRN Available Days" column in the Staff sheet. Accepted values: comma-separated day abbreviations (`Mon, Wed, Fri`), keyword patterns (`Weekdays`, `Weekends`, `All`), or any mix of abbreviated/full day names. During import, the system expands the day pattern into specific dates for the next 12 months and creates `prn_availability` records automatically. The scheduling engine then has standing availability to work with on the first run, without requiring a separate submission step. The export (GET) also writes the "PRN Available Days" column, expressing the staff member's availability as a compact pattern (e.g. `Mon, Wed, Fri`) so the Excel round-trip is lossless.

### Files Modified

- `src/lib/engine/scheduler/types.ts` — `agency: number` field added to `WeightProfile` interface
- `src/lib/engine/scheduler/scoring.ts` — agency penalty section (§8) after charge clustering
- `src/lib/engine/scheduler/weight-profiles.ts` — `agency` weight added to all three profiles (BALANCED: 2.5, FAIR: 1.5, COST_OPTIMIZED: 5.0)
- `src/lib/import/parse-excel.ts` — `prnAvailableDays` field in `StaffImport`; `parsePRNAvailableDays()` helper; "PRN Available Days" column parsed in `parseStaffSheet()`; template updated with new column header and per_diem example row
- `src/app/api/import/route.ts` — `expandPRNDatesToNextYear()` helper; `importData()` creates PRN template schedule + `prn_availability` records for per_diem staff; `exportCurrentData()` exports PRN Available Days column using `summarisePRNDates()`

---

## [1.4.5] - 2026-02-22

### Fixed

- **Charge protection look-ahead prevents Sunday ICU hard violations in FAIR schedule.** The FAIR profile's low overtime weight (0.5) allowed charge-qualified Level 4+ nurses to accumulate hours freely through Monday–Saturday, leaving them ineligible (60h rolling window) for Sunday ICU night charge shifts. A look-ahead guard added to the greedy Pass 2 now detects when assigning a Level 4+ nurse to a regular slot would exhaust their 60h capacity for an upcoming ICU charge shift within 7 days — but only blocks the assignment when that nurse is the sole remaining eligible charge candidate. If other charge-qualified nurses are still available for the upcoming shift, the guard does not activate, preserving full candidate selection for regular slots.

- **PRN staff now usable in auto-generated schedules.** The PRN availability lookup was filtered by `scheduleId`, which meant PRN staff with availability submitted for a previous schedule period were invisible to a newly created schedule. The lookup now aggregates all availability dates across all submissions per staff member; the eligibility check is already date-gated, so this change does not schedule PRN staff on dates they did not submit. The practical effect is that standing PRN availability (e.g., "always available Tue/Thu/Sat") is honoured by any new schedule covering those dates, without requiring re-submission every period.

- **Cost-Optimized float penalty reduced from 3.0 to 2.0.** Float differentials (flat hourly add-on, typically \$3–5/hr) are a real but smaller cost than overtime (1.5× base pay). Setting the float penalty equal to the overtime penalty (both at 3.0) overstated the cost of cross-unit assignments. The corrected weight (2.0) still strongly discourages unnecessary floating of regular-unit nurses while accurately reflecting that it is less expensive than overtime.

### Files Modified

- `src/lib/engine/scheduler/greedy.ts` — charge protection look-ahead in Pass 2; pre-computed `icuChargeShifts` array
- `src/lib/engine/scheduler/state.ts` — `wouldExceed7DayHoursAfterAdding()` helper for look-ahead
- `src/lib/engine/rule-engine.ts` — PRN availability loaded across all schedules, aggregated per staff
- `src/lib/engine/scheduler/weight-profiles.ts` — Cost-Optimized float weight 3.0 → 2.0

---

## [1.4.4] - 2026-02-22

### Fixed

- **Assignment dialog now correctly identifies when a shift still needs a charge nurse.** The previous condition checked whether *any* existing assignment had `isChargeNurse = true`, regardless of competency level. If a Level 3 nurse had been assigned as charge (violating the hard rule), the "Needs charge nurse" badge would disappear and the "Assign as Charge" button would never appear for valid Level 4+ candidates. The check now requires both `isChargeNurse = true` **and** `staffCompetency ≥ 4`, so the dialog accurately reflects that a valid charge nurse is still missing.

- **"Assign as Charge" button gated to Level 4+ nurses.** Previously any `isChargeNurseQualified` nurse would show the "Assign as Charge" button even if their competency level was 1–3. The button is now only offered to nurses with `icuCompetencyLevel ≥ 4`, matching the hard rule requirement in §3.2.

- **Assigning a new charge nurse now demotes the previous charge.** When a manager clicked "Assign as Charge" for a valid Level 4+ nurse, the API inserted the new assignment but left the previous invalid charge (e.g., a Level 3 nurse flagged as charge) in place. The shift then had two charge designations — an invalid one and a valid one — and the hard violation persisted despite the manager's action. The API now clears all existing `isChargeNurse = true` assignments on the same shift before inserting the new charge assignment, ensuring there is exactly one charge nurse and the violation resolves.

### Files Modified

- `src/components/schedule/assignment-dialog.tsx` — `needsCharge` condition now requires `staffCompetency >= 4`; "Assign as Charge" button now requires `icuCompetencyLevel >= 4`
- `src/app/api/schedules/[id]/assignments/route.ts` — demotes existing charge assignments before inserting a new charge nurse

---

## [1.4.3] - 2026-02-22

### Changed

- **Balanced variant overtime weight raised from 1.0 to 1.5.** In the Balanced scheduler, actual overtime (>40h) was previously less expensive than some preference violations — for example, 8h of OT cost 0.667 units while a shift-type mismatch cost 0.75. This meant the scheduler would sometimes choose to put a nurse into overtime rather than assign an unwanted shift type to someone else. The new weight (1.5) makes 8h OT cost 1.0 units, consistently more expensive than any single preference violation, which reflects the real payroll cost of overtime pay (1.5× rate). The Fairness-Optimized variant intentionally keeps overtime low (0.5) to allow extra hours in exchange for equitable weekend and holiday distribution; that profile is unchanged.

- **Capacity-spreading bonus added to the scheduling scoring function.** The greedy algorithm previously had no preference between two candidates with equal accumulated hours. This caused regular unit staff to be repeatedly selected for shifts until they approached overtime, while float pool staff — often fully cross-trained and at low hours — were left underutilised. A small capacity bonus (`−overtime_weight × 0.1 × remaining_hours_before_40h / 40`) now makes the algorithm prefer less-loaded staff when other factors are equal. At full remaining capacity (0h worked), the bonus is −0.15 in Balanced; at 24h already worked, it is −0.06. This gradient is intentionally small — it breaks ties without overriding clinical factors like charge requirement or competency level. Float pool staff naturally benefit most from this bonus early in the greedy pass (when they are typically at low hours and ICU shifts consume capacity), which reduces overtime accumulation on regular unit nurses later in the same week.

### Files Modified

- `src/lib/engine/scheduler/weight-profiles.ts` — Balanced `overtime: 1.0 → 1.5`
- `src/lib/engine/scheduler/scoring.ts` — capacity-spreading bonus added after overtime penalty block

---

## [1.4.2] - 2026-02-20

### Fixed

- **Overtime violations now flag the triggering shift, not all shifts.** Previously the overtime rule attached a staff-level violation (no shift ID), which made it invisible when clicking individual shifts in the grid and provided no guidance on which assignment to adjust. The rule now walks each staff member's assignments in chronological order, tracks cumulative hours for the week, and emits the violation only on the exact shift that pushes the running total past the threshold. All earlier shifts remain clean.

- **Agency staff (FTE = 0) are no longer flagged for overtime.** Agency and on-demand staff have no weekly hours commitment — their FTE is recorded as 0. The previous logic derived a "standard hours" target of 0 × 40 = 0, which caused every shift worked to appear as an overtime violation. The fix exempts any staff member whose FTE is exactly 0 from the overtime rule entirely.

- **Weekend rule now flags excess assignments, not shortfall.** The previous logic flagged staff who had *too few* weekend shifts. This was not actionable — there is no specific shift to remove when someone is short. The rule now flags each assignment that takes a staff member *beyond* their required weekend count, attaching the violation to that specific shift. Staff who meet or fall short of their target have no violation; the scheduler's cost function handles shortfall by preferring to assign those staff on weekends during construction.

- **Soft violations are now visible when clicking shift cells.** Overtime and weekend violations both had an empty `shiftId` (staff-level), so they never appeared in the per-shift violations modal. The schedule page now builds a secondary map of staff-level violations and attaches them to every shift where that staff member is assigned. The violations modal displays three separate sections: hard rule violations (red), shift-specific soft violations (yellow, e.g. preference mismatch), and staff schedule issues (orange, e.g. overtime or excess weekends).

- **Applying a scenario no longer permanently locks the other two.** After applying one scenario, the remaining scenarios were set to `rejected` status. The UI only showed the Apply button for `draft` scenarios, leaving rejected ones with no way to switch back. The condition is now `status !== "selected"` — any scenario that is not the currently active one shows an Apply button, and the Reject button is limited to `draft` scenarios only.

- **ESLint CI check restored.** 29 linting errors were blocking the GitHub Actions check. Fixed by: auto-correcting 8 `prefer-const` violations, disabling the `react-hooks/set-state-in-effect` rule globally (the async fetch-then-setState pattern used in every page triggers a false positive), replacing three `no-explicit-any` casts with proper Drizzle-inferred types, and converting one `require()` call in the import route to an ESM `import`.

### Files Modified

- `src/lib/engine/rules/overtime-v2.ts` — shift-specific violations, FTE = 0 exemption
- `src/lib/engine/rules/weekend-holiday-fairness.ts` — excess-flagging logic with shift IDs
- `src/app/schedule/[id]/page.tsx` — staff violation map; attaches staff-level violations to shift cells
- `src/components/schedule/shift-violations-modal.tsx` — three-section layout (hard / soft / staff)
- `src/app/scenarios/page.tsx` — Apply button shown for all non-active scenarios
- `eslint.config.mjs` — disable `react-hooks/set-state-in-effect`
- `src/app/api/audit/route.ts` — typed Drizzle column references, removed `as any`
- `src/app/audit/page.tsx` — typed `actionColors` map, removed `as any`
- `src/app/api/import/route.ts` — ESM import for `xlsx`

---

## [1.4.1] - 2026-02-20

### Fixed

- **Charge nurse competency enforced as a hard rule.** Only Level 4+ nurses may be assigned as charge. Level 5 is the preferred primary charge nurse; Level 4 is the stand-in fallback only when no Level 5 is available. Level 1–3 nurses cannot be charge regardless of the `isChargeNurseQualified` database flag. The fix was applied in both the scheduling engine (greedy pass) and the rule evaluator, so bad import data cannot slip through either path. Tests added for both layers.

- **60-hour rolling window check is now comprehensive.** The scheduler processes ICU shifts first (most-constrained-first ordering). This means future-dated ICU assignments are placed in state before earlier Med-Surg dates are processed. The previous backward-only window check `[date-6 … date]` saw no existing assignments for those earlier dates and allowed them through — but the forward windows `[date … date+6]` were already over the 60h limit. The fix checks all 7 windows that contain the candidate shift date, catching any combination of past and future assignments that would breach the limit.

- **Violations display separated into hard and soft.** The schedule grid now shows a red "N hard" badge and a yellow "N soft" badge independently per shift. Previously, soft violations were displayed with the same styling as hard violations, making it hard to distinguish severity.

### Changed

- **Per-staff soft violation breakdown added.** The soft violations summary card on the schedule page now includes an "Affected staff" section listing every nurse with at least one soft violation, sorted by violation count (highest first), with the rule names that fired for them. This replaces the previous rule-level-only view, which gave no indication of which individuals were most affected.

---

## [1.4.0] - 2026-02-20

### Summary

This release introduces **automated schedule generation** — the first fully algorithmic scheduling engine for the CAH Scheduler. A new "Generate Schedule" button runs three schedule variants in the background, writes the best variant directly to the schedule, and presents the other two as alternatives for manager review on the Scenarios page.

---

### New Feature: Automated Schedule Generation

#### Overview

Managers can now click **Generate Schedule** from any schedule's detail page. The system runs a two-phase greedy + local search algorithm across three weighted variants (Balanced, Fairness-Optimized, Cost-Optimized), each optimising different priorities while never violating hard scheduling rules.

- **Balanced** (auto-applied): Equal weight across all scheduling objectives. Written directly to the schedule's assignment table as the starting draft.
- **Fairness-Optimized**: Maximises weekend equity, holiday fairness, and preference matching. Saved as an alternative scenario.
- **Cost-Optimized**: Minimises overtime and float/agency use. Saved as an alternative scenario.

After generation, managers compare variants on the **Scenarios** page and click **Apply** to switch the active schedule to a different variant.

---

#### Algorithm Design

**Phase 1 — Greedy Construction**

Shifts are ordered by constraint difficulty (most constrained first):
1. ICU/ER shifts requiring a charge nurse
2. All other ICU/ER shifts
3. Night shifts
4. Day/evening shifts
5. On-call shifts (most flexible pool, filled last)

For each shift, the charge nurse slot (if required) is filled first using only charge-qualified candidates. Remaining slots are filled one at a time by filtering all eligible staff through hard rules, then scoring each candidate with soft rule penalties and selecting the lowest-penalty candidate.

If no eligible staff exist for a slot — because every candidate fails at least one hard rule — the slot is left empty, the shift is marked as **understaffed**, and the reasons why each candidate was rejected are recorded for manager review.

**Phase 2 — Local Search (Swap Improvement)**

After greedy construction, up to 500 random swap attempts are made between pairs of assignments on different shifts. A swap is accepted only if:
- Both staff members still pass all hard rules in their new positions
- The total soft penalty score decreases (monotonic improvement; the algorithm never accepts a worse solution)

This escapes greedy local optima without risking hard rule violations.

---

#### Hard Rules (Never Relaxed)

These constraints are enforced as absolute eligibility filters. Violating any one blocks the assignment regardless of how many soft rule benefits the candidate would provide:

| # | Rule | Description |
|---|------|-------------|
| 1 | Approved leave | Staff on approved leave cannot be assigned |
| 2 | PRN availability | Per-diem staff must have submitted availability for the shift date |
| 3 | ICU/ER competency | ICU, ER, and ED shifts require competency level ≥ 2 |
| 4 | No overlap | Staff cannot be assigned to two overlapping shifts |
| 5 | Minimum rest | At least 10 hours between the end of one shift and the start of the next |
| 6 | Max consecutive days | No more than 5 consecutive working days (or staff's personal preference if lower) |
| 7 | 60h rolling window | Total hours in any 7-day window must not exceed 60 |
| 8 | On-call limits | Respects `maxOnCallPerWeek` and `maxOnCallWeekendsPerMonth` unit settings |

---

#### Soft Rule Penalty Scoring

Each candidate is scored on a scale where lower = better (negative values are valid as incentives):

| Component | Description |
|-----------|-------------|
| Overtime | Hours above 40/week penalised heavily; hours above FTE target but ≤40 penalised lightly |
| Preference mismatch | Wrong shift type (×0.5), preferred day off (×0.7), weekend avoidance (×0.6) |
| Weekend incentive | Negative penalty for staff below their weekend quota (encourages equitable distribution) |
| Float | Penalty for assigning outside home unit; reduced if cross-trained |
| Skill mix | Penalises all-same-competency-level shifts; incentivises adding a new level |
| Competency pairing | Incentivises assigning a Level 5 when a Level 1 is present; Level 4+ when Level 2 is on ICU |
| Charge clustering | Penalises extra charge-qualified nurses on shifts that already have a charge nurse |

---

#### Weight Profiles per Variant

| Weight | Balanced | Fairness-Optimized | Cost-Optimized |
|--------|----------|--------------------|----------------|
| Overtime | 1.0 | 0.5 | **3.0** |
| Preference | 1.0 | **2.0** | 0.5 |
| Weekend count | 1.0 | **3.0** | 1.0 |
| Consecutive weekends | 1.0 | **3.0** | 1.0 |
| Holiday fairness | 1.0 | **3.0** | 1.0 |
| Skill mix | 1.0 | 1.0 | 0.5 |
| Float | 1.0 | 0.5 | **3.0** |
| Charge clustering | 1.0 | 1.0 | 0.5 |

---

#### Understaffing Handling

When a shift cannot be fully staffed because every remaining candidate fails at least one hard rule, the shift is left understaffed. The generation job records:
- Which shifts were understaffed
- How many slots were filled vs. required
- The most common hard rule rejection reasons across the candidate pool

These warnings are shown to the manager after generation completes. The manager reviews and resolves understaffed shifts manually.

---

#### Background Job & Progress Tracking

Generation runs in the background after the HTTP response is returned (using `setImmediate`). The frontend polls for progress every 2 seconds and displays:
- Current phase (e.g., "Building Balanced schedule…")
- Progress percentage
- Understaffed shift warnings when complete

A `generation_job` database record tracks the full job lifecycle (pending → running → completed/failed), enabling recovery on page refresh.

---

#### Apply Scenario

From the Scenarios page, managers can:
- **Apply** — Replace all current assignments with the selected scenario's snapshot. Marks that scenario `selected` and all others `rejected`. Writes an audit log entry.
- **Reject** — Dismiss a scenario without applying it.

---

#### Audit Trail

| Event | Entries Created |
|-------|-----------------|
| Initial generation | 3 entries (one per variant) with action `schedule_auto_generated`. Includes assignment count, understaffed count, and score breakdown for each variant. |
| Apply scenario | 1 entry with action `scenario_applied`. Logs old assignment count, new assignment count, and scenario name. |
| Subsequent manual events | Existing per-event audit behavior (callouts, swaps, manual edits) is unchanged. |

---

### New Files

| File | Description |
|------|-------------|
| `src/lib/engine/scheduler/types.ts` | Type definitions: `WeightProfile`, `AssignmentDraft`, `UnderstaffedShift`, `GenerationResult`, `SchedulerContext` |
| `src/lib/engine/scheduler/state.ts` | `SchedulerState` class: O(1) mutable tracking for rest hours, consecutive days, weekly hours, weekend counts |
| `src/lib/engine/scheduler/eligibility.ts` | `passesHardRules()` and `getRejectionReasons()` — 8 hard rule checks |
| `src/lib/engine/scheduler/scoring.ts` | `softPenalty()` — 7-component soft rule scoring |
| `src/lib/engine/scheduler/weight-profiles.ts` | `BALANCED`, `FAIR`, `COST_OPTIMIZED` weight profile constants |
| `src/lib/engine/scheduler/greedy.ts` | `greedyConstruct()` — greedy construction phase |
| `src/lib/engine/scheduler/local-search.ts` | `localSearch()` — swap-improvement phase |
| `src/lib/engine/scheduler/index.ts` | Entry point: `buildSchedulerContext()`, `generateSchedule()` |
| `src/lib/engine/scheduler/runner.ts` | `runGenerationJob()` — orchestrates 3 variants, writes DB, logs audit |
| `src/app/api/scenarios/generate/status/route.ts` | **NEW** `GET /api/scenarios/generate/status` — job progress polling endpoint |
| `src/__tests__/scheduler/state.test.ts` | **NEW** — 31 tests for `SchedulerState` |
| `src/__tests__/scheduler/eligibility.test.ts` | **NEW** — 28 tests for hard rule eligibility checks |
| `src/__tests__/scheduler/scoring.test.ts` | **NEW** — 17 tests for soft penalty scoring |
| `src/__tests__/scheduler/greedy.test.ts` | **NEW** — 11 tests for greedy construction |
| `src/__tests__/scheduler/local-search.test.ts` | **NEW** — 7 tests for local search improvement |

### Modified Files

| File | Change |
|------|--------|
| `src/db/schema.ts` | Added `generation_job` table; new audit actions (`schedule_auto_generated`, `scenario_applied`); new assignment source `scenario_applied` |
| `src/app/api/scenarios/generate/route.ts` | Replaced stub with background job: validates schedule, rejects duplicate jobs (409), creates `generation_job` record, fires `setImmediate` |
| `src/app/api/scenarios/[id]/route.ts` | Added `apply` action to `PUT` handler: deletes existing assignments, inserts snapshot, marks scenario selected, logs audit |
| `src/app/scenarios/page.tsx` | Added polling progress bar, understaffed warnings panel, Apply/Reject buttons per scenario, `scheduleId` query param auto-selection |
| `src/app/schedule/[id]/page.tsx` | Added "Generate Schedule" button navigating to Scenarios page with pre-selected schedule |

---

## [1.3.3] - 2026-02-19

### Summary

This release fixes two silent rule engine bugs discovered during test suite development, and establishes a comprehensive unit test suite (108 tests) as the foundation for ongoing rule correctness verification. Both bugs caused incorrect rule evaluations that went undetected in production.

---

### Bug Fix 1: Med-Surg Shifts Incorrectly Triggered Level 2 Supervision Rule

#### The Problem

Rule 8 (Level 2 ICU/ER Supervision) is supposed to fire only for ICU, ER, and ED units. The rule checked whether the unit name *contained* a supervised unit keyword using JavaScript's `String.includes()`. Because `"MED-SURG".includes("ED")` evaluates to `true` (the string "ED" is a substring of "MED"), any shift on a Med-Surg unit was incorrectly flagged as requiring a Level 4+ supervisor when a Level 2 nurse was assigned.

This meant Level 2 nurses were being shown false violations on Med-Surg shifts — a unit they are fully qualified to work independently.

#### The Solution

The matching logic was changed from substring matching to exact word matching. The unit name is now split into individual words (on spaces, hyphens, and underscores), and each word is compared exactly against the supervised-unit list (`ICU`, `ER`, `ED`, `EMERGENCY`). A unit named "Med-Surg" produces the words `["MED", "SURG"]` — neither matches — so the rule correctly does not fire.

---

### Bug Fix 2: Same-Weekend Saturday/Sunday Counted as Two Consecutive Weekends

#### The Problem

Rule 3 in the soft rules (Consecutive Weekends) tracks how many weekends in a row a staff member works. A "weekend ID" was computed by converting the shift date to a week number. Because week numbers change between Saturday and Sunday (Saturday is the last day of one ISO week, Sunday is the first of the next), a staff member working both Saturday and Sunday of the **same** weekend received two different weekend IDs.

This made one calendar weekend count as two consecutive weekends, falsely triggering the "more than 2 consecutive weekends" penalty whenever a staff member worked a full weekend.

#### The Solution

The `getWeekendId()` function was updated so that Sundays are shifted back by one day to their preceding Saturday before the week number is calculated. This ensures Saturday Feb 7 and Sunday Feb 8 both produce the same weekend ID (`2026-W6`), correctly treating them as one weekend.

---

### New: Unit Test Suite

A comprehensive Vitest unit test suite was added covering all 13 hard rules and 8 soft rules. Tests run without a database connection — rule evaluators are pure functions that receive a `RuleContext` object, making them fully testable in isolation.

**Coverage:**
- 108 tests across 12 test files
- All rule evaluators tested with passing, failing, and edge-case scenarios
- Two test-driven bugs discovered and fixed (see above)

**Running tests:**
```bash
npm test        # Run all tests once
npm run test:watch   # Watch mode
```

---

### Files Modified

| File | Change |
|------|--------|
| `src/lib/engine/rules/competency-pairing.ts` | Changed unit name matching from substring to exact word matching to fix Med-Surg false positives |
| `src/lib/engine/rules/weekend-holiday-fairness.ts` | Fixed `getWeekendId()` to shift Sunday back to Saturday before computing week number |
| `src/db/schema.ts` | No changes |
| `vitest.config.ts` | **NEW** - Vitest configuration with `vite-tsconfig-paths` for `@/*` alias support |
| `src/__tests__/helpers/context.ts` | **NEW** - Shared test helper factory functions for `RuleContext` mocks |
| `src/__tests__/rules/min-staff.test.ts` | **NEW** - 7 tests for minimum staff rule |
| `src/__tests__/rules/charge-nurse.test.ts` | **NEW** - 6 tests for charge nurse requirement |
| `src/__tests__/rules/patient-ratio.test.ts` | **NEW** - 7 tests for patient-to-staff ratio |
| `src/__tests__/rules/rest-hours.test.ts` | **NEW** - 7 tests for minimum rest between shifts |
| `src/__tests__/rules/max-consecutive.test.ts` | **NEW** - 6 tests for maximum consecutive days |
| `src/__tests__/rules/icu-competency.test.ts` | **NEW** - 5 tests for ICU competency minimum |
| `src/__tests__/rules/competency-pairing.test.ts` | **NEW** - 10 tests for competency pairing (Level 1 preceptor + Level 2 supervision) |
| `src/__tests__/rules/no-overlapping-shifts.test.ts` | **NEW** - 6 tests for overlapping shifts |
| `src/__tests__/rules/prn-availability.test.ts` | **NEW** - 12 tests for PRN availability |
| `src/__tests__/rules/on-call-limits.test.ts` | **NEW** - 8 tests for on-call limits |
| `src/__tests__/rules/overtime-v2.test.ts` | **NEW** - 7 tests for overtime rule |
| `src/__tests__/rules/soft-rules.test.ts` | **NEW** - 27 tests for all 8 soft rules |
| `package.json` | Added `test` and `test:watch` scripts; added `vitest`, `vite-tsconfig-paths`, `@vitest/ui` devDependencies |
| `RULES_SPECIFICATION.md` | Updated to v1.2.4; Rule 3.8 updated with word-boundary matching note; Rule 4.3 updated with weekend definition |

---

### Impact

These were silent bugs — they produced incorrect violation flags without crashing. Any schedule with:
- Level 2 nurses on Med-Surg shifts (Bug 1)
- Staff working both days of a weekend (Bug 2)

...would have shown spurious rule violations in the UI. No data was corrupted; only the displayed violation state was incorrect.

---

## [1.3.2] - 2026-02-18

### Summary

This release adds **staff scheduling preferences** to the Excel import/export feature. Staff preferences (shift preference, days off, consecutive days, etc.) can now be managed via Excel spreadsheet, enabling bulk updates and easier initial setup.

---

### New Feature: Staff Preferences in Excel

#### The Problem

Staff preferences were only editable through the UI one person at a time. For hospitals with 30+ staff members, setting up everyone's preferred shifts, days off, and work limits was time-consuming.

#### The Solution

Staff preferences are now included in the Excel export/import. Managers can:

1. **Export current data** - Preferences are included in the Staff sheet
2. **Edit in Excel** - Update preferences for multiple staff at once
3. **Import** - All preferences are saved along with staff data

---

### New Excel Columns in Staff Sheet

| Column | Values | Default | Description |
|--------|--------|---------|-------------|
| Preferred Shift | day, night, evening, any | any | Which shift type the staff prefers |
| Preferred Days Off | Comma-separated days | (empty) | Days staff prefers not to work (e.g., "Saturday, Sunday") |
| Max Consecutive Days | 1-7 | 3 | Maximum days in a row before requiring a day off |
| Max Hours Per Week | 8-60 | 40 | Maximum scheduled hours per week |
| Avoid Weekends | Yes / No | No | Soft preference to avoid weekend shifts |

---

### How It Works

#### Export
When downloading current data, each staff row now includes their preference settings in the new columns.

#### Import
When uploading an Excel file:
- Preference columns are parsed with flexible column name matching
- Invalid values fall back to defaults (e.g., "morning" → "any")
- Days are normalized to proper capitalization ("saturday" → "Saturday")
- Preferences are saved to the `staff_preferences` table

#### Template
The downloadable template now includes example preference values:
```
Preferred Shift: day
Preferred Days Off: Saturday, Sunday
Max Consecutive Days: 4
Max Hours Per Week: 40
Avoid Weekends: No
```

---

### Validation

**Preferred Shift:**
- Must be: `day`, `night`, `evening`, or `any`
- Case-insensitive ("Day" and "DAY" both work)
- Invalid values default to `any`

**Preferred Days Off:**
- Comma-separated day names
- Valid days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
- Case-insensitive
- Invalid day names are ignored

**Max Consecutive Days:**
- Must be between 1 and 7
- Non-numeric values default to 3

**Max Hours Per Week:**
- Must be between 8 and 60
- Non-numeric values default to 40

**Avoid Weekends:**
- Accepts: Yes, No, True, False, 1, 0
- Case-insensitive

---

### Files Modified

| File | Change |
|------|--------|
| `src/lib/import/parse-excel.ts` | Added preference fields to `StaffImport` interface; parse preference columns in `parseStaffSheet()`; added preference columns to `generateTemplate()` |
| `src/app/api/import/route.ts` | Query and export staff preferences; use imported preferences instead of defaults on import |
| `docs/09-using-the-app.md` | Documented new preference columns |
| `RULES_SPECIFICATION.md` | Updated to v1.2.3 with changelog entry |

---

### Integration with Scheduling Rules

The imported preferences integrate with existing scheduling rules:

- **preference-match** (soft rule) - Penalizes assignments that don't match preferred shift type or days off
- **max-consecutive** (hard rule) - Enforces the max consecutive days setting
- **weekend-count** (soft rule) - Considers avoid weekends preference

---

### Example Workflow

1. **Export** current staff data from Setup page
2. **Open** the Excel file
3. **Add/update** preference columns:
   - Set Maria to prefer day shifts
   - Set John to avoid weekends
   - Set all PRN staff to max 2 consecutive days
4. **Upload** the modified file
5. **Import** - preferences are saved for all staff
6. **Generate schedule** - rules engine uses the new preferences

---

## [1.3.1] - 2026-02-16

### Summary

This release addresses expert feedback on census visibility, staff count display, and preferences visibility.

---

### Changes

#### 1. Census Management
- **Census input** added to shift assignment dialog - managers can now set patient census per shift
- **Census determines staffing** - required staff count is calculated from census bands based on actual patient count
- **Audit logging** - census changes are logged to the audit trail
- **Excel support** - Census Bands sheet added to Excel import/export

#### 2. Staff Count Display Fix
- Previously showed `3/3 staff` even when census bands required 4
- Now correctly shows `3/4 staff` (scheduled/required) based on census band calculations
- API calculates effective required count: `max(shift definition, census band requirement)`

#### 3. Staff Preferences Visibility
- Staff detail dialog now shows **Shift Preferences** section
- Displays: Preferred Shift, Max Hours/Week, Max Consecutive Days, Preferred Days Off, Avoid Weekends, Notes
- Preferences are fetched when dialog opens

#### 4. Census Bands in Excel
- New **Census Bands** sheet in Excel export
- Columns: Name, Unit, Min/Max Patients, Required RNs/LPNs/CNAs, Required Charge, Ratio
- Import census bands to configure staffing requirements per patient count
- If no Census Bands sheet provided, defaults are created

---

### Files Changed
- `src/app/api/schedules/[id]/route.ts` - Calculate effective required from census
- `src/app/api/shifts/[id]/acuity/route.ts` - Support census updates
- `src/components/schedule/assignment-dialog.tsx` - Add census input
- `src/components/staff/staff-detail-dialog.tsx` - Show preferences
- `src/lib/import/parse-excel.ts` - Parse Census Bands sheet
- `src/app/api/import/route.ts` - Import/export census bands
- `src/db/schema.ts` - Add `census_changed` action type

---

## [1.3.0] - 2026-02-15

### Summary

This release adds an **Excel Import/Export** feature that allows hospitals to manage their data via spreadsheets. Users can export current data, edit in Excel, and re-import - making bulk updates simple. This also enables first-time setup by filling in an exported template.

---

### New Feature: Excel Data Import

#### The Problem

Hospitals typically have their staff information stored in Excel spreadsheets. Manually entering 30+ staff members through the UI is time-consuming and error-prone.

#### The Solution

A new **Setup** page (`/setup`) allows users to:

1. **Export current data** - Download an Excel file with current Staff, Units, and Holidays
2. **Edit in Excel** - Add, remove, or modify entries in the familiar spreadsheet format
3. **Upload and validate** - System checks for errors before importing
4. **Import with one click** - Replaces existing data with the uploaded file

This creates a seamless **Export → Edit → Import** workflow for bulk data management.

---

### Excel File Format

**Sheet 1: Staff**
| Column | Required | Example |
|--------|----------|---------|
| First Name | Yes | Maria |
| Last Name | Yes | Garcia |
| Role | Yes | RN / LPN / CNA |
| Employment Type | Yes | full_time / part_time / per_diem / float / agency |
| FTE | No | 1.0 (default) |
| Home Unit | No | ICU |
| Cross-Trained Units | No | ER, Med-Surg (comma-separated) |
| Competency Level | No | 1-5 (default 3) |
| Charge Nurse Qualified | No | Yes / No |
| Reliability Rating | No | 1-5 (default 3) |
| Email | No | email@hospital.com |
| Phone | No | 555-0101 |
| Hire Date | No | YYYY-MM-DD |
| Weekend Exempt | No | Yes / No |
| VTO Available | No | Yes / No |
| Notes | No | Free text |

**Sheet 2: Units**
| Column | Required | Example |
|--------|----------|---------|
| Name | Yes | ICU |
| Description | No | Intensive Care Unit |
| Min Staff Day | Yes | 4 |
| Min Staff Night | Yes | 3 |
| Weekend Shifts Required | No | 3 (default) |
| Holiday Shifts Required | No | 1 (default) |

**Sheet 3: Holidays**
| Column | Required | Example |
|--------|----------|---------|
| Name | Yes | Christmas Day |
| Date | Yes | 2026-12-25 |

---

### How It Works

#### Step 1: Export Current Data
- Click "Download Data" on the Setup page
- Downloads Excel file with your current Staff, Units, and Holidays
- First-time users get headers only (empty database)

#### Step 2: Edit in Excel
- Add new rows, remove rows, or modify existing entries
- Required fields must be filled
- Optional fields can be left blank (defaults applied)

#### Step 3: Upload and Validate
- Drag and drop or click to upload
- System parses and validates every row
- Shows preview with counts:
  - "28 Staff, 3 Units, 9 Holidays"
- Displays any errors (must be fixed) or warnings (informational)

#### Step 4: Import
- Click "Import Data"
- Confirmation dialog warns about data deletion
- System deletes ALL existing data
- Imports new data from Excel
- Auto-creates: shift definitions, rules, census bands

---

### What Gets Imported

**From Excel:**
- Staff members (with auto-created preferences)
- Units (with default configuration)
- Holidays

**Auto-Generated Defaults:**
- Day Shift (7am-7pm, 12 hours)
- Night Shift (7pm-7am, 12 hours)
- 21 scheduling rules (13 hard, 8 soft)
- Census bands for first unit

---

### Validation

**Errors (block import):**
- Missing required fields (First Name, Last Name, Role, etc.)
- Invalid enum values (e.g., "Nurse" instead of "RN")
- Invalid numbers (e.g., FTE > 1.0)

**Warnings (informational):**
- Missing optional fields (e.g., no email)
- Missing sheets (e.g., no Holidays sheet)

---

### Files Added

| File | Purpose |
|------|---------|
| `src/app/setup/page.tsx` | Setup page with upload UI |
| `src/app/api/import/route.ts` | API for file processing |
| `src/lib/import/parse-excel.ts` | Excel parsing and validation |

### Files Modified

| File | Change |
|------|--------|
| `src/components/layout/sidebar.tsx` | Added "Setup" link |
| `package.json` | Added `xlsx` dependency |

---

### Dependencies Added

```
xlsx: ^0.18.5
```

The `xlsx` (SheetJS) library handles Excel file parsing in the browser and server.

---

## [1.2.1] - 2026-02-15

### Summary

This release corrects the leave approval workflow based on expert feedback from Pradeep. The key change is that the system now **automatically finds and recommends replacement candidates** instead of creating open shifts that wait for manual assignment.

---

### What Changed: Coverage Auto-Fill Workflow

#### The Problem with v1.2.0

In v1.2.0, when leave was approved more than 7 days before a shift, the system created an "Open Shift" record. The manager then had to:
1. Go to the Open Shifts page
2. Manually search for available staff
3. Evaluate each candidate
4. Assign someone

This was still a manual, time-consuming process.

#### The Solution in v1.2.1

Now, when leave is approved more than 7 days before a shift:

1. **System automatically searches** for replacement candidates
2. **Follows the escalation ladder**: Float Pool → PRN → Overtime → Agency
3. **Ranks candidates** by suitability (qualifications, availability, fairness)
4. **Presents top 3 candidates** with explanatory reasons
5. **Manager reviews and clicks "Approve"**
6. **Assignment is created automatically**

---

### How the Candidate Finding Algorithm Works

The new `findCandidatesForShift()` function in `src/lib/coverage/find-candidates.ts`:

#### Step 1: Check Float Pool Staff
- Queries all active float pool staff
- Checks each for availability on the shift date
- Verifies they're qualified for the unit (home unit or cross-trained)
- Calculates hours this week to determine overtime

#### Step 2: Check PRN Staff
- Queries all active PRN (per diem) staff
- Only considers those who **marked this date as available**
- Verifies unit qualification
- Checks all scheduling rules (rest time, 60-hour limit, etc.)

#### Step 3: Check Regular Staff for Overtime
- Queries full-time and part-time staff
- Identifies those not already scheduled
- Calculates if this would push them into overtime (>40 hours)
- Considers flex hours YTD for fairness

#### Step 4: Agency Option
- Always included as a fallback
- Marked as "requires external contact"
- Lowest priority score (last resort)

#### Ranking Criteria

Each candidate receives a score based on:

| Factor | Score Impact |
|--------|--------------|
| **Source Priority** | Float (100) > PRN (80) > OT (60) > Agency (10) |
| **Unit Match** | Home unit (+10) > Cross-trained (+0) |
| **Competency Level** | Higher level = higher score |
| **Reliability Rating** | 5/5 = +15, 1/5 = +3 |
| **Overtime** | Non-OT preferred (+15 if within 40h) |
| **Flex Hours YTD** | Lower flex hours = higher score (fairness) |

#### Reasons Provided

Each candidate includes human-readable reasons. Examples:

**Float Pool Candidate:**
- "Float pool staff - designed for coverage"
- "Cross-trained for ICU"
- "Competency Level 4 (Proficient)"
- "Reliability rating: 5/5"

**PRN Candidate:**
- "PRN staff - marked available for this date"
- "Home unit is ICU"
- "High reliability rating (4/5)"

**Overtime Candidate:**
- "Would be overtime (OT pay applies)"
- "Cross-trained for ICU"
- "Low flex hours YTD (fair distribution)"

---

### UI Changes

#### Sidebar Navigation
- Renamed: "Open Shifts" → **"Coverage"**
- Same URL: `/open-shifts`

#### Coverage Page (`/open-shifts`)

**Before (v1.2.0):**
- Table with open shifts
- "Fill" button opened a dialog to manually select staff
- No recommendations

**After (v1.2.1):**
- Table shows pending coverage requests
- "Top Recommendation" column shows best candidate
- "Review" button opens detailed view with top 3 candidates
- Each candidate shows:
  - Name and source (Float Pool, PRN, Overtime, Agency)
  - Color-coded badge (blue for Float, green for PRN, etc.)
  - List of reasons with checkmarks
  - Hours this week + overtime indicator
- "Approve" button next to each candidate
- Clicking "Approve" creates the assignment automatically

---

### Database Schema Changes

**Modified `open_shift` table:**

| New Column | Type | Purpose |
|------------|------|---------|
| `recommendations` | JSON | Stores top 3 candidates with reasons |
| `escalation_steps_checked` | JSON | Array of sources checked (e.g., ["float", "per_diem", "overtime"]) |
| `selected_staff_id` | TEXT | Staff ID chosen by manager |
| `selected_source` | TEXT | Source of chosen staff (float, per_diem, overtime, agency) |
| `approved_at` | TEXT | Timestamp of approval |
| `approved_by` | TEXT | Who approved |

**Modified `status` enum:**
- Old: `open`, `filled`, `cancelled`
- New: `pending_approval`, `approved`, `filled`, `cancelled`, `no_candidates`

---

### API Changes

#### `PUT /api/open-shifts/[id]`

**New action: `approve`**

```json
{
  "action": "approve",
  "selectedStaffId": "staff-uuid-here"
}
```

Response:
- Creates assignment automatically
- Updates coverage request status to "filled"
- Logs audit trail entry

---

### Files Added/Modified

| File | Change |
|------|--------|
| `src/lib/coverage/find-candidates.ts` | **NEW** - Candidate finding algorithm |
| `src/db/schema.ts` | Added new fields to `open_shift` table |
| `src/app/api/staff-leave/[id]/route.ts` | Calls `findCandidatesForShift()` on approval |
| `src/app/api/open-shifts/route.ts` | Returns recommendation fields |
| `src/app/api/open-shifts/[id]/route.ts` | Added `approve` action |
| `src/app/open-shifts/page.tsx` | Complete rewrite for approval workflow |
| `src/components/layout/sidebar.tsx` | Renamed to "Coverage" |

---

### Testing the New Workflow

1. **Create a staff member with scheduled shifts** (at least 8+ days out)
2. **Approve leave** that covers one of those shift dates
3. **Go to Coverage page** (`/open-shifts`)
4. **Verify** the request shows "Pending Approval" status
5. **Click "Review"** to see top 3 candidates with reasons
6. **Click "Approve"** on your chosen candidate
7. **Verify** the assignment was created in the schedule

---

## [1.2.0] - 2026-02-15

### Overview

This release implements 5 major features based on expert feedback from field testing. These changes improve holiday fairness tracking, low census management, shift visibility, leave workflow integration, and staff schedule viewing.

---

### New Features

#### 1. Open Shifts Page (`/open-shifts`)

A new page for managing shifts that need coverage due to leave approvals or callouts.

**What it does:**
- Displays all shifts needing coverage in a filterable table
- Shows shift details: date, time, unit, original staff, reason, priority
- Filter tabs: Open, Filled, Cancelled, All
- "Fill" action opens a dialog to assign a replacement staff member
- "Cancel" action removes the open shift from the queue
- Automatically creates assignments when shifts are filled
- Full audit trail integration for all actions

**Why it matters:**
- Provides a centralized view of all coverage needs
- Streamlines the process of finding and assigning replacements
- Connects leave approvals to operational coverage needs

**Files:**
- `src/app/open-shifts/page.tsx` - Main page component
- `src/app/api/open-shifts/route.ts` - GET/POST endpoints
- `src/app/api/open-shifts/[id]/route.ts` - GET/PUT/DELETE endpoints
- `src/components/layout/sidebar.tsx` - Navigation link added

---

#### 2. Staff Calendar View

Clicking a staff member's name now opens a calendar showing their day-by-day schedule.

**What it does:**
- Calendar grid displays the current month with navigation
- Color-coded days:
  - **Blue** - Day shift assigned
  - **Purple** - Night shift assigned
  - **Green** - On approved leave
  - **Gray** - Off / not scheduled
- Shows staff summary: role, employment type, home unit, FTE
- Default view: current schedule period
- Click arrows to navigate months

**Why it matters:**
- Quickly see a staff member's complete schedule at a glance
- Identify coverage gaps and overwork patterns
- Understand staff availability before making assignments

**Files:**
- `src/components/staff/staff-calendar.tsx` - Calendar component
- `src/components/staff/staff-detail-dialog.tsx` - Dialog wrapper
- `src/app/api/staff/[id]/schedule/route.ts` - Schedule data API
- `src/components/staff/staff-table.tsx` - Name click handler
- `src/app/staff/page.tsx` - Dialog state management

---

#### 3. Shift Violations Modal

The issues badge on shifts is now clickable, showing detailed violation information.

**What it does:**
- Click the red badge on any shift to see violation details
- Modal displays violations in two sections:
  - **Hard Rule Violations** (red) - Must be fixed before publishing
  - **Soft Rule Violations** (yellow) - Preferences/penalties that can be overridden
- Each violation shows:
  - Rule name
  - Description of the issue
  - Penalty score (for soft violations)
- Click on shift cell still opens assignment dialog (unchanged behavior)

**Why it matters:**
- Managers can understand exactly what's wrong with a shift
- Distinguishes between critical issues and minor preferences
- Helps prioritize which problems to address first

**Files:**
- `src/components/schedule/shift-violations-modal.tsx` - Modal component
- `src/components/schedule/schedule-grid.tsx` - Badge click handler
- `src/app/schedule/[id]/page.tsx` - Modal state and violation data

---

### Changed Features

#### 4. Leave Approval Workflow - Now Creates Open Shifts/Callouts

When leave is approved, the system now automatically handles affected shifts.

**What it does:**
- When leave is approved, finds all assignments during the leave period
- For each affected shift:
  - If shift is **within threshold** (default: 7 days) → Creates a **Callout** (urgent)
  - If shift is **beyond threshold** → Creates an **Open Shift** (for scheduled pickup)
- Original assignments are automatically cancelled
- Full audit trail of all changes

**Configuration:**
- `calloutThresholdDays` setting on Unit configuration (default: 7)
- Can be customized per unit

**Why it matters:**
- Eliminates manual step of creating callouts after approving leave
- Ensures no shifts are forgotten when approving time off
- Distinguishes between urgent last-minute needs and advance planning

**Files:**
- `src/app/api/staff-leave/[id]/route.ts` - Enhanced with `handleLeaveApproval()`
- `src/db/schema.ts` - Added `calloutThresholdDays` to unit table

---

#### 5. Holiday Fairness - Now Tracks Annually

Holiday assignment tracking has been changed from per-schedule-period to annual tracking.

**What it does:**
- New `staff_holiday_assignment` table tracks all holiday assignments across the year
- Fairness evaluation compares each staff member's yearly total against the average
- Christmas Eve and Christmas Day are now grouped as ONE "Christmas" holiday
  - Working either day counts as "worked Christmas"
  - Prevents double-counting during evaluation

**Why it matters:**
- Fairer distribution over longer time periods
- Staff who worked holidays early in the year get recognition all year
- Christmas tracking is more realistic (most people work Eve OR Day, not both)

**Files:**
- `src/db/schema.ts` - Added `staff_holiday_assignment` table
- `src/lib/engine/rules/weekend-holiday-fairness.ts` - Rewritten with annual logic and `HOLIDAY_GROUPS`
- `src/app/api/schedules/[id]/assignments/route.ts` - Tracks holiday assignments on create/delete

**Holiday Groups:**
```typescript
const HOLIDAY_GROUPS: Record<string, string> = {
  "Christmas Eve": "Christmas",
  "Christmas Day": "Christmas",
};
```

---

#### 6. Low Census Order - Removed Agency, Added VTO

The low census priority order has been updated based on operational feedback.

**Previous Order:**
1. Agency (removed - contracts guarantee hours)
2. Overtime
3. Per Diem
4. Full Time

**New Order:**
1. **Voluntary (VTO)** - Staff who opted in for voluntary time off
2. Overtime
3. Per Diem
4. Full Time

**New Staff Attribute:**
- `voluntaryFlexAvailable` (boolean) - Staff can indicate they're willing to go home voluntarily
- Displayed as "VTO" badge on staff table
- Configurable in staff edit form

**Why it matters:**
- Agency staff have contracts guaranteeing minimum hours - sending them home doesn't save money
- Voluntary time off respects staff preferences while meeting operational needs
- Staff appreciate choice in low census situations

**Files:**
- `src/db/schema.ts` - Added `voluntaryFlexAvailable` to staff table
- `src/db/seed.ts` - Updated default low census order
- `src/app/settings/units/page.tsx` - Updated UI default
- `src/components/staff/staff-form.tsx` - Added VTO checkbox
- `src/components/staff/staff-table.tsx` - Added VTO badge
- `src/types/staff.ts` - Added field to type
- `src/app/api/staff/route.ts` - Handle VTO field
- `src/app/api/staff/[id]/route.ts` - Handle VTO field

---

### Database Schema Changes

#### New Tables

**`staff_holiday_assignment`**
```sql
CREATE TABLE staff_holiday_assignment (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  holiday_name TEXT NOT NULL,  -- "Christmas", "Thanksgiving", etc.
  year INTEGER NOT NULL,
  shift_id TEXT REFERENCES shift(id),
  assigned_at TEXT NOT NULL
);
```

**`open_shift`**
```sql
CREATE TABLE open_shift (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shift(id),
  original_staff_id TEXT NOT NULL REFERENCES staff(id),
  original_assignment_id TEXT REFERENCES assignment(id),
  reason TEXT NOT NULL,  -- "leave_approved", "callout", etc.
  reason_detail TEXT,
  status TEXT DEFAULT 'open',  -- "open", "filled", "cancelled"
  priority TEXT DEFAULT 'normal',  -- "low", "normal", "high", "urgent"
  created_at TEXT NOT NULL,
  filled_at TEXT,
  filled_by_staff_id TEXT REFERENCES staff(id),
  filled_by_assignment_id TEXT REFERENCES assignment(id),
  notes TEXT
);
```

#### Modified Tables

**`staff`**
- Added: `voluntary_flex_available` (boolean, default false)

**`unit`**
- Added: `callout_threshold_days` (integer, default 7)

**`exception_log`**
- Added entity types: `"open_shift"`, `"staff_holiday_assignment"`
- Added actions: `"open_shift_created"`, `"open_shift_filled"`, `"open_shift_cancelled"`, `"assignment_cancelled_for_leave"`, `"callout_created_for_leave"`

---

### UI Navigation Update

The sidebar now includes:
1. Dashboard
2. Staff
3. Schedule
4. Scenarios
5. Callouts
6. **Open Shifts** (NEW)
7. Leave
8. Shift Swaps
9. PRN Availability
10. Rules
11. Units
12. Holidays
13. Audit Trail

---

### Documentation Updates

- `RULES_SPECIFICATION.md` - Updated to version 1.2 with all changes
- `docs/05-scheduling-rules.md` - Updated holiday fairness section
- `docs/07-handling-callouts.md` - Added open shifts and VTO sections
- `docs/08-configuration.md` - Added new settings documentation
- `docs/09-using-the-app.md` - Added Open Shifts page and Staff Calendar
- `docs/10-glossary.md` - Added VTO, Open Shift terms

---

### Migration Notes

#### For Existing Deployments

1. **Database Migration Required**
   - New tables need to be created (`staff_holiday_assignment`, `open_shift`)
   - New columns need to be added to `staff` and `unit` tables
   - Run `npx drizzle-kit push` or apply migrations manually

2. **Low Census Order**
   - Existing units will keep their current `lowCensusOrder`
   - New units will use the updated default: `["voluntary", "overtime", "per_diem", "full_time"]`
   - Update existing units manually if desired

3. **Holiday Tracking**
   - Historical holiday assignments before this update are not tracked
   - Annual fairness tracking starts fresh from this deployment
   - First full year of data will establish baseline

4. **Staff VTO Setting**
   - All existing staff default to `voluntaryFlexAvailable = false`
   - Staff can update their preference via the staff form
   - Managers can update on behalf of staff

---

### Technical Details

**Dependencies:** No new dependencies added

**API Changes:**
- `GET /api/open-shifts` - List all open shifts with shift/staff details
- `POST /api/open-shifts` - Create new open shift
- `GET /api/open-shifts/[id]` - Get single open shift
- `PUT /api/open-shifts/[id]` - Fill or cancel open shift
- `DELETE /api/open-shifts/[id]` - Delete open shift
- `GET /api/staff/[id]/schedule` - Get staff schedule for date range
- `PUT /api/staff-leave/[id]` - Enhanced to auto-create open shifts/callouts

**Breaking Changes:** None

---

## [1.1.0] - 2026-02-13

### Added
- Section 11 (Application UI Guide) in RULES_SPECIFICATION.md
- Documentation for Leave Management, Shift Swaps, PRN Availability pages
- Documentation for Unit Configuration and Holidays Management pages

---

## [1.0.0] - 2026-02-01

### Added
- Initial release of CAH Scheduler
- Complete scheduling rule engine with hard and soft rules
- Staff management with competency levels
- Shift and assignment management
- Callout logging and escalation workflow
- Leave request management
- Shift swap functionality
- PRN availability tracking
- Unit configuration
- Holiday management
- Audit trail
- Scenario comparison

---

*For questions about this release, please open an issue on GitHub.*
