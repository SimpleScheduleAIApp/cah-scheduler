# Understanding Shifts

[← Back to Index](./README.md) | [← Previous: Understanding Staff](./03-understanding-staff.md) | [Next: Scheduling Rules →](./05-scheduling-rules.md)

---

## What Is a Shift?

A **shift** is a specific time period when staff work. In healthcare, shifts are typically longer than in other industries.

---

## Common Shift Patterns

### 12-Hour Shifts (Most Common)

Most hospitals use 12-hour shifts:

| Shift Name | Hours | Duration |
|------------|-------|----------|
| **Day Shift** | 7:00 AM - 7:00 PM | 12 hours |
| **Night Shift** | 7:00 PM - 7:00 AM | 12 hours |

**Why 12-hour shifts?**
- Fewer handoffs (patient info transfers between nurses)
- Only 2 shift changes per day instead of 3
- Staff work fewer days per week (3 shifts = 36 hours)
- Patients see the same nurse longer

### 8-Hour Shifts (Less Common)

Some units use traditional 8-hour shifts:

| Shift Name | Hours | Duration |
|------------|-------|----------|
| **Days** | 7:00 AM - 3:00 PM | 8 hours |
| **Evenings** | 3:00 PM - 11:00 PM | 8 hours |
| **Nights** | 11:00 PM - 7:00 AM | 8 hours |

**When are 8-hour shifts used?**
- Administrative roles
- Some specialty areas
- When 12-hour shifts don't fit workflow

### On-Call Shifts

**What it means:** Staff isn't at the hospital but is available to come in if needed.

| Aspect | Details |
|--------|---------|
| **Location** | At home (or within responding distance) |
| **Compensation** | Reduced pay for being "on call" + full pay if called in |
| **Response Time** | Usually must arrive within 30-60 minutes |
| **Purpose** | Backup for emergencies, unexpected situations |

**Important:** On-call shifts **do not count** toward regular staffing. They're backup only.

---

## Shift Properties

Every shift in the schedule has these properties:

### 1. Date

When the shift occurs. Simple!

### 2. Shift Type

Day, Night, Evening, or On-Call.

### 3. Required Staff Count

How many people need to work this shift?

**Example:**
- Day shift on Monday: 4 nurses needed
- Night shift on Monday: 3 nurses needed (fewer patients awake)

### 4. Requires Charge Nurse

Does this shift need someone qualified to be "in charge"?

Almost always yes. Every shift needs leadership.

### 5. Census Tier

The nurse manager sets a **census tier** for each shift at the start of the day using the **Daily Census** page. The tier captures how busy the unit is and directly determines how many staff are required.

| Tier | Color | Meaning | Action |
|------|-------|---------|--------|
| **Blue** | 🔵 | Low occupancy | Low census protocol — some staff may be sent home |
| **Green** | 🟢 | Normal census | Standard staffing applies |
| **Yellow** | 🟡 | Elevated census | Call in extra staff |
| **Red** | 🔴 | Critical census | All hands on deck |

Each tier is backed by a **census band** record (configured under **Rules → Census Bands**) that specifies exactly how many RNs, LPNs, and CNAs are required.

---

## How Shifts Are Staffed

### Step 1: Set the Census Tier

The nurse manager opens the **Daily Census** page, selects the date, and picks a tier (🔵 Blue / 🟢 Green / 🟡 Yellow / 🔴 Red) for each shift. The tier's staffing requirements take effect immediately.

**Example:**
> Manager opens the Census page for Tuesday.
> Day Shift: 6 patients — selects 🟢 Green (Normal).
> Night Shift: 9 patients — selects 🟡 Yellow (Elevated).
> Green band requires 3 RNs + 1 CNA. Yellow band requires 4 RNs + 2 CNAs.

### Step 2: Make Assignments

The scheduler (or manager) assigns specific staff to the shift.

Each assignment tracks:
- **Who** is assigned
- **Is this overtime?** (are they over 40 hours?)
- **Are they the charge nurse?**
- **Are they floating?** (working outside home unit)
- **How did this assignment happen?** (scheduled, called in, swap, etc.)

### Step 3: Validate

Before finalizing, check:
- ✅ Enough staff?
- ✅ Charge nurse present?
- ✅ Proper skill mix?
- ✅ All hard rules satisfied?

---

## The Charge Nurse Role

Every shift typically has one **Charge Nurse**. This person:

| Responsibility | Example |
|----------------|---------|
| **Oversees the shift** | Makes sure everything runs smoothly |
| **Makes assignments** | "Maria, you have rooms 1-3. John, you have 4-6." |
| **Handles problems** | Patient complains, equipment breaks, etc. |
| **Coordinates admissions** | New patient coming? Assigns to appropriate nurse. |
| **Communicates up** | Reports issues to management |
| **Makes staffing decisions** | Census drops? Decides who goes home. |

**Scheduling rule:** At least one Charge Nurse-qualified person must be assigned to shifts that require it.

---

## Weekend and Holiday Shifts

### What's a Weekend Shift?

Any shift that falls on **Saturday or Sunday**.

**Why do we track weekend shifts?**
- Nobody wants to work every weekend
- Fair distribution keeps staff happy
- Unfair distribution leads to turnover

### What's a Holiday Shift?

Any shift on a designated **public holiday**:
- New Year's Day, Christmas, Thanksgiving, etc.
- The hospital defines which days count as holidays

**Why do we track holiday shifts?**
- Same fairness concerns as weekends
- Often comes with extra pay
- Need to ensure coverage on days many want off

---

## Shift Statuses

As time passes, assignments go through different statuses:

| Status | What It Means |
|--------|---------------|
| **Assigned** | Staff is scheduled for this shift |
| **Confirmed** | Staff has acknowledged/accepted the assignment |
| **Called Out** | Staff can't come - called in sick, emergency, etc. |
| **Swapped** | This assignment was traded with another staff |
| **Cancelled** | Assignment no longer needed (census drop) |
| **Flexed** | Staff was sent home early (low census) |

---

## A Day in the Life of a Shift

Let's follow a Day Shift on Tuesday, February 15th:

### 6:30 AM - Pre-Shift
Night shift reviews overnight events. Day shift nurses are arriving.

### 7:00 AM - Shift Start
Official handoff. Night nurses report to day nurses on each patient.
The Charge Nurse has already reviewed assignments (made earlier by the scheduler).

### 7:30 AM - Morning Rounds
Staff assess their patients, give medications, check vital signs.

### 10:00 AM - Crisis!
Nurse Sarah calls - she's stuck in traffic after a car accident. She'll be 2 hours late.
- Charge nurse notifies manager
- Manager checks scheduler: Who's available for partial coverage?
- Finds a PRN nurse who was off but available - calls them in

### 12:00 PM - Census Review
Hospital administrator checks patient counts across all units.
- ICU has 8 patients (High Census)
- Med-Surg has 3 patients (Low Census)
- Decision: "Float" one Med-Surg nurse to ICU

### 3:00 PM - Acuity Spike
Two ICU patients deteriorate rapidly.
- Charge nurse escalates to manager
- Manager sets Acuity to "Yellow"
- Calls in an additional nurse for the evening

### 6:30 PM - Shift Handoff Prep
Day nurses document their patients' status.
Night nurses arriving, getting report.

### 7:00 PM - Shift End
Night shift officially takes over. Day shift goes home.

---

## Understanding Overtime

**Overtime** = working more than 40 hours in a week.

| Scenario | Classification |
|----------|---------------|
| 0.9 FTE nurse works 38 hours | Normal - below both 36 and 40 |
| 0.9 FTE nurse works 40 hours | "Extra hours" (above 36), but NOT overtime |
| 0.9 FTE nurse works 44 hours | 4 hours of overtime (above 40) |
| 1.0 FTE nurse works 44 hours | 4 hours of overtime |

**Why does this matter?**
- Overtime is expensive (1.5x pay or more)
- But it's cheaper than agency staff
- The scheduler tries to minimize overtime while ensuring coverage

---

## Summary

Shifts are the building blocks of the schedule:

1. **Shift types** (Day, Night, On-Call) define when people work
2. **Staffing requirements** determine how many people are needed
3. **Census and acuity** adjust requirements in real-time
4. **Charge nurses** provide leadership each shift
5. **Weekends and holidays** need fair distribution
6. **Overtime** is tracked to manage costs

The scheduler creates assignments that:
- Fill all shift requirements
- Respect staff constraints
- Maintain fairness
- Minimize costs

---

[Next: Scheduling Rules →](./05-scheduling-rules.md)
