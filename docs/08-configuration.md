# Configuration

[← Back to Index](./README.md) | [← Previous: Handling Callouts](./07-handling-callouts.md) | [Next: Using the App →](./09-using-the-app.md)

---

## What Can Be Configured?

Every hospital is different. The CAH Scheduler lets you customize:

1. **Units** - Define your hospital's units and their specific rules
2. **Holidays** - Set which days count as holidays
3. **Rules** - Adjust scheduling rules and their parameters
4. **Census Bands** - Define staffing levels based on patient count
5. **Shift Definitions** - Create your shift types

---

## Unit Configuration

### What Is a Unit?

A **unit** is a distinct area of the hospital with its own staff and patients.

**Examples:**
- ICU (Intensive Care Unit)
- ER (Emergency Room)
- Med-Surg (Medical-Surgical Floor)
- OB (Obstetrics/Labor & Delivery)

### Why Configure Units?

Each unit may have different rules:
- ICU might require more weekend coverage
- ER might have different escalation priorities
- Med-Surg might have different patient ratios

### Unit Settings Explained

| Setting | What It Controls | Example |
|---------|------------------|---------|
| **Name** | Unit identifier | "ICU", "Emergency Room" |
| **Description** | Friendly description | "12-bed intensive care unit" |
| **Weekend Rule Type** | How weekend fairness is calculated | "count_per_period" or "alternate_weekends" |
| **Weekend Shifts Required** | Minimum weekend shifts per person | 3 (per 6-week period) |
| **Schedule Period Weeks** | Length of scheduling cycle | 6 weeks |
| **Holiday Shifts Required** | Minimum holidays per person | 1 (per period) |
| **Escalation Sequence** | Callout coverage order | Float → PRN → OT → Agency |
| **Acuity Yellow Extra Staff** | Extra staff at Yellow acuity | +1 |
| **Acuity Red Extra Staff** | Extra staff at Red acuity | +2 |
| **Low Census Order** | Who goes home first in low census | Voluntary → OT → PRN → Full-Time |
| **Callout Threshold Days** | Days before shift to classify as callout vs open shift | 7 days |
| **OT Approval Threshold** | Hours requiring CNO approval | 4 hours |
| **Max On-Call Per Week** | On-call shift limit | 1 per week |
| **Max On-Call Weekends Per Month** | Weekend on-call limit | 1 per month |
| **Max Consecutive Weekends** | Before penalty applies | 2 |

### Weekend Rule Types

**Count Per Period:**
> "Everyone must work at least 3 weekend shifts in the 6-week schedule."
> Simple counting - work your share.

**Alternate Weekends:**
> "Work every other weekend."
> More structured - weekend 1 off, weekend 2 on, weekend 3 off...

### Escalation Sequence

This is the order used when someone calls out:

```
Default: Float → Per Diem → Overtime → Agency

You might change it to:
         Overtime → Float → Per Diem → Agency
         (if your OT cost is lower than float pool cost)
```

### Low Census Order

When census drops and you need to send people home:

```
Default: Voluntary → Overtime → Per Diem → Full-Time

Meaning:
1. First, send home VTO staff (they volunteered)
2. Then, staff on overtime (expensive)
3. Then, per diem staff
4. Finally, full-time staff (only if necessary)
```

**Note:** Agency is NOT in the low census order because agency contracts typically guarantee minimum hours - sending them home doesn't save money.

### Callout Threshold Days

This setting determines when leave-related coverage needs become "callouts" vs "open shifts":

```
Default: 7 days

If leave is approved and shift is within 7 days → Creates Callout (urgent)
If leave is approved and shift is beyond 7 days → Creates Open Shift (for pickup)
```

---

## Holiday Configuration

### What Are Holidays?

Holidays are special days that:
- Often require extra staffing incentives
- Need fair distribution among staff
- May have premium pay
- Affect fairness calculations

### Standard US Holidays

The app can auto-populate these:

| Holiday | Typical Date |
|---------|--------------|
| New Year's Day | January 1 |
| MLK Day | 3rd Monday in January |
| Presidents' Day | 3rd Monday in February |
| Memorial Day | Last Monday in May |
| Independence Day | July 4 |
| Labor Day | 1st Monday in September |
| Thanksgiving | 4th Thursday in November |
| Christmas Eve | December 24 |
| Christmas Day | December 25 |
| New Year's Eve | December 31 |

### Adding Holidays

You can:
1. **Add Standard Holidays** - One click to add all US holidays for a year
2. **Add Custom Holidays** - Add your own (e.g., hospital anniversary)
3. **Edit Holidays** - Change dates or names
4. **Delete Holidays** - Remove ones that don't apply

### Why Manage by Year?

Holidays shift! Thanksgiving 2025 is a different date than Thanksgiving 2026.

The app lets you manage holidays per year, so you can:
- Set up 2025 holidays
- Set up 2026 holidays
- Archive past years

---

## Rules Configuration

### What Are Rules?

Rules are the constraints and preferences that govern scheduling. (See [Scheduling Rules](./05-scheduling-rules.md) for full explanation.)

### Configuring Rules

On the Rules page, you can:

| Action | What It Does |
|--------|--------------|
| **View all rules** | See every rule in the system |
| **Enable/Disable** | Turn rules on or off |
| **Adjust parameters** | Change values (e.g., "10 hours rest" to "11 hours") |
| **Adjust weights** | Change soft rule priorities |

### Rule Parameters

Each rule has configurable parameters:

**Example: Minimum Rest Between Shifts**
```
Default: 10 hours
Your setting: 11 hours (more conservative)
```

**Example: Maximum Consecutive Days**
```
Default: 5 days
Your setting: 4 days (shorter stretches)
```

### Rule Weights (Soft Rules)

Soft rules have "weights" that determine their importance:

```
Weight 1.0 = Standard importance
Weight 2.0 = Twice as important
Weight 0.5 = Half as important
```

**Example:**
- If minimizing overtime is more important than preferences, give overtime a higher weight
- If staff happiness is critical (retention issues), boost preference matching weight

---

## Census Bands

### What Are Census Bands?

Census bands define how many staff you need for each **census tier**. There are four tiers — Blue, Green, Yellow, and Red — each mapped to a patient count range and a full staffing specification.

### Census Tiers

| Tier | Color | Meaning |
|------|-------|---------|
| **Blue** | 🔵 | Low occupancy — low census protocol (staff may be sent home) |
| **Green** | 🟢 | Normal census — standard staffing |
| **Yellow** | 🟡 | Elevated census — extra staff needed |
| **Red** | 🔴 | Critical census — all hands on deck |

### Example Census Bands for ICU

| Tier | Patients | RNs | LPNs | CNAs | Charge | Ratio |
|------|----------|-----|------|------|--------|-------|
| 🔵 Blue (Low Census) | 1–4 | 2 | 0 | 1 | 1 | 2:1 |
| 🟢 Green (Normal) | 5–8 | 3 | 1 | 1 | 1 | 2:1 |
| 🟡 Yellow (High) | 9–10 | 4 | 1 | 2 | 1 | 2:1 |
| 🔴 Red (Critical) | 11–12 | 5 | 1 | 2 | 1 | 2:1 |

### How It Works

1. **Nurse manager opens the Daily Census page** at the start of each shift.
2. **Selects the tier** (🔵 / 🟢 / 🟡 / 🔴) for each shift that day.
3. **Staffing requirements update automatically** based on the tier's census band.

### Configuring Census Bands

Go to **Rules → Census Bands** to edit each tier's staffing specification:
- Patient range (min – max)
- Required RNs, LPNs, CNAs
- Required Charge Nurses
- Patient-to-nurse ratio

---

## Shift Definitions

### What Are Shift Definitions?

Templates for the types of shifts your hospital uses.

### Example Shift Definitions

| Name | Type | Start | End | Hours | Staff Needed |
|------|------|-------|-----|-------|--------------|
| Day Shift | day | 07:00 | 19:00 | 12 | 4 |
| Night Shift | night | 19:00 | 07:00 | 12 | 3 |
| Day On-Call | on_call | 07:00 | 19:00 | 12 | 1 |
| Night On-Call | on_call | 19:00 | 07:00 | 12 | 1 |

### Shift Properties

| Property | Meaning |
|----------|---------|
| **Name** | Display name for the shift |
| **Type** | Day, Night, Evening, On-Call |
| **Start/End Time** | When it begins and ends |
| **Duration** | Total hours |
| **Required Staff** | Base number of staff needed |
| **Requires Charge** | Does this shift need a charge nurse? |
| **Counts Toward Staffing** | Does this count for patient coverage? (On-call = No) |

---

## Configuration Best Practices

### Start With Defaults

The app comes with sensible defaults. Don't change everything at once:
1. Run with defaults for a few cycles
2. Note what isn't working
3. Make targeted adjustments
4. Monitor results

### Document Changes

When you change configuration:
- Note what you changed
- Note why you changed it
- Note when (date)
- Review effectiveness later

### Test Before Going Live

If possible:
1. Create a test schedule with new settings
2. Review for problems
3. Adjust if needed
4. Then apply to real schedule

### Involve Stakeholders

Before changing rules:
- Discuss with nursing leadership
- Get staff feedback (if appropriate)
- Consider union contracts (if applicable)
- Document approval

---

## Configuration Pages in the App

### Units Page (`/settings/units`)

**What you see:**
- List of all units
- Current settings for each

**What you can do:**
- Add new units
- Edit existing units
- Delete units (careful!)

### Holidays Page (`/settings/holidays`)

**What you see:**
- Calendar of holidays by year
- Day of week for each

**What you can do:**
- Add standard US holidays (one click)
- Add custom holidays
- Edit/delete holidays
- Switch between years

### Rules Page (`/rules`)

**What you see:**
- All hard and soft rules
- Their parameters and weights
- Active/inactive status

**What you can do:**
- View rule details
- Toggle rules on/off
- Adjust parameters and weights

---

## Summary

Configuration makes the scheduler work for YOUR hospital:

**Units** - Define areas and their specific rules
**Holidays** - Set special days for fairness tracking
**Rules** - Adjust parameters and priorities
**Census Bands** - Define staffing by patient count
**Shifts** - Create your shift templates

Start with defaults, make targeted changes, and document everything!

---

[Next: Using the App →](./09-using-the-app.md)
