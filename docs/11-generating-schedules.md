# Generating Schedules

This guide explains how to use the automatic schedule generator, understand the three schedule variants it produces, and read the violations report so you can fix any issues.

---

## What Is Auto-Generation?

Instead of manually assigning each nurse to each shift one by one, the scheduler can build a complete roster automatically. You click one button, wait a few seconds, and a full 6-week schedule appears — filled using the same hard rules and staff preferences the system always enforces.

Auto-generation does **not** guess or take shortcuts. Every assignment it makes passes all the same hard rules you'd apply manually: rest hours, weekly hour limits, competency requirements, leave periods, and more. If a slot genuinely cannot be filled without breaking a rule, it is left empty and flagged for your attention.

---

## How to Generate a Schedule

1. Open any schedule (or create one via the Excel import flow).
2. Click the **Generate Schedule** button in the top-right corner of the schedule page.
3. You will be taken to the **Scenarios** page, which shows a progress bar and a three-step tracker — **Balanced → Fairness → Cost** — highlighting each variant as it is built.
4. Generation typically takes 5–15 seconds for a 6-week schedule.
5. When complete, the schedule is immediately updated with the Balanced variant, and two alternative scenarios appear on the Scenarios page.

> **Note:** Generating a new schedule replaces all existing assignments. If you have manual changes you want to keep, do not regenerate — use the assignment dialog to make individual edits instead.

---

## The Three Variants

Every generation run produces three independent schedules, each optimised for a different priority:

| Variant | What it optimises for |
|---|---|
| **Balanced** | A reasonable mix of fairness, cost, and staff preferences. Overtime avoidance takes priority over preference matching. This is applied to the schedule automatically. |
| **Fairness-Optimized** | Spreads weekend shifts, holidays, and preferred days off as evenly as possible across all staff. Accepts slightly more overtime in exchange for equitable distribution. |
| **Cost-Optimized** | Minimises overtime and float assignments. Some staff may work shifts they prefer less if it avoids extra pay. |

All three variants obey exactly the same hard rules — only their *preferences and trade-offs* differ.

All variants also apply a **capacity-spreading preference**: when two staff members are otherwise equally suitable for a shift, the one who has worked fewer hours that week is preferred. This mirrors what a charge nurse naturally does when filling a gap ("who has the most availability this week?") and reduces the chance of one nurse accumulating overtime while another is underused.

### Applying an Alternative Variant

If you prefer the Fairness or Cost variant over the default Balanced one:

1. Go to the **Scenarios** page for your schedule.
2. Find the variant you want (labelled "Fair" or "Cost").
3. Click **Apply**. This replaces the current assignments with the scenario's roster.
4. The schedule page refreshes automatically.

You can switch between variants at any time — including switching back to a variant you applied earlier and then moved away from. Every non-active scenario shows an **Apply** button, regardless of whether it was previously applied or rejected.

---

## Reading the Violations Report

After generation (or after any manual edits), the schedule page shows a summary of violations above the grid.

### Hard Violations — Must Fix

Shown in **red**. These represent situations that are unsafe or non-compliant — for example, a shift with too few staff, or a charge nurse requirement that could not be met. The schedule should not be published with any hard violations outstanding.

- Each red entry shows the rule that was broken and how many shifts are affected.
- Click any **red-bordered shift** in the grid to open the assignment dialog and fix it manually.

### Soft Violations — Schedule Quality

Shown in **yellow**. These are not rule breaches but indicate that the schedule is not ideal — for example, a nurse is working a shift type they prefer to avoid, or someone has more weekend shifts than required.

The soft violations panel shows two breakdowns:

**By rule** — which optimisation rules fired and how many times. Common ones include:
- *Preference Match* — staff assigned to a shift type, day, or weekend they prefer to avoid
- *Weekend Fairness* — a staff member has more weekend shifts than their required count
- *Overtime* — a nurse's hours exceed their FTE target for the week

**Affected staff** — every nurse who has at least one soft violation, sorted by how many they have. This tells you at a glance who is most impacted. For example:

```
Alice Smith    8 violations
  Preference Match · Weekend Fairness

Bob Jones      3 violations
  Overtime
```

A small number of soft violations is normal and unavoidable — especially preference mismatches on ICU shifts where competency requirements limit which staff can work. If the count is high, consider regenerating with the Fairness-Optimized variant or manually swapping the most-affected staff members.

### Viewing Violations for a Specific Shift

Click any shift cell in the grid to open the violations detail panel for that shift. Violations are grouped into three sections:

- **Hard Rule Violations (red)** — issues that must be resolved before the schedule is safe to publish, such as too few staff or a missing charge nurse.
- **Soft Rule Violations (yellow)** — preference mismatches tied to this specific shift, such as a nurse assigned to a shift type they prefer to avoid.
- **Staff Schedule Issues (orange)** — overtime or excess weekend violations for nurses assigned to this shift. These are flagged on the specific shift that crossed the threshold, so removing or swapping that one assignment clears the warning.

---

## Automatic Hard-Violation Repair

After the initial schedule is built, the system runs an automatic repair pass before finalising the roster. This pass looks for any remaining hard violations — missing charge nurse, missing Level 4+ ICU supervisor, understaffed slots — and attempts to resolve each one without manager involvement.

For each violation it tries two approaches in order:

1. **Direct assignment** — find an eligible staff member not yet on the affected shift and assign them. This catches cases where the initial build was overly cautious about "saving" a nurse for a later shift that turned out not to need them.

2. **Staff swap** — move a Level 4+ nurse from a lower-priority shift to the critical slot, then back-fill the vacated slot with any eligible nurse. Moving the nurse changes their weekly hour totals, which can bring them within the 60-hour rolling limit for the critical shift even if they appeared ineligible before.

This process runs up to three times in sequence, because fixing one violation (adding a Level 4+ supervisor) can make other staff eligible for the same shift, which the next pass then fills.

A hard violation is only left in the final schedule if there is genuinely no eligible staff member anywhere in the roster — for example, every charge-qualified nurse is on approved leave or at their hour limit. In that case the shift is flagged for manager review.

---

## What Happens If a Shift Can't Be Filled?

If no eligible staff member exists for a slot — because everyone is on leave, on another shift, or at their hour limit — the system leaves the slot empty rather than breaking a hard rule. This is called an **understaffed shift**.

Understaffed shifts appear with an orange border in the grid and show a "0/N staff" indicator. The hard violations panel will list them under a "Minimum Staffing" entry.

To fix an understaffed shift:
1. Click the shift in the grid.
2. The assignment dialog shows you which staff are eligible and any who were excluded (with the reason).
3. Assign a staff member manually, or consider whether on-call or per-diem staff can cover the gap.

### Reading the Assignment Dialog

The assignment dialog has three sections. **Currently Assigned** and **Available Staff** both show a detail line with scheduling context so you can make an informed decision about whether to add, remove, or swap someone.

#### Currently Assigned Staff

Each nurse already on this shift shows:

| Indicator | What it means |
|-----------|--------------|
| **Xh this week** | Total hours in the same week as this shift, *including* this shift. Shown in amber if a part-time nurse is above their FTE target. |
| **Xh FTE target** | Shown for part-time staff only. If their total is at or above this number, the text turns amber — they are working extra hours above their contracted level. |
| **OT** (red badge) | This nurse is working overtime this week — their total hours for the week exceed 40h. The badge appears on every shift that falls in the overtime zone, not just the first one to cross the threshold. |
| **Preference mismatches** (amber) | Shift type conflict, preferred day off, or weekend avoidance — same indicators as for available staff. |

#### Available Staff

Each eligible staff member shows a detail line to help you make the right choice:

| Indicator | What it means |
|-----------|--------------|
| **Xh this week** | Hours already worked in the same week as this shift. Lower is better — they have more capacity. |
| **Xh FTE target** | Shown for part-time staff. If their weekly hours are already at or above this number, the text turns amber — they are working above their contracted hours even before this shift. |
| **Would OT** (red) | Assigning this shift would push the person above 40 hours for the week, incurring overtime pay. Choose someone without this badge when possible. |
| **Prefers [shift type]** (amber) | This person prefers a different shift type (e.g., prefers nights but this is a day shift). |
| **Prefers [day] off** (amber) | This person listed this day as a preferred day off. |
| **Avoids weekends** (amber) | This person prefers not to work weekends and this is a Saturday or Sunday shift. |

Amber indicators are not blocking — the assignment is still allowed — but they flag that the assignment will generate a soft violation and may affect staff satisfaction.

---

## Charge Nurse Rules

A charge nurse is the senior nurse who takes clinical and administrative responsibility for a shift. The scheduler enforces strict rules:

- **Level 5** nurses are the primary charge nurses. Whenever possible, a Level 5 is assigned to the charge role.
- **Level 4** nurses can serve as a stand-in charge nurse when no Level 5 is available.
- **Level 1, 2, or 3** nurses can **never** be assigned as charge, even if their staff record has the charge-qualified flag set. The system ignores that flag for anyone below Level 4.

If a shift requires a charge nurse but no Level 4 or Level 5 nurse is eligible (all are on leave, at their hour limit, etc.), the charge slot will be empty and a hard violation will be raised.

---

## Frequently Asked Questions

**Can I run generation more than once?**
Yes. Each run replaces the previous assignments and creates fresh scenarios. Previous scenarios are deleted.

**Does generation affect leave, callouts, or PRN availability?**
No. Generation reads those records and respects them as constraints, but it does not modify them.

**Why are there so many preference soft violations?**
On ICU and ER shifts, competency requirements mean only a subset of staff are eligible. When the eligible pool is small, some nurses will inevitably be assigned to shifts that don't match their preferences. The Fairness-Optimized variant may distribute these mismatches more evenly.

**Can I mix auto-generated and manual assignments?**
Yes. After generation, you can open any shift and add, remove, or change assignments individually. Those changes are preserved unless you regenerate.

**Will I get the same schedule if I generate again?**
No. Each generation run uses a different random seed, so the result will vary slightly even with the same staff and shift data. This is intentional — it lets you generate a few alternatives and pick the best one. However, every run that produces a particular scenario is recorded in the audit log with its seed value, so any specific result can be reproduced exactly by the development team if needed.

---

*Last Updated: February 2026*
