# Scheduling Rules

[← Back to Index](./README.md) | [← Previous: Understanding Shifts](./04-understanding-shifts.md) | [Next: Managing Requests →](./06-managing-requests.md)

---

## Why Do We Need Rules?

Without rules, scheduling would be chaotic:
- Everyone would request weekends off
- Inexperienced staff might work alone
- Nurses might work until they collapse
- Some people would get all the good shifts

**Rules create structure, safety, and fairness.**

---

## Two Types of Rules

The scheduler works with two fundamentally different types of rules:

### Hard Rules (Must NEVER Be Broken)

These are **absolute constraints**. The scheduler will not create a schedule that violates these.

**Think of them as:** Laws. Non-negotiable. Safety-critical.

**Examples:**
- Nurses must have 10 hours rest between shifts
- Level 1 orientees must have a preceptor present
- Cannot work more than 60 hours in 7 days

### Soft Rules (Try to Honor, Can Be Violated)

These are **preferences**. The scheduler tries to satisfy them but can break them if necessary.

**Think of them as:** Guidelines. Ideals. Fairness goals.

**Examples:**
- Try to give people their preferred shift (day vs. night)
- Distribute weekends evenly among staff
- Minimize overtime

**The Difference:**
> **Hard Rule:** "Sarah CANNOT work Tuesday - she just worked a 12-hour shift ending at 7am Tuesday. She needs 10 hours rest."
> **Soft Rule:** "Sarah PREFERS not to work Tuesday - it's her daughter's birthday. We'll try to honor this, but if we're short-staffed, she may have to work."

---

## Hard Rules Explained

### 1. Minimum Staff Per Shift

**What it means:** Every shift must have at least the required number of staff.

**Why it matters:** Understaffing puts patients at risk.

**How it works:**
- Each shift defines how many staff are needed
- The nurse manager sets a **census tier** each day using the Census page — this directly determines the required staffing for that shift
- The scheduler won't create a shift with gaps

**Census tiers (set on the Daily Census page):**

| Tier | Meaning | Action |
|---|---|---|
| 🔵 Blue | Low occupancy | Low census protocol — some staff may be sent home |
| 🟢 Green | Normal census | Standard staffing applies |
| 🟡 Yellow | Elevated census | Extra staff needed — call someone in |
| 🔴 Red | Critical census | All hands on deck |

The patient count range and staffing requirements for each tier are configured under **Rules → Census Bands**.

### 2. Charge Nurse Required

**What it means:** Shifts that require a charge nurse must have one scheduled.

**Why it matters:** Someone needs to lead the shift and make decisions.

**How it works:**
- Shift says "requires charge nurse = yes"
- At least one assigned staff must be charge-qualified

### 3. Patient-to-Staff Ratio

**What it means:** The ratio of patients to licensed nurses cannot exceed the defined limit.

**Example:**
> If the ratio is 2:1 and there are 8 patients, you need at least 4 licensed staff (RNs + LPNs).

**Why it matters:** Too many patients per nurse = unsafe care.

### 4. Minimum Rest Between Shifts

**What it means:** Staff must have at least 10 hours off between the end of one shift and the start of the next.

**Example:**
> Maria works until 7:00 PM on Monday.
> She cannot start another shift until 5:00 AM Tuesday (10 hours later).
> If a day shift starts at 7:00 AM, she cannot work it.

**Why it matters:** Fatigued nurses make mistakes. This is a safety rule.

### 5. Maximum Consecutive Days

**What it means:** Staff cannot work more than 5 days in a row without a day off.

**Example:**
> John works Monday, Tuesday, Wednesday, Thursday, Friday.
> He MUST have Saturday OR Sunday off.
> He cannot work both Saturday and Sunday after working Mon-Fri.

**Why it matters:** Everyone needs rest. Burnout hurts retention and safety.

### 6. ICU Competency Minimum

**What it means:** Only staff with competency level 2 or higher can be assigned to ICU.

**Why it matters:** Level 1 (orientees) cannot work ICU independently - it's too complex.

### 7. Level 1 Preceptor Required

**What it means:** Any Level 1 staff on a shift must have a Level 5 (preceptor) also on that shift.

**Example:**
> New hire Jenny (Level 1) is scheduled for Tuesday Day shift.
> At least one Level 5 nurse must also be on Tuesday Day shift.

**Why it matters:** Orientees need supervision and teaching.

### 8. Level 2 ICU/ER Supervision

**What it means:** Level 2 staff working in ICU or ER need a Level 4+ supervisor on the same shift.

**Which units does this apply to?** Only units whose name is (or contains the word) **ICU**, **ER**, **ED**, or **Emergency**. General units like Med-Surg do **not** trigger this rule — Level 2 nurses can work Med-Surg independently.

**Why it matters:** Advanced beginners are still learning critical care.

### 9. No Overlapping Shifts

**What it means:** You can't schedule someone for two shifts that overlap in time.

**Example:**
> Cannot assign Maria to both:
> - Day shift (7 AM - 7 PM)
> - Evening shift (3 PM - 11 PM)
> These overlap from 3 PM to 7 PM.

**Why it matters:** A person can't be in two places at once!

### 10. PRN Availability

**What it means:** PRN staff can only be scheduled on days they marked as available.

**Example:**
> Tom (PRN) submitted availability: Feb 3, 7, 12, 15.
> He CANNOT be scheduled for Feb 5 - he didn't say he was available.

**Why it matters:** PRN staff aren't obligated to work. We can only use them when they've agreed to be available.

### 11. Staff On Leave

**What it means:** Staff with approved leave cannot be scheduled during their leave.

**Example:**
> Maria has approved vacation from Feb 10-15.
> She CANNOT be scheduled for any shift during those dates.

**Why it matters:** We approved their time off. We must honor it.

### 12. On-Call Limits

**What it means:**
- Maximum 1 on-call shift per week
- Maximum 1 on-call weekend per month

**Why it matters:** On-call is stressful. You're always "half working." Too much on-call leads to burnout.

### 13. Maximum 60 Hours in 7 Days

**What it means:** No one can work more than 60 hours in any rolling 7-day period.

**Example:**
> Looking at any 7 consecutive days, total hours cannot exceed 60.
> 5 twelve-hour shifts = 60 hours = the maximum.

**Why it matters:** Extreme fatigue is dangerous for nurses AND patients.

---

## Soft Rules Explained

### 1. Minimize Overtime

**What it means:** Try not to schedule people for more than 40 hours per week.

**Why it's soft:** Sometimes overtime is necessary. But we should minimize it.

**How the scheduler handles it:**
- Calculates "extra hours" (between FTE target and 40)
- Calculates "overtime" (above 40)
- Applies small penalty for extra hours
- Applies large penalty for overtime
- But if coverage requires it, overtime happens

**Which shifts get flagged?**
- **Actual overtime (above 40 h/week):** Only the one shift that first pushes the person over 40 hours is flagged — not every shift they worked that week. This pinpoints the single assignment that caused the problem.
- **Extra hours (above FTE target, below 40 h):** Every shift worked above the FTE target is flagged, using only the hours that *that shift alone* adds. For example, if a 0.5 FTE nurse (20 h/week) works three 8-hour shifts (24 h total), the second and third shifts each show a separate violation for the hours they individually contributed above 20. This gives you a clear picture of which specific shifts are over-scheduling a part-time nurse.

**Agency staff are not flagged.** Agency and on-demand staff have no set weekly hours (their FTE is 0), so there is no overtime threshold to apply. They can work as many shifts as needed without triggering this warning.

**How the scheduler avoids overtime proactively:**
Part-time and extra-hours nurses are always scheduled before a full-time nurse would go into overtime. Think of it in two tiers:
1. **First**, fill the shift from staff whose total hours for the week would stay at or below 40.
2. **Only if no one in tier 1 is eligible** (on leave, on another shift, at rest, etc.) does the scheduler consider someone who would cross into overtime.

This is a firm rule, not just a preference — a 0.5 FTE nurse working 36 hours (extra hours, but no overtime pay) will always be chosen over a 1.0 FTE nurse who would go to 48 hours, regardless of other scoring factors. If overtime still appears in the final schedule, it means every eligible candidate for that slot would have caused overtime.

### 2. Weekend Shift Requirements

**What it means:** Each person should work a minimum number of weekend shifts per period.

**Default:** 3 weekend shifts per 6-week schedule.

**Example:**
> The schedule period has 6 weekends (12 weekend days).
> Each full-time staff member should work at least 3 of those weekend days.

**Why it's soft:**
- Some people may have 2, some may have 4 - close enough
- Weekend-exempt staff are excluded
- But we aim for fairness

**How violations are shown:** The system does *not* flag staff who have too *few* weekend shifts — that would mean showing a warning with nothing to fix. Instead, it flags each shift that is *one too many* for that person. For example, if the required count is 3 and someone is assigned to 5 weekend shifts, the 4th and 5th weekend shifts are flagged. Removing or swapping either one clears the violation. Staff who are at or below the required count will not see any weekend violation.

### 3. Consecutive Weekends Penalty

**What it means:** Try not to have anyone work more than 2 weekends in a row.

**What counts as one weekend?** Saturday and Sunday of the same calendar weekend count as **one weekend**, not two. Working both days of the same weekend is normal and does not make it "two consecutive weekends."

**Example:**
> John works Weekend 1 (Sat + Sun), Weekend 2 (Sat + Sun), Weekend 3 (Sat + Sun).
> That's 3 consecutive weekends - the scheduler will try to avoid this.
> But working both Saturday and Sunday of a single weekend counts as just **one** weekend.

**Why it's soft:** Sometimes unavoidable with small staff, but we try.

### 4. Holiday Fairness

**What it means:** Holiday shifts should be distributed evenly **across the year** (not per schedule period).

**How it works:**
- System tracks holiday assignments in the `staff_holiday_assignment` table
- Compares each person's yearly total against the average
- Staff below average get priority for non-holiday assignments
- Staff above average may be assigned holidays to balance out

**Christmas Grouping:**
Christmas Eve and Christmas Day count as ONE "Christmas" holiday:
- Working Christmas Eve = "worked Christmas"
- Working Christmas Day = "worked Christmas"
- Working both still counts as just ONE holiday

**Why annual tracking?**
> Per-period tracking was unfair: someone who worked Thanksgiving in Period 1 might also get assigned Christmas in Period 2, while others worked zero holidays.
> Annual tracking ensures year-round fairness.

### 5. Staff Preferences

**What it means:** Try to give people their preferred shifts and days.

**Preferences include:**
- Preferred shift type (day vs. night)
- Preferred days off
- Maximum consecutive days preferred
- Preferred schedule pattern

**Why it's soft:** We can't always honor preferences, but we try.

### 6. Minimize Floating

**What it means:** Try to keep people in their home unit.

**Why it's soft:** Sometimes floating is necessary for coverage, but staff prefer their home unit.

**Penalty levels:**
- Float to cross-trained unit: Small penalty
- Float to unfamiliar unit: Large penalty

### 7. Distribute Charge Nurses

**What it means:** Don't put all the charge-qualified nurses on the same shift.

**Why it's soft:** We want leadership available across all shifts, but sometimes clustering happens.

### 8. Skill Mix Balance

**What it means:** Each shift should have a mix of experience levels.

**Ideal:**
- Some senior nurses (Level 4-5)
- Some mid-level nurses (Level 3)
- Maybe some newer nurses (Level 2)

**Avoid:**
- All juniors on one shift (no leadership)
- All seniors on one shift (waste of experience)

---

## How Rules Work Together

Here's an example of the scheduler's decision process:

**Situation:** Scheduling Tuesday Day Shift

**Step 1: Check Hard Rules**
```
✅ Need 4 nurses? Check if we have 4 available.
✅ Need Charge Nurse? Check if one of the 4 is charge-qualified.
✅ Rest requirements? Ensure no one worked late Monday night.
✅ PRN available? Only schedule PRN staff who said they're available.
✅ Anyone on leave? Exclude them.
```

**Step 2: Optimize Soft Rules**
```
Consider different options:
Option A: Maria, John, Sarah, Tom
  - Maria is on overtime (penalty: 10 points)
  - Good skill mix (bonus: 0 points)
  - Total: 10 points

Option B: Maria, John, Lisa, Jenny
  - No overtime (penalty: 0)
  - Jenny prefers days off Tuesday (penalty: 5 points)
  - Total: 5 points

Option C: Maria, John, Lisa, Agency Nurse
  - Agency = expensive (penalty: 15 points)
  - Total: 15 points
```

**Result:** Option B wins (lowest penalty score).

---

## Overriding Rules

Sometimes managers need to override rules. The system handles this carefully:

### Can Override (With Justification)
- Soft rules (preferences, fairness)
- Some hard rules with administrator approval

### Cannot Override
- Safety-critical hard rules (rest time, supervision)
- Legal requirements

### When Rules Are Overridden
1. Manager provides justification
2. Override is logged in audit trail
3. Timestamp and person recorded
4. Available for compliance review

---

## Summary

Rules are the backbone of fair, safe scheduling:

**Hard Rules (Never Break):**
- Staffing minimums
- Rest requirements
- Supervision requirements
- Time/availability constraints

**Soft Rules (Try to Honor):**
- Preferences
- Fairness (weekends, holidays)
- Cost optimization
- Skill distribution

The scheduler balances all these automatically, finding the best possible schedule that:
- Never violates hard rules
- Minimizes soft rule penalties
- Considers all staff and all shifts together

---

[Next: Managing Requests →](./06-managing-requests.md)
