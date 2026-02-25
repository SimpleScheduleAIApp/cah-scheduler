# Changelog

All notable changes to the CAH Scheduler project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
