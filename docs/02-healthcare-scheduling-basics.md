# Healthcare Scheduling Basics

[← Back to Index](./README.md) | [← Previous: Introduction](./01-introduction.md) | [Next: Understanding Staff →](./03-understanding-staff.md)

---

## Why Is Healthcare Scheduling Different?

You might think, "Scheduling is scheduling - how hard can it be?" But healthcare scheduling is fundamentally different from scheduling at a retail store or restaurant. Here's why:

### 1. You Can't Just Close

A coffee shop can close at 9pm. A hospital cannot. Ever.

**24/7/365 coverage is mandatory.** Someone must always be there - even at 3am on Christmas morning when there might be zero patients. Why? Because the one emergency that does come in could be life or death.

### 2. Skills Matter (A Lot)

At a retail store, most employees can cover most tasks. In healthcare:

- A nurse who's great with adults might not be certified for pediatrics
- A new nurse cannot work alone in the ICU
- Only certain nurses can be "in charge" of a shift

You can't just put warm bodies in seats - you need the **right people** with the **right skills**.

### 3. Patient Loads Change Unpredictably

**Census** = the number of patients currently in the hospital.

Unlike a restaurant where you can predict "Saturday nights are busy," a hospital's patient count changes unpredictably:
- A car accident brings in 5 patients at once
- A flu outbreak fills beds
- A holiday weekend is surprisingly slow

The schedule needs to flex with these changes.

### 4. Fatigue Kills

An overtired barista might make a bad latte. An overtired nurse might make a medication error that kills someone.

**Rest requirements are literally life-and-death.** This is why there are strict rules about:
- Maximum hours worked
- Minimum rest between shifts
- Maximum consecutive days

### 5. The Regulatory Environment

Healthcare is heavily regulated. Staffing decisions must comply with:
- State nursing laws
- Hospital accreditation requirements
- Union contracts (if applicable)
- Patient safety standards

Every scheduling decision can be audited.

---

## The Scheduling Cycle

Most hospitals create schedules in **6-week cycles**. Here's how it typically works:

### Week 1-2: Preparation
1. **Staff Submit Availability** - PRN (per diem) staff indicate which days they can work
2. **Staff Submit Requests** - Everyone submits vacation requests, day-off preferences
3. **Manager Reviews** - Approves/denies leave requests

### Week 3-4: Schedule Creation
1. **Draft Schedule** - Manager (or software) creates initial schedule
2. **Review & Adjust** - Check for problems, make swaps
3. **Publish** - Make the schedule visible to all staff

### Week 5-6: Execution
1. **Daily Adjustments** - Handle callouts, sick calls, census changes
2. **Next Cycle Prep** - Start collecting info for the next period

---

## Key Concept: Census-Based Staffing

The number of staff you need depends on **how many patients you have**. This seems obvious, but the mechanics are important.

### Census Tiers

CAH Scheduler uses four color-coded **census tiers**. The nurse manager selects the appropriate tier on the **Census page** at the start of each shift, and the system automatically enforces the correct staffing requirements:

| Tier | Color | Meaning | Staffing Effect |
|------|-------|---------|-----------------|
| Blue | 🔵 | Low occupancy | Low census protocol — some staff may be sent home |
| Green | 🟢 | Normal census | Standard staffing applies |
| Yellow | 🟡 | Elevated census | Extra staff need to be called in |
| Red | 🔴 | Critical census | All hands on deck |

Each tier is backed by a **census band** record that specifies exactly how many RNs, LPNs, and CNAs are required. These thresholds are configured under **Rules → Census Bands**.

### Patient-to-Nurse Ratios

There's also a concept of **ratios** - how many patients one nurse can safely care for.

- **2:1 ratio** = 1 nurse for every 2 patients
- In an ICU (very sick patients), you might need 1:1 or even 2:1 (2 nurses per patient!)
- In a regular floor (stable patients), you might allow 5:1

These ratios aren't arbitrary - they're often set by state law or hospital policy based on patient acuity (how sick patients are).

---

## Key Concept: Acuity

**Acuity** = how sick/complex the patients are.

Even with the same number of patients, workload can vary dramatically:

| Low Acuity Day | High Acuity Day |
|----------------|-----------------|
| 6 stable patients | 6 patients on ventilators |
| Routine medications | Constant monitoring |
| Normal staffing | Need extra help! |

In CAH Scheduler, acuity is captured through the **census tier** system. The nurse manager visits the **Census page** at the start of each shift and selects a color tier that reflects both patient count and acuity:

- 🔵 **Blue** = Low occupancy — may send staff home
- 🟢 **Green** = Normal — standard staffing
- 🟡 **Yellow** = Elevated — call in extra staff
- 🔴 **Red** = Critical — all hands on deck

The selected tier's census band defines the exact staffing requirement for that shift.

---

## Key Concept: Units

A hospital is divided into **units** - specialized areas that care for different types of patients:

| Unit | What It Is | Typical Patients |
|------|------------|------------------|
| **ICU** (Intensive Care Unit) | Highest level of care | Critically ill, ventilators, post-surgery |
| **ER** (Emergency Room) | Entry point for emergencies | Anything! Trauma, heart attacks, broken bones |
| **Med-Surg** (Medical-Surgical) | General care floor | Stable patients, recovering from procedures |
| **OB** (Obstetrics) | Maternity | Pregnant women, newborns |
| **Peds** (Pediatrics) | Children's care | Patients under 18 |

**Why does this matter for scheduling?**
- Staff are trained for specific units
- A Med-Surg nurse might not be able to work ICU
- Each unit has its own staffing requirements

---

## The Fairness Challenge

Here's a scenario that illustrates why scheduling is hard:

**The Weekend Problem**

- Nobody wants to work weekends
- But weekends must be covered
- If you let people pick, senior staff will always take weekends off
- New staff will feel exploited and quit

**The Holiday Problem**

- Everyone wants Christmas off
- You can only let some people have it off
- How do you decide fairly?
- What about people who worked Christmas last year?

**The solution:** Track everything and enforce fair distribution. The scheduler:
1. Counts weekend shifts per person
2. Counts holiday shifts per person
3. Ensures roughly equal distribution
4. Takes "I worked Thanksgiving" into account for "Who gets Christmas off"

---

## What Makes Scheduling "Good"?

A good schedule balances multiple competing goals:

### 1. Coverage (Safety)
Every shift has enough qualified staff. No gaps.

### 2. Compliance (Legal)
All rules are followed:
- Rest time requirements
- Maximum hours
- Supervision requirements

### 3. Fairness (Staff Happiness)
- Weekend work is distributed evenly
- Preferences are honored when possible
- No one is always stuck with the worst shifts

### 4. Cost (Financial)
- Minimize expensive overtime
- Use regular staff before agency workers
- Right-size staffing to census (don't overstaffed)

### 5. Skill Mix (Quality)
- Each shift has experienced AND junior staff
- Charge nurse is always present when required
- Specialists are available when needed

**The scheduler optimizes all of these simultaneously.** That's why a computer can do it better than a human - there are too many variables to track manually.

---

## Summary

Healthcare scheduling is uniquely challenging because:
1. Coverage is 24/7/365 - no closing
2. Skills and certifications matter
3. Patient loads (census) change unpredictably
4. Fatigue has life-or-death consequences
5. Heavy regulation requires compliance
6. Fairness is essential for retention

The CAH Scheduler handles all of this by:
- Tracking staff skills and certifications
- Applying hard rules (safety) and soft rules (preferences)
- Adjusting to census changes
- Ensuring fair distribution of undesirable shifts
- Maintaining complete audit trails

---

[Next: Understanding Staff →](./03-understanding-staff.md)
