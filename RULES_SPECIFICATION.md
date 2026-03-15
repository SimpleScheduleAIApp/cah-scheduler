# CAH Scheduler - Complete Rules Specification

**Document Version:** 1.6.11
**Last Updated:** March 15, 2026 (v1.6.11)
**Purpose:** This document describes all scheduling rules and logic implemented in the CAH Scheduler application. Please review and mark any rules that need modification.

---

## Table of Contents
1. [Staff Attributes](#1-staff-attributes)
2. [Shift Types](#2-shift-types)
3. [Hard Rules (Must Not Be Violated)](#3-hard-rules-must-not-be-violated)
4. [Soft Rules (Preferences & Penalties)](#4-soft-rules-preferences--penalties)
5. [Unit Configuration Options](#5-unit-configuration-options)
6. [Census Bands & Staffing](#6-census-bands--staffing)
7. [Escalation & Callout Workflow](#7-escalation--callout-workflow)
8. [Low Census Policy](#8-low-census-policy)
9. [Assignment Attributes](#9-assignment-attributes)
10. [Special Features](#10-special-features)
11. [Application UI Guide](#11-application-ui-guide)
12. [Scheduling Algorithm](#12-scheduling-algorithm)

---

## 1. Staff Attributes

### 1.1 Roles
| Role | Description |
|------|-------------|
| **RN** | Registered Nurse |
| **LPN** | Licensed Practical Nurse |
| **CNA** | Certified Nursing Assistant |

### 1.2 Employment Types
| Type | Description |
|------|-------------|
| **Full Time** | Regular employee, typically 1.0 FTE (40 hours/week) |
| **Part Time** | Regular employee, less than 1.0 FTE |
| **Per Diem (PRN)** | Works on-demand, must submit availability in advance |
| **Float** | Works across multiple units, no fixed home unit |
| **Agency** | External/contract staff |

### 1.3 ICU Competency Levels
| Level | Name | Description | Restrictions |
|-------|------|-------------|--------------|
| **1** | Novice/Orientee | New hire in orientation period | Cannot take patients alone. Must be paired with Level 5 preceptor. FTE contribution = 0 for staffing calculations. |
| **2** | Advanced Beginner | Can handle stable patients | Can take Med-Surg/Swing Bed patients. Cannot work ICU/ER alone - must have Level 4+ supervisor on same shift. |
| **3** | Competent | Fully functional nurse | Can take standard ICU/ER patient load. Should have ACLS/PALS certification. |
| **4** | Proficient (Trauma Ready) | Experienced, can handle critical situations | TNCC certified. Can handle Codes/Trauma alone until backup arrives. **Stand-in Charge Nurse** when no Level 5 is available. |
| **5** | Expert (Charge/Preceptor) | Most experienced | **Primary Charge Nurse** (preferred). Can precept Level 1 staff. Can take the sickest patients. Can manage the unit. |

### 1.4 Other Staff Attributes
| Attribute | Description |
|-----------|-------------|
| **Home Unit** | The staff member's primary assigned unit (e.g., ICU, ER, Med-Surg) |
| **Cross-Trained Units** | Other units the staff is qualified to work in |
| **Charge Nurse Qualified** | Whether staff can serve as the shift's charge nurse |
| **Weekend Exempt** | If true, staff is exempt from weekend requirements (set by Admin only, for HR accommodations) |
| **Reliability Rating** | 1-5 scale indicating historical reliability |
| **FTE** | Full-Time Equivalent (1.0 = 40 hours/week, 0.5 = 20 hours/week) |
| **Flex Hours YTD** | Tracks how many hours staff has been flexed home (for fair rotation) |
| **Voluntary Flex Available** | If true, staff is willing to go home voluntarily during low census (VTO) |

---

## 2. Shift Types

### 2.1 Regular Shifts
| Shift | Default Hours | Counts Toward Staffing |
|-------|---------------|------------------------|
| **Day** | 07:00 - 19:00 (12 hours) | Yes |
| **Night** | 19:00 - 07:00 (12 hours) | Yes |
| **Evening** | 13:00 - 01:00 (12 hours) | Yes |

### 2.2 Special Shifts
| Shift | Description | Counts Toward Staffing |
|-------|-------------|------------------------|
| **On-Call** | Staff is available to be called in if needed | **No** - does not count toward census staffing requirements |

### 2.3 Acuity Levels (Set per shift by CNO/Manager)
| Level | Meaning | Effect |
|-------|---------|--------|
| **Green** | Normal acuity | Standard staffing |
| **Yellow** | Elevated acuity | +1 additional staff needed (configurable) |
| **Red** | High acuity/crisis | +2 additional staff needed (configurable) |

---

## 3. Hard Rules (Must Not Be Violated)

Hard rules are constraints that **cannot be broken**. The scheduler will not create assignments that violate these rules.

### 3.1 Minimum Staff Per Shift
- **Rule:** Each shift must meet the minimum staff count defined by either:
  - The shift definition's required staff count, OR
  - The census band requirements (if census is set)
- **Applies to:** All shifts where `countsTowardStaffing = true`

### 3.2 Charge Nurse Required
- **Rule:** If a shift requires a charge nurse, at least one assigned staff member must be marked as charge nurse for that shift, must have `isChargeNurseQualified = true`, and must have `icuCompetencyLevel ≥ 4`
- **Competency requirement:**
  - **Level 5** is the preferred (primary) charge nurse
  - **Level 4** may serve as stand-in charge nurse only when no Level 5 is available on the same shift
  - **Levels 1–3** can never be assigned as charge, even if `isChargeNurseQualified` is set in the database (the flag alone is not sufficient)
- **Applies to:** Shifts marked as `requiresChargeNurse = true`

### 3.3 Patient-to-Nurse Ratio
- **Rule:** The ratio of patients to RNs must not exceed the census band limit
- **Standard:** 2:1 ICU standard per AACN and state law — 1 RN for every 2 patients
- **Example:** If census band says 2:1 ratio and there are 8 patients, you need at least 4 RNs assigned
- **LPNs:** Do NOT count toward this ratio. In ICU settings, LPNs cannot substitute for RNs (scope-of-practice restrictions: no IV push medications, no admissions, no blood administration). LPNs are support staff only.
- **CNAs:** Do NOT count toward this ratio. CNA staffing levels are governed by the census band's `requiredCNAs` field (enforced by the min-staff rule) but are separate from the nurse:patient ratio.
- **Note:** This rule only fires for shifts where `actualCensus` is set directly. Shifts using the census tier system (`censusBandId` set) satisfy the ratio by band construction — each tier's `requiredRNs` is sized to satisfy 2:1 at the peak patient count for that tier.

### 3.4 Minimum Rest Between Shifts
- **Rule:** Staff must have at least **10 hours** of rest between the end of one shift and the start of the next
- **Purpose:** Prevents fatigue and ensures safety
- **Configurable:** Yes, default is 10 hours

### 3.5 Maximum Consecutive Days
- **Rule:** Staff cannot work more than **5 consecutive days** without a day off
- **Configurable:** Yes, default is 5 days

### 3.6 ICU Competency Minimum
- **Rule:** Staff assigned to ICU must have a minimum competency level of **2**
- **Purpose:** Level 1 staff cannot work ICU independently

### 3.7 Level 1 Preceptor Required *(NEW)*
- **Rule:** Any Level 1 (Novice/Orientee) staff member scheduled for a shift must have a Level 5 (Expert/Preceptor) staff member also assigned to the **same shift**
- **Purpose:** Orientees must always have a preceptor present

### 3.8 Level 2 ICU/ER Supervision Required *(NEW)*
- **Rule:** Level 2 (Advanced Beginner) staff working in **ICU or ER** must have at least one Level 4 or Level 5 staff member on the same shift
- **Purpose:** Advanced beginners need supervision in critical care areas
- **Applies to units:** ICU, ER, ED, Emergency (exact word match on unit name)
- **Note:** Unit matching uses word-boundary comparison, not substring matching. A unit named "Med-Surg" does **not** trigger this rule — "MED-SURG" must contain one of the supervised unit names as a complete word (e.g., "ICU", "ER", "ED", "EMERGENCY"). This prevents false positives on units whose names happen to contain supervised unit abbreviations as substrings.

### 3.9 No Overlapping Shifts *(NEW)*
- **Rule:** A staff member cannot be assigned to two shifts that overlap in time
- **Example:** Cannot be assigned to Day shift (07:00-19:00) and Evening shift (13:00-01:00) on the same day

### 3.10 PRN Availability *(NEW)*
- **Rule:** Per Diem (PRN) staff can **only** be scheduled on days they have marked as available
- **Process:** PRN staff submit their availability for each schedule period (6 weeks out)
- **Note:** If a PRN staff member has not submitted availability, they cannot be scheduled

### 3.11 Staff On Leave *(NEW)*
- **Rule:** Staff with **approved leave** cannot be scheduled during their leave period
- **Leave Types:** Vacation, Sick, Maternity, Medical, Personal, Bereavement, Other
- **Note:** Only approved leave blocks scheduling; pending leave requests do not

### 3.12 On-Call Limits *(NEW)*
- **Rule:** Staff cannot exceed on-call limits:
  - Maximum **1 on-call shift per week** (configurable)
  - Maximum **1 on-call weekend per month** (configurable)
- **Purpose:** Prevents burnout from excessive on-call duty

### 3.13 Maximum 60 Hours in 7 Days *(NEW)*
- **Rule:** Staff cannot work more than **60 hours** in any rolling 7-day period
- **Calculation:** The system checks **all 7 rolling windows that contain the candidate shift date** — not just the backward-looking window — to correctly account for shifts already assigned on future dates. This is important because the scheduler processes the most-constrained shifts first, which may place future-dated assignments before earlier-dated ones are processed.
- **Purpose:** Safety limit to prevent extreme fatigue

---

## 4. Soft Rules (Preferences & Penalties)

Soft rules are **preferences** that the scheduler tries to optimize. Violations incur penalty scores, and the scheduler tries to minimize total penalties. These can be overridden by managers when necessary.

### 4.1 Overtime *(UPDATED)*
**Previous Logic (Incorrect):** Any hours over (FTE × 40) counted as overtime; violation was attached staff-level (not to a specific shift)

**Current Logic:**
| Scenario | Rule Name | Penalty Level | Example |
|----------|-----------|---------------|---------|
| Hours > 40 in a week | **"Overtime"** | **HIGH** (cost) | A 1.0 FTE nurse working 44h = 4h OT at 1.5× pay |
| Hours > (FTE × 40) but ≤ 40 | **"Extra Hours Above FTE"** | **LOW** (preference) | A 0.9 FTE nurse (36h/week) working 40h = 4 extra hours at regular pay |

**Why two separate rule names?**
Only hours above 40 trigger FLSA 1.5× overtime pay — a direct payroll cost increase. Hours above the FTE target but still at or below 40h are paid at the regular rate; they are a scheduling preference concern (over-scheduling a part-time nurse), not a cost concern. Keeping them visually separate prevents managers from treating a "Extra Hours Above FTE" flag with the same urgency as a true overtime flag.

**Exemption:** Staff with **FTE = 0** (Agency / on-demand) are **fully exempt** from both sub-rules. They have no weekly hours commitment, so no "standard" or "overtime" threshold applies.

**Violation Attribution:** Each violation is emitted on the **specific shift that crosses or extends past the threshold**. For actual overtime, only the one shift that first pushes past 40h is flagged (once per week). For extra hours, every shift in the above-FTE zone is flagged with its marginal contribution, so managers can see which assignments are compounding the over-scheduling.

**Penalty Weights:**
- Actual OT (>40h): Weight = 1.0 (normalized so 12h OT = 1.0 penalty)
- Extra hours (above FTE, ≤40h): Weight = 0.3

### 4.2 Weekend Shifts Required *(UPDATED)*
- **Rule:** Each staff member must work a minimum number of weekend shifts per schedule period
- **Default:** 3 weekend shifts per 6-week schedule
- **Configurable:** Yes, per unit
- **Exemption:** Staff marked as "Weekend Exempt" are excluded

**How violations are raised (current logic):**
The rule flags assignments **beyond** the required count — i.e., excess weekend shifts — rather than flagging a shortfall. Assignments up to the required count are accepted without penalty. Each assignment beyond that limit generates one violation, attached to that specific shift. This means:
- The violation appears on the exact shift that is "one too many", making it easy to identify which assignment to remove or swap
- A staff member with exactly the required number of weekend shifts has zero violations — they are meeting the target
- A staff member with fewer than the required count has no violation either; shortfall is handled through the scheduler's optimisation pressure (preferring to assign that person on weekends when possible), not through explicit penalties

**Penalty per excess shift:** 0.5 per weekend shift beyond the required count

### 4.3 Consecutive Weekends Penalty *(NEW)*
- **Rule:** Penalize staff who work more than the maximum consecutive weekends
- **Default Maximum:** 2 consecutive weekends
- **Penalty:** Applied per extra consecutive weekend (0.8 per weekend over the limit)
- **Purpose:** Ensures weekends are distributed fairly over time
- **Weekend definition:** Saturday and Sunday of the same calendar weekend count as **one weekend**, not two. Working both days of the same weekend does not increment the consecutive weekend counter twice.

### 4.4 Holiday Fairness *(UPDATED)*
- **Rule:** Holiday shifts should be distributed fairly among staff **annually** (not per schedule period)
- **Tracking:** System maintains `staff_holiday_assignment` table to track yearly holiday assignments
- **Holiday Grouping:** Certain holidays are grouped together as one:
  - **Christmas:** Christmas Eve and Christmas Day count as ONE "Christmas" holiday. Working either day counts as "worked Christmas."
- **Penalties:**
  - Staff below yearly average: Penalty proportional to shortfall
  - Staff significantly above yearly average: Small penalty
- **Holidays Tracked:** New Year's Day, MLK Day, Presidents' Day, Memorial Day, Independence Day, Labor Day, Thanksgiving, Christmas (Eve + Day combined)

### 4.5 Staff Preference Match
- **Rule:** Try to match staff to their preferred shifts and days
- **Preferences Tracked:**
  - Preferred shift type (Day, Night, Evening, Any)
  - Max hours per week
  - Max consecutive days
  - Preferred days off
  - Preferred pattern (e.g., "3on-4off", "4on-3off")
- **Penalty:** Applied when assignments don't match preferences

### 4.6 Float Penalty *(NEW)*
- **Rule:** Minimize floating staff to units other than their home unit
- **Penalty Levels:**
  | Scenario | Penalty |
  |----------|---------|
  | Float to unit where staff IS cross-trained | Low (0.3) |
  | Float to unit where staff is NOT cross-trained | High (1.0) |
- **Purpose:** Staff prefer working in familiar environments; cross-training makes floating less disruptive

### 4.7 Charge Nurse Distribution *(NEW)*
- **Rule:** Prevent too many charge-qualified nurses from clustering on the same shift
- **Logic:**
  1. Calculate average charge-qualified nurses per shift
  2. If a shift exceeds (average + 1), apply penalty
  3. Minimum threshold of 2
- **Purpose:** Keep charge nurses distributed so there's backup coverage across shifts

### 4.8 Skill Mix Diversity
- **Rule:** Each shift should have a mix of experience levels
- **Purpose:** Avoid having all senior or all junior staff on one shift
- **Penalty:** Applied when skill mix is unbalanced

---

## 5. Unit Configuration Options

Each unit (ICU, ER, Med-Surg, etc.) can have its own configuration:

| Setting | Description | Default |
|---------|-------------|---------|
| **Weekend Rule Type** | "count_per_period" or "alternate_weekends" | count_per_period |
| **Weekend Shifts Required** | Number of weekend shifts required per schedule period | 3 |
| **Schedule Period Weeks** | Length of scheduling period in weeks | 6 |
| **Holiday Shifts Required** | Minimum holiday shifts per period | 1 |
| **Max Consecutive Weekends** | Maximum consecutive weekends before penalty | 2 |
| **Escalation Sequence** | Order to try when filling callouts | Float → Per Diem → Overtime → Agency |
| **Acuity Yellow Extra Staff** | Additional staff needed at Yellow acuity | 1 |
| **Acuity Red Extra Staff** | Additional staff needed at Red acuity | 2 |
| **Low Census Order** | Order to send home during low census | Voluntary → Overtime → Per Diem → Full Time |
| **Callout Threshold Days** | Days before shift to classify as callout vs open shift | 7 |
| **OT Approval Threshold** | Hours of OT requiring CNO approval | 4 |
| **Max On-Call Per Week** | Maximum on-call shifts per week | 1 |
| **Max On-Call Weekends Per Month** | Maximum on-call weekends per month | 1 |

---

## 6. Census Bands & Staffing

Census bands define staffing requirements based on patient count:

### ICU Census Tiers (current seed values)

The census system uses four color tiers. Each tier's `requiredRNs` is sized to satisfy the 2:1 RN:patient ratio at the **peak** patient count for that tier. The manager selects a tier on the **Daily Census page** (`/census`); the system applies the band's staffing requirements directly.

| Tier | Color | Patients | Required RNs | Required LPNs | Required CNAs | Charge Nurses (in RN count) | Ratio |
|------|-------|----------|--------------|---------------|---------------|-----------------------------|-------|
| Blue | 🔵 Low Census | 1-4 | 2 | 0 | 0 | 1 | 2:1 |
| Green | 🟢 Normal | 5-8 | 4 | 0 | 1 | 1 | 2:1 |
| Yellow | 🟡 Elevated | 9-10 | 5 | 0 | 1 | 1 | 2:1 |
| Red | 🔴 Critical | 11-12 | 6 | 0 | 2 | 1 | 2:1 |

**Note:** Patient-to-nurse ratio is RN-only for ICU per AACN standard. LPNs do NOT count toward this ratio (scope-of-practice restriction: no IV push, no admissions, no blood administration in ICU). Census bands are viewable and editable under **Rules → Census Bands** tab.

---

## 7. Escalation & Coverage Workflow

The system handles coverage needs differently based on timing:

### 7.1 Callouts (Urgent - Within 7 Days)

When a staff member calls out or leave is approved within the callout threshold (default: 7 days), the system creates a **Callout** record. The manager follows the escalation sequence manually.

**Default Escalation Sequence:**
1. **Float Pool** - Check if float staff are available
2. **Per Diem (PRN)** - Contact available per diem staff
3. **Overtime** - Offer overtime to regular staff
4. **Agency** - Call agency as last resort

**Callout Reasons Tracked:**
- Sick
- Family Emergency
- Personal
- No Show
- Other

**Callout Statuses:**
- **Open** - Not yet filled
- **Filled** - Replacement found
- **Unfilled Approved** - Approved to run short-staffed

### 7.2 Coverage Requests (Advance Notice - Beyond 7 Days) *(NEW in v1.2.1)*

When leave is approved more than 7 days before the shift, the system **automatically finds replacement candidates** and presents them for manager approval.

**Automatic Candidate Finding Process:**
1. System searches for available staff following the escalation ladder
2. For each potential candidate, the system checks:
   - Availability (not on leave, not already assigned)
   - Qualifications (unit, competency level)
   - Hours worked this week (overtime check)
   - Rest requirements (10-hour minimum)
   - 60-hour weekly limit
3. Top 3 candidates are ranked and presented with reasons

**Candidate Ranking Criteria:**
| Source | Priority Score | Notes |
|--------|---------------|-------|
| Float Pool | Highest (100+) | Designed for coverage |
| PRN (Available) | High (80+) | Marked date as available |
| Regular Staff (OT) | Medium (60+) | Overtime may apply |
| Agency | Lowest (10) | External, highest cost |

**Within each source, candidates are ranked by:**
- Unit qualification (home unit > cross-trained)
- Competency level (higher = better)
- Reliability rating (1-5 scale)
- Flex hours YTD (lower = fairer distribution)

**Reasons Provided for Each Candidate:**
Each candidate recommendation includes explanatory reasons such as:
- "Float pool staff - designed for coverage"
- "Cross-trained for ICU"
- "PRN staff - marked available for this date"
- "High reliability rating (5/5)"
- "No overtime (within 40 hours)"
- "Low flex hours YTD (fair distribution)"

**Coverage Request Statuses:**
- **Pending Approval** - Waiting for manager to select a candidate
- **Approved** - Manager approved, assignment created
- **Filled** - Assignment confirmed and active
- **Cancelled** - Request cancelled
- **No Candidates** - No suitable candidates found (manual intervention needed)

---

## 8. Low Census Policy

When census drops and staff need to be sent home, follow this order:

### Default Low Census Order:
1. **Voluntary (VTO)** - Staff who have indicated willingness to go home (Voluntary Time Off)
2. **Overtime** - Send home staff on OT
3. **Per Diem** - Send home PRN staff
4. **Full Time** - Send home full-time staff (rotated fairly based on Flex Hours YTD)

**Note:** Agency staff are not included in the low census order because agency contracts typically guarantee minimum hours. Sending agency home may still incur costs.

### Voluntary Time Off (VTO):
- Staff can indicate they are "Available for VTO" via the Staff page
- These staff are prioritized first when low census requires sending people home
- VTO is voluntary and based on staff preference
- VTO indicator can be toggled on/off by staff or managers

### Flex Tracking:
- System tracks flex hours year-to-date per staff member
- Used to ensure fair rotation of who gets sent home
- Staff with fewer flex hours YTD are more likely to be flexed next
- Within each category (VTO, OT, PRN, FT), staff are sorted by flex hours YTD (lowest first)

---

## 9. Assignment Attributes

Each assignment (staff → shift) tracks:

| Attribute | Description |
|-----------|-------------|
| **Is Charge Nurse** | Whether this person is charge for this shift |
| **Is Overtime** | Whether this assignment is overtime |
| **Assignment Source** | How the assignment was created: Manual, Auto-Generated, Swap, Callout Replacement, Float, Agency Manual, Pull Back |
| **Is Float** | Whether staff is working outside their home unit |
| **Float From Unit** | Original unit if floating |
| **Safe Harbor Invoked** | If nurse accepted assignment under protest (Texas law) |
| **Agency Reason** | For agency: Callout, Acuity Spike, or Vacancy |
| **Status** | Assigned, Confirmed, Called Out, Swapped, Cancelled, Flexed |

---

## 10. Special Features

### 10.1 Shift Swap Requests
- Staff can request to swap shifts with each other
- Swaps require manager approval
- System validates that swap doesn't violate hard rules

### 10.2 Safe Harbor (Texas Law)
- Nurses can accept an assignment "under protest" if they feel it's unsafe
- This is tracked for legal/compliance purposes
- Links to a Safe Harbor form ID

### 10.3 Sitters
- Each shift can specify number of 1:1 sitters needed
- Sitters add to CNA requirements

---

## 11. Application UI Guide

The CAH Scheduler application provides the following pages for managing scheduling:

### 11.1 Main Pages

| Page | URL | Description |
|------|-----|-------------|
| **Setup** | `/setup` | Import data from Excel - upload staff, units, and holidays from a spreadsheet |
| **Dashboard** | `/dashboard` | Overview of current schedule status, pending items, and key metrics |
| **Staff** | `/staff` | Manage all staff members - add, edit, view competency levels, employment types, certifications |
| **Schedule** | `/schedule` | View and edit the schedule grid, make assignments, see coverage |
| **Scenarios** | `/scenarios` | Compare different scheduling scenarios and their scores |
| **Callouts** | `/callouts` | Log and manage staff callouts, track replacements and escalation |
| **Coverage** | `/open-shifts` | Review and approve replacement candidates for shifts needing coverage (auto-recommended by system) |
| **Audit Trail** | `/audit` | View all changes made to the system with timestamps and details |

### 11.2 Request Management Pages

| Page | URL | Description |
|------|-----|-------------|
| **Leave Management** | `/leave` | View, approve, or deny leave requests (vacation, sick, maternity, etc.). Create new leave requests for staff. Filter by status: All, Pending, Approved, Denied. **When leave is approved, affected shifts automatically have replacement candidates found.** |
| **Coverage** | `/open-shifts` | Review auto-recommended replacement candidates for shifts needing coverage. Shows top 3 candidates with reasons. Manager approves one candidate to auto-create the assignment. Filter by: Pending, Filled, Cancelled, All. |
| **Shift Swaps** | `/swaps` | View, approve, or deny shift swap requests between staff. Shows requesting staff, their shift, target staff, and target shift. |
| **PRN Availability** | `/availability` | View per-diem (PRN) staff availability submissions. See which dates each PRN staff is available. Highlights staff who haven't submitted availability yet. |

### 11.3 Configuration Pages

| Page | URL | Description |
|------|-----|-------------|
| **Rules** | `/rules` | View and configure scheduling rules (hard rules and soft rules with penalties) |
| **Unit Configuration** | `/settings/units` | Configure per-unit settings including: weekend shift requirements, holiday requirements, callout escalation order, low census order, acuity staffing levels, OT approval thresholds, on-call limits |
| **Holidays** | `/settings/holidays` | Manage public holidays that affect scheduling. Add standard US holidays with one click. Holidays affect fairness calculations. |

### 11.4 Navigation

All pages are accessible from the left sidebar. The navigation order is:
1. Dashboard
2. Staff
3. Schedule
4. Scenarios
5. Callouts
6. Coverage
7. Leave
8. Shift Swaps
9. PRN Availability
10. Rules
11. Units
12. Holidays
13. Audit Trail
14. Setup (Import/Export Data)

### 11.5 Common Actions

| Action | Where | How |
|--------|-------|-----|
| **Import Data from Excel** | `/setup` | Download template, fill with your data, upload, review preview, click "Import Data" |
| **Download Excel Template** | `/setup` | Click "Download Template" to get pre-formatted spreadsheet |
| **Approve/Deny Leave** | `/leave` | Click "Approve" or "Deny" button on pending requests. Approval auto-finds replacement candidates for affected assignments. |
| **Approve Coverage** | `/open-shifts` | Click "Review" to see top 3 candidates with reasons, then click "Approve" on your choice |
| **View Staff Calendar** | `/staff` | Click on a staff member's name to see their day-by-day calendar view |
| **Approve/Deny Swap** | `/swaps` | Click "Approve" or "Deny" button on pending swap requests |
| **Create Leave Request** | `/leave` | Click "New Leave Request" button, fill form |
| **View PRN Availability** | `/availability` | See calendar of available dates per PRN staff |
| **Configure Unit Rules** | `/settings/units` | Click "Edit" on a unit to modify its scheduling rules |
| **Add Holidays** | `/settings/holidays` | Click "Add Standard Holidays" for US holidays or "Add Holiday" for custom |
| **Log Callout** | `/callouts` | Click "Log Callout" and follow escalation workflow |
| **View Audit History** | `/audit` | Filter by action type, date range, or entity |
| **Set Shift Census Tier** | `/census` | Go to the Daily Census page, pick the date, and select a color tier (Blue/Green/Yellow/Red) per shift — staffing requirements update immediately |
| **View Staff Preferences** | `/staff` | Click on a staff member's name to open detail dialog - see shift preferences, max hours, preferred days off, etc. |
| **Export Data to Excel** | `/setup` | Click "Export Data" to download current database data (Staff, Units, Holidays, Census Bands) as Excel file |

---

## Review Checklist

Please review each section and note any changes needed:

- [ ] Section 1: Staff Attributes - Any changes to roles, employment types, or competency levels?
- [ ] Section 2: Shift Types - Any changes to shift definitions or acuity levels?
- [ ] Section 3: Hard Rules - Any rules to add/remove/modify? Are all 13 rules correct?
- [ ] Section 4: Soft Rules - Any rules to add/remove/modify? Penalty weights correct?
- [ ] Section 5: Unit Configuration - Any settings to add/change defaults?
- [ ] Section 6: Census Bands - Staffing ratios correct for your units?
- [ ] Section 7: Escalation Workflow - Callout escalation sequence correct?
- [ ] Section 8: Low Census Policy - Order for sending staff home correct?
- [ ] Section 9: Assignment Attributes - Any additional tracking needed?
- [ ] Section 10: Special Features - Any features missing?
- [ ] Section 11: UI Guide - Any additional pages or features needed?

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Feb 2026 | Initial document with all rules and configuration options |
| 1.1 | Feb 13, 2026 | Added Section 11 (Application UI Guide) documenting all available pages: Leave Management, Shift Swaps, PRN Availability, Unit Configuration, and Holidays Management |
| 1.2 | Feb 15, 2026 | **Major updates based on expert feedback:** (1) Holiday fairness now tracks annually, Christmas Eve/Day merged as one holiday; (2) Low census order updated - removed Agency, added Voluntary Time Off (VTO); (3) Added Coverage page for managing shifts needing coverage; (4) Leave approval now auto-creates coverage requests for affected assignments; (5) Staff page now shows clickable calendar view for each staff member; (6) Added callout threshold days configuration |
| 1.2.1 | Feb 15, 2026 | **Coverage auto-fill workflow:** Leave approval (> 7 days) now automatically finds top 3 replacement candidates instead of creating manual open shifts. Each candidate includes reasons (e.g., "Cross-trained for ICU", "High reliability"). Manager reviews and approves, assignment is auto-created. Renamed "Open Shifts" to "Coverage" in navigation. |
| 1.2.2 | Feb 16, 2026 | **Census & Preferences visibility:** (1) Census input added to shift assignment dialog - determines required staffing via census bands; (2) Staff count display fixed to show scheduled/required based on census; (3) Staff detail dialog now shows shift preferences; (4) Census Bands added to Excel import/export |
| 1.2.3 | Feb 18, 2026 | **Staff preferences in Excel:** Staff preferences can now be imported/exported via Excel. New columns in Staff sheet: Preferred Shift, Preferred Days Off, Max Consecutive Days, Max Hours Per Week, Avoid Weekends |
| 1.3.0 | Feb 20, 2026 | **Section 12 added:** Scheduling Algorithm — describes greedy construction, local search, three weight profiles, hard rule eligibility, soft penalty scoring, understaffing handling, and audit behavior for automated schedule generation |
| 1.4.0 | Feb 20, 2026 | **Charge nurse competency (§1.3, §3.2):** Level 4+ is now a hard requirement for charge nurse assignment. Level 5 is the preferred primary charge; Level 4 is stand-in only. `isChargeNurseQualified` flag alone is insufficient for levels 1–3. **60h rolling window (§3.13):** System now checks all 7 windows containing the shift date, not just the backward-looking window, to catch violations caused by future shifts assigned earlier in the greedy pass. |
| 1.4.2 | Feb 20, 2026 | **Overtime rule (§4.1):** Violations now attach to the specific shift that crosses the threshold, not staff-level. Agency/on-demand staff with FTE = 0 are exempt. **Weekend rule (§4.2):** Logic flipped from flagging shortfall to flagging excess assignments beyond the required count; each excess assignment is flagged with a shift-specific violation. Both changes make the violations panel actionable — each flagged shift shows exactly which assignment to review. |
| 1.4.3 | Feb 22, 2026 | **Balanced OT weight (§12.5):** Raised from 1.0 to 1.5 so actual overtime is consistently more expensive than any single preference violation, matching the real 1.5× payroll cost. **Capacity-spreading bonus (§12.4):** Small incentive added to prefer less-loaded staff as a tiebreaker, reducing overtime accumulation on regular staff and preserving float pool capacity. |
| 1.4.4 | Feb 22, 2026 | **Assignment dialog charge validation (§3.2):** `needsCharge` condition now requires Level 4+ (not just any `isChargeNurse` flag). "Assign as Charge" button is gated to Level 4+ nurses. Assigning a new charge nurse demotes any previous charge on the same shift so the hard violation resolves immediately. |
| 1.4.10 | Feb 22, 2026 | **Local search collective constraint guards (§12.2):** Two gaps in `isSwapValid` allowed the local search to undo repair-phase fixes. (1) Non-charge-qualified staff could inherit `isChargeNurse = true` via object spread. (2) Swapping a Level 4+ nurse out of an ICU/ER shift could leave Level 2 nurses without supervision. Both are now blocked before individual `passesHardRules` checks run. |
| 1.4.5 | Feb 22, 2026 | **Charge protection guard (§12.2):** Look-ahead added to greedy Pass 2 — Level 4+ nurses are protected from regular slots when they are the sole remaining charge candidate for an upcoming ICU/ER shift within 7 days. Eliminates Sunday hard violations in the FAIR schedule caused by the low overtime weight exhausting charge nurses. **PRN availability (§3.10):** Lookup broadened to aggregate across all schedule submissions; standing availability is honoured by any new schedule covering the same dates. **Cost-Optimized float weight (§12.5):** Corrected 3.0 → 2.0 to reflect that float differentials cost less than overtime. |
| 1.4.6 | Feb 22, 2026 | **Agency penalty added (§12.4, §12.5):** New `agency` weight component applies a flat penalty whenever an agency nurse is considered for a slot. Ensures the scheduler exhausts regular, float, and PRN pools before drawing on agency (markup 2–3× base pay). Weights: Balanced 2.5, Fairness-Optimized 1.5, Cost-Optimized 5.0. **PRN Available Days column in Excel (§3.10):** Import template and export now include a "PRN Available Days" column for per_diem staff. Accepted formats: comma-separated day abbreviations (e.g. "Mon, Wed, Fri"), "Weekdays", "Weekends", or "All". Importing this column auto-creates `prn_availability` records spanning the next 12 months — PRN staff are immediately usable in auto-generated schedules without a manual availability submission step. |
| 1.4.7 | Feb 22, 2026 | **Weekend ICU charge shifts prioritised first in greedy (§12.2):** Weekend charge slots (Sat/Sun) were previously sorted after all weekday charge slots (earliest date first within priority 1). In the FAIR profile — where the low overtime weight allows charge nurses to accumulate hours freely Mon–Fri — this meant weekend slots arrived last with the charge pool already near its 60h rolling limit. Splitting priority 1 into weekend-ICU-charge (new priority 1) and weekday-ICU-charge (priority 2) ensures Sat/Sun charge shifts get first pick of Level 4+ nurses before any weekday shift has consumed their capacity. Applies to all three schedule variants; Balanced and Cost-Optimized are unaffected in practice because their higher overtime penalties already prevent charge-pool depletion. |
| 1.4.3 | Feb 22, 2026 | **Scheduler penalty re-calibration (§12.4, §12.5):** (1) Balanced variant `overtime` weight raised from 1.0 → 1.5, making actual OT (a real 1.5× payroll cost) consistently more expensive than any single preference violation. (2) Capacity-spreading bonus added to the scoring function: a small incentive (−`overtime_weight × 0.1 × remaining_hours/40`) prefers staff with more remaining hours before the 40h threshold. Acts as a tiebreaker that naturally spreads assignments across the week, reduces temporal depletion of float pool capacity, and decreases unnecessary overtime on regular unit staff. |
| 1.4.13 | Feb 23, 2026 | **OT badge calendar order (§12.3):** `recomputeOvertimeFlags()` pass added after local search so the `isOvertime` flag reflects calendar order, not greedy construction order. Manual assignment API now computes `isOvertime` server-side (was always `false`). |
| 1.4.14 | Feb 23, 2026 | **Overtime vs Extra Hours display split (§4.1):** Violations now emitted under two distinct rule names: `"Overtime"` (>40h/week, direct 1.5× payroll cost) and `"Extra Hours Above FTE"` (above FTE target but ≤40h, regular pay rate, scheduling preference concern). Previously both appeared as `"Overtime & Extra Hours"`, which overstated the urgency of extra-hours flags and caused the same count to appear in both cost and preference categories. |
| 1.4.15 | Feb 23, 2026 | **Cross-schedule weekend fairness (§12.4):** Scheduler now seeds the weekend count from the prior schedule period. At context-build time, `buildContext()` queries all weekend assignments in the one-period lookback window before the new schedule starts and stores per-staff counts as `historicalWeekendCounts`. `softPenalty()` adds these to the in-schedule count before applying the bonus/penalty. Nurses who hit their quota last period start the new period "already at quota" and are deprioritised for weekend slots; nurses who were below quota get the full assignment bonus. Prevents the deterministic greedy algorithm from assigning the same nurses to weekends every period. |
| 1.5.0 | Mar 3, 2026 | **Daily Census page (§3.1, §3.3):** Added dedicated Census Management page at `/census`. Nurse manager selects a color tier (🔵 Blue/🟢 Green/🟡 Yellow/🔴 Red) per shift instead of entering a numeric patient count. Selecting a tier sets both `acuityLevel` and `censusBandId` on the shift. The min-staff rule uses `censusBandId` for direct band lookup (priority over legacy `actualCensus` range search). `acuityExtraStaff` is zeroed when a tier is selected to prevent double-counting. Added `color` column to census_band table. Removed census input from assignment dialog; replaced with read-only tier badge. |
| 1.5.1 | Mar 3, 2026 | **Patient ratio rule corrected to RN-only (§3.3):** The 2:1 ICU nurse:patient ratio is RN-to-patient per AACN standard. Previous implementation counted RN + LPN as "licensed staff" — corrected to count RNs only. LPNs remain assignable as support staff (count toward total headcount) but do not satisfy the RN:patient ratio. **Census band staffing numbers corrected:** ICU bands redesigned so `requiredRNs` alone satisfies strict 2:1 at the peak patient count for each tier: Blue 1–4 pts → 2 RNs; Green 5–8 pts → 4 RNs; Yellow 9–10 pts → 5 RNs; Red 11–12 pts → 6 RNs. `requiredLPNs` set to 0 for ICU (LPN scope-of-practice does not extend to ICU-level RN duties). **Census Bands now editable in UI** (Rules → Census Bands tab) — inline edit per row using existing PUT API. Charge Nurses column labelled "(in RN count)" to clarify it is not an extra headcount. |
| 1.5.2 | Mar 4, 2026 | **Census page UX (§11):** Unset shifts now default to Green tier on page load so managers don't have to manually select Green for every shift. Band Thresholds tab shows tier color labels ("Blue — Low Census", "Green — Normal", etc.) with correct colored dots instead of raw DB band names. Rules page Census Bands tab shows the same tier labels. **Schedule API required count (§3.1):** `getEffectiveRequired()` now checks `censusBandId` first (direct band lookup, no `Math.max` — allows Blue tier to legitimately reduce below base staffing level), then falls back to `acuityLevel`+unit color match, then `actualCensus` range lookup (which keeps `Math.max` as floor). |
| 1.5.3 | Mar 4, 2026 | **Seed and 3-priority fallback (§3.1):** All seeded shifts now carry `censusBandId` matching their `acuityLevel`. Schedule API `getEffectiveRequired()` extended to a 3-priority fallback: (1) `censusBandId` direct ID lookup, (2) `acuityLevel`+unit color match (handles stale IDs after re-seed), (3) `actualCensus` range lookup. Prevents display of wrong required count when DB is reseeded or `censusBandId` is stale. |
| 1.5.4 | Mar 4, 2026 | **Excel import preserves census tiers (§6):** Census band import gains a `color` field; parser reads "Color"/"Tier" column and falls back to sort-order derivation when column is absent. Export includes "Color" column and a Census Bands sheet in the template. **New schedules default to Green (§3.1):** When a new schedule is created, every shift is seeded with `acuityLevel="green"` and the corresponding `censusBandId`, so census-band-aware staffing applies from day one without requiring a Census page visit. |
| 1.5.5 | Mar 4, 2026 | **Scheduler targets census-band-required count (§12.2, §12.6):** Critical bug fixed — the greedy scheduler and repair phase both use `shift.requiredStaffCount + shift.acuityExtraStaff` from the build context. When a census tier was selected (`censusBandId` set), `acuityExtraStaff` was correctly 0 but `requiredStaffCount` still held the shift definition's base value (e.g. 4 for Day, 3 for Night) rather than the band total (e.g. 5 for Green = 4 RNs + 1 CNA). `buildContext()` now adds a post-load pass that overrides `requiredStaffCount` with `band.requiredRNs + band.requiredCNAs` for every shift with `censusBandId` set, and zeros `acuityExtraStaff`. Scheduler now correctly fills 5 staff per shift when Green tier is active. |
| 1.5.6 | Mar 4, 2026 | **Output validation utility (§12.6):** `checkForUnexplainedUnderstaffing()` added — a pure function that scans the scheduler's understaffed output and flags any shift where (a) no hard-rule rejection reasons were documented AND (b) enough potentially available staff existed. A non-empty result is a signal of a scheduler logic bug. Called after each Balanced generation; result logged to audit trail. **Tests block build:** `npm run test` added to the build script so all 399 tests must pass before a deployment can proceed. **Seed FK order fixed:** `open_shift`, `generation_job`, and `staff_holiday_assignment` now deleted before their parent tables, fixing a FK constraint error on re-seed when Open Shifts had been used through the UI. |
| 1.6.11 | Mar 15, 2026 | **Violation modal restructured (UI only, no rule change):** The shift violations modal no longer shows a separate "Staff Schedule Issues" orange section. Schedule-wide soft violations (consecutive weekends, overtime) now appear in the single "Soft Rule Violations" section with a "Schedule-wide" badge so managers can distinguish them from shift-specific violations. Rule behaviour and penalty scoring are unchanged. |
| 1.6.10 | Mar 15, 2026 | **Consecutive weekends penalty — quota gate added (§12.4):** The v1.6.0 penalty previously fired for all staff, including those below their required weekend count. This cancelled the weekend equity bonus (−`weekendCount_weight × 0.5`) applied in the same function for under-quota staff, making fairness worse rather than better after the fix was introduced (28-day fairness score: 0.25 → 0.35). The penalty now only fires when `weekendCount ≥ required` — the same threshold that switches section 3 from bonus to excess penalty. Staff below quota are never penalised for consecutive weekends during generation. **Performance fix (§12.2):** The v1.6.0 implementation iterated all staff assignments on every `softPenalty()` call (O(n) per call × 75,000 calls = 2.25M Date allocations for a 28-day schedule), causing a 14.7× regression (93s → 1,374s). Replaced with an O(maxConsecutive) bounded backward/forward scan using a new `hasWorkedDate()` O(1) Set lookup on `SchedulerState`. Performance restored to linear scaling. |
| 1.6.0 | Mar 15, 2026 | **Consecutive weekends penalty now active in scheduler (§12.4):** `softPenalty()` now includes a consecutive-weekend component using `weights.consecutiveWeekends`. Previously this weight was defined in all three profiles but never read, meaning the scheduler assigned consecutive weekends freely and the FAIR profile's `consecutiveWeekends: 3.0` did nothing. The scheduler now penalises assigning a weekend shift that would push a staff member's consecutive-weekend streak past the unit maximum (default 2). Penalty: `weight × (0.5 + excess × 0.5)`. **Weekend-specific violations scoped to weekend shifts (§4.3):** `consecutive-weekends` and `weekend-fairness` violations are now only displayed on Sat/Sun shifts. Previously these staff-level violations were propagated to every shift the staff member was assigned to (including weekday shifts), making them appear on Monday Day Shifts where a manager had no actionable way to address a consecutive-weekends issue. |
| 1.5.9 | Mar 15, 2026 | **OT-aware charge nurse selection (§12.2):** The greedy now applies a non-OT filter before the Level 5 charge preference. Within the charge-qualified pool, non-OT candidates (weekly hours + this shift ≤ 40h) are evaluated first; Level 5 is preferred within that non-OT pool. A Level 4 nurse with non-OT capacity is selected over a Level 5 nurse who would go into overtime. Previously the algorithm exclusively selected Level 5 nurses for all charge slots regardless of their OT status, causing Level 5 nurses (particularly those specialising in a single shift type) to be assigned to every charge slot until the 60h hard limit blocked them — concentrating 5 shifts/week of charge duty on one or two nurses each week. Level 4 stand-ins were only used when no Level 5 was eligible at all. **Performance: delta swap evaluation (§12.2):** Local search and both post-processing sweeps now use delta penalty evaluation instead of recomputing total penalty across all assignments. Only the ~15–30 assignments whose penalty actually changes (coworkers on both affected shifts + both staff members' same-week assignments for OT delta) are rescored per swap attempt, replacing ~280 softPenalty calls with ~15–30. In-place state mutation with unconditional restoration replaces state.clone() in swap validity checking, eliminating all Map copies during local search. These changes reduce 28-day schedule generation from ~15 minutes to under 2 minutes. |
| 1.5.8 | Mar 15, 2026 | **Variant generation refactored — derived from Balanced base (§12.1, §12.2):** Fairness-Optimized and Cost-Optimized variants are now built from the Balanced result by applying deterministic post-processing sweeps instead of independent greedy+local-search runs. This guarantees: (a) fairness(Fair) ≤ fairness(Balanced) and (b) OT(Cost) ≤ OT(Balanced), which previously could not be reliably guaranteed due to seed sensitivity and preference-fairness conflicts in independent runs. Phase 3 section added to §12.2 documenting the OT-reduction and weekend-redistribution sweeps. **Composite cost score (§12.6):** Scenario cost score now measures composite labor cost — `(agency×4 + OT×1 + float×0.2) / (total×4)` — weighted by real hospital cost premiums (agency 2–3× base pay, OT 1.5× base pay, float differential ~10%). Previously the cost score counted only overtime assignments, making agency and float optimizations invisible in the score. **`computeTotalPenalty` O(n²) → O(n) (§12.2):** Precomputes a `shiftId → coworkers` map once per call instead of re-filtering the full assignment list per assignment. For 84 assignments this reduces from ~7,000 comparisons per call to ~252. |
| 1.5.7 | Mar 4, 2026 | **On-leave staff displayed with Leave badge in schedule grid (§11):** When leave is approved and an assignment is cancelled (`status = "cancelled"`), the schedule grid now renders that staff member with a strikethrough name, orange dot, and orange "Leave" badge — and excludes them from the shift's staffing count. Previously, cancelled assignments were counted in the X/Y total (showing 5/5 as "full" even though one person was on leave) and rendered identically to active assignments. This masked understaffing created by leave approvals. The hard-violation badge from the rule engine still fires; the count now correctly drops to (N-1)/N so the orange understaffing border appears immediately. |

---

## 12. Scheduling Algorithm

The CAH Scheduler includes an **automated scheduling engine** that generates a full schedule from scratch for a given schedule period. The engine runs from the **Generate Schedule** button on any schedule detail page and produces three independent schedule variants in the background.

---

### 12.1 Overview

| Variant | Description | Disposition |
|---------|-------------|-------------|
| **Balanced** | Equal weight across all objectives | Written directly to the schedule's assignment table as the active draft |
| **Fairness-Optimized** | Guarantees equal or better weekend equity than Balanced via a deterministic weekend-redistribution sweep | Saved as an alternative scenario |
| **Cost-Optimized** | Minimises overtime and float/agency use via deterministic OT-reduction and weekend-redistribution sweeps | Saved as an alternative scenario |

The **Balanced** variant is generated first (greedy construction + local search). The **Fairness-Optimized** and **Cost-Optimized** variants are then derived from the Balanced result by applying deterministic post-processing sweeps — they never produce a result worse than Balanced on their primary metric. Managers compare variants on the Scenarios page and click **Apply** to switch the active schedule.

> **Note:** Generating a new schedule wipes all existing assignments for that schedule and starts fresh.

---

### 12.2 Algorithm — Three Phases

#### Phase 1: Greedy Construction

Shifts are sorted by **constraint difficulty** (most constrained first, to maximise the chance of filling hard-to-fill slots before the candidate pool is depleted):

1. **Weekend ICU/ER charge shifts** (Saturday or Sunday) — most constrained. In a weekly cycle, weekend charge slots fall at the end of date-ordered processing, so charge-qualified nurses accumulate hours Mon–Fri before the slot is reached. Processing them first guarantees they get first pick of the Level 4+ charge pool.
2. Weekday ICU/ER shifts that require a charge nurse
3. All other ICU/ER shifts
4. Night shifts
5. Day and evening shifts
6. On-call shifts (most flexible candidate pool, filled last)

Within each group, earlier dates come first, then earlier start times.

For each shift:
1. If a **charge nurse slot** is required and not yet filled, a charge-qualified candidate is selected first. Within the charge candidate pool, **non-OT candidates** (weekly hours + this shift ≤ 40h) are used first; OT candidates are only considered when every charge-qualified eligible nurse would go into overtime. Within whichever pool is used, **Level 5** nurses are preferred over Level 4 stand-ins. This means a Level 4 nurse with remaining non-OT hours will be selected as charge before a Level 5 nurse who would go into overtime.
2. Remaining **staff slots** are filled one at a time.
3. For each slot: filter all active staff through the **hard rule eligibility checks** (see §12.3) and the **charge protection guard** (see below). The eligible pool is then split into **non-OT candidates** (weekly hours + this shift ≤ 40h) and **OT candidates** (would cross 40h). Non-OT candidates are used exclusively when any exist; OT candidates are only considered when every eligible nurse would cause overtime. Within whichever pool is used, candidates are ranked by the **soft penalty function** (see §12.4) and the lowest-penalty candidate is assigned.
4. If no eligible candidate exists for a slot, the slot is left empty. The shift is recorded as **understaffed** with the most common hard rule rejection reasons.

**Charge protection guard (Pass 2):** Before including a Level 4+ charge-qualified nurse as a candidate for a regular (non-charge) slot, the algorithm checks whether assigning them now would exhaust their 60-hour rolling-window capacity for any upcoming ICU/ER charge shift within the next 7 days. The nurse is excluded from the current slot only if: (a) they would be rendered ineligible for the upcoming charge shift by this assignment, **and** (b) no other Level 4+ nurse is still eligible for that upcoming charge shift. This prevents the FAIR profile's low overtime weight from over-consuming charge nurses on regular slots, leaving Sunday ICU charge shifts with no valid candidate.

#### Phase 1.5: Hard Violation Repair

After greedy construction, the schedule is scanned for remaining hard violations:

- **Missing charge nurse** — shift requires a charge nurse but none was assigned
- **Missing Level 4+ ICU supervisor** — ICU/ER shift has staff but no Level 4+ nurse
- **Understaffed slots** — fewer staff assigned than the minimum required

Shifts are repaired in criticality order (ICU charge first, then non-ICU charge, then ICU general, then others). For each violation, two strategies are tried:

1. **Direct assignment** — find any eligible staff member not yet on the violated shift and assign them. This succeeds when the greedy's charge-protection guard held back a nurse who is actually available.

2. **Swap repair** — move a Level 4+ nurse from a *lower-criticality* shift to the critical slot. The mechanism: removing the nurse from their current assignment changes which rolling 7-day windows contain their hours, potentially dropping their total below the 60-hour cap for the critical shift. The vacated slot is then back-filled with any eligible generalist nurse so the donor shift does not stay short-staffed.

A donor shift is only raided when:
- Its criticality is strictly lower than the violated shift (e.g., a regular day shift can donate to an ICU charge shift)
- It retains at least one staff member after the raid
- Its own charge nurse is not removed (unless another charge nurse remains)
- An ICU donor shift with Level 2 nurses is not left without Level 4+ supervision

Up to three repair passes are run so cascading fixes take effect (e.g., adding Level 4+ makes Level 2 staff newly eligible, filling the next pass's shortfall).

A violation is preserved in the output **only when no eligible candidate exists anywhere** in the staff roster — a genuine shortage that requires management intervention (contacting agency, finding additional staff).

#### Phase 2: Local Search (Swap Improvement)

Up to 1,500 random swap attempts are made between pairs of assignments on different shifts. A swap is accepted only if:
- The swap passes all collective and individual hard rule checks (see below)
- The total soft penalty of the schedule decreases

This uses the **Late Acceptance** metaheuristic (Burke & Bykov, 2012): a swap is accepted if the new penalty ≤ the penalty recorded 200 iterations ago, not strictly better than the current solution. This allows temporary worsening to escape local optima while still converging toward a good solution.

**Collective checks applied before individual eligibility** (added in v1.4.10):

| Check | Rule |
|-------|------|
| **Charge-slot integrity** | If an assignment has `isChargeNurse = true`, the incoming staff must be charge-qualified (Level 4+ and `isChargeNurseQualified = true`). The `isChargeNurse` flag is a slot property spread via object spread — without this check, a Level 3 nurse can silently inherit the flag. |
| **Level 2 supervision residual** | After removing the outgoing staff from an ICU/ER shift, if Level 2 nurses remain on that shift, the shift must still have at least one Level 4+ supervisor (either from remaining staff or from the incoming staff member). |

#### Phase 3: Deterministic Post-Processing Sweeps

After local search completes, two deterministic sweeps are applied to the **Fairness-Optimized** and **Cost-Optimized** variants. Because these variants start from the Balanced result, they are guaranteed to never score *worse* than Balanced on their primary metric.

**Overtime Reduction Sweep** *(Cost-Optimized only)*
Exhaustively iterates all overtime assignments (those that push a nurse above 40h/week) and tries swapping each with every other assignment. Accepts the swap only if total weighted penalty decreases under COST_OPTIMIZED weights (OT weight 3.0). Runs until no improving swap remains.

**Weekend Redistribution Sweep** *(Fairness-Optimized and Cost-Optimized)*
Computes mean weekend-assignment count across all staff. Identifies staff above and below the mean. Exhaustively pairs "excess" weekend assignments with "deficit" staff and attempts a swap for each pair. Accepts the swap only if it passes all hard rules and total weighted penalty decreases under the variant's weights (FAIR weekendCount weight 3.0; COST_OPTIMIZED weekendCount weight 1.0). Runs until no improving swap remains.

The result: Fairness-Optimized is guaranteed to have weekend-count std dev ≤ Balanced (monotonically improving from the same starting point). Cost-Optimized is guaranteed to have OT count ≤ Balanced.

---

### 12.3 Hard Rule Eligibility Checks

These are evaluated in the order shown. Failing any check immediately disqualifies the candidate for that shift — they are **never relaxed**.

| # | Check | Details |
|---|-------|---------|
| 1 | **Approved leave** | Staff on approved leave for the shift date cannot be assigned |
| 2 | **PRN availability** | Per-diem (PRN) staff must have submitted availability for this date |
| 3 | **ICU/ER competency** | Shifts in ICU, ER, or ED units require `icuCompetencyLevel ≥ 2` |
| 4 | **No overlapping shifts** | Staff cannot be on two shifts whose time windows overlap |
| 5 | **Minimum rest (10 hours)** | At least 10 hours must separate the end of the previous shift and the start of this one |
| 6 | **Max consecutive days (5)** | Cannot create a run of more than 5 consecutive working days. Reduced to a staff member's personal preference if that preference is lower. |
| 7 | **60-hour rolling window** | Adding this shift must not push total hours in any 7-day window above 60h |
| 8 | **On-call limits** | On-call shifts respect `maxOnCallPerWeek` and `maxOnCallWeekendsPerMonth` unit settings |

If **all** remaining candidates fail hard rules for a given slot, that slot is left unfilled. The shift is flagged as understaffed with a summary of the most common rejection reasons, surfaced to the manager after generation.

---

### 12.4 Soft Rule Penalty Scoring

Each eligible candidate receives a penalty score. Lower is better. Negative values are valid (used to incentivise assignments that improve fairness or skill mix). The candidate with the **lowest penalty** is selected.

Each component is multiplied by the weight for that component in the active variant's weight profile.

| Component | Incentive / Penalty | Condition |
|-----------|---------------------|-----------|
| **Overtime — heavy** | + `weight × (OT hours / 12)` | Total weekly hours would exceed 40 |
| **Overtime — light** | + `weight × 0.3 × (extra hours / 12)` | Total would exceed FTE target but not 40h |
| **Capacity bonus** | − `weight × 0.1 × (remaining hours before 40h / 40)` | Always applied; highest for staff at 0h, zero for staff already at 40h |
| **Shift type mismatch** | + `weight × 0.5` | Candidate prefers a different shift type |
| **Preferred day off** | + `weight × 0.7` | Shift falls on a day the staff prefers off |
| **Weekend avoidance** | + `weight × 0.6` | Shift is on Sat/Sun and staff has `avoidWeekends = true` |
| **Weekend incentive** | − `weight × 0.5` | Shift is a weekend shift and staff is below their required weekend count (historical + current) |
| **Weekend excess penalty** | + `weight × (0.4 + excess × 0.3)` | Shift is a weekend and staff is at or above required weekend count |
| **Consecutive weekends** | + `weight × (0.5 + excess × 0.5)` | Assigning this weekend shift would push the staff member's consecutive-weekend streak past the unit maximum (default 2). `excess` = streak length minus max. **Only fires when the staff member is AT or ABOVE their required weekend count** (default 3 per 6-week period). Staff below quota receive the weekend equity bonus from the row above instead; applying a consecutive-weekend penalty to under-quota staff would cancel that bonus and reduce fairness. Sat + Sun of the same weekend share one ID and are not double-counted. |
| **Float — uncross-trained** | + `weight × 1.0` | Assigned outside home unit, not cross-trained there |
| **Float — cross-trained** | + `weight × 0.3` | Assigned outside home unit, but cross-trained |
| **Skill mix — all same** | + `weight × 0.6` | All staff on shift (including candidate) would share the same competency level |
| **Skill mix — partial dup** | + `weight × 0.1` | Candidate's competency level already exists on shift, but mix is not uniform |
| **Preceptor incentive** | − `weight × 0.8` | Candidate is Level 5 and a Level 1 is already on the shift |
| **Level 2 supervision** | − `weight × 0.6` | Candidate is Level 4+ on an ICU/ER shift that has a Level 2 nurse |
| **Charge clustering** | + `weight × 0.5` | Non-charge-candidate is charge-qualified, but shift already has a charge nurse |
| **Agency** | + `weight × 1.0` | Candidate is an agency nurse (employment type = `agency`) |

**Capacity bonus rationale:** Mirrors natural charge-nurse behaviour — when two candidates are otherwise equal, the one with more remaining hours this week is asked first. The coefficient (0.1) is intentionally small so it acts as a tiebreaker only and does not override meaningful clinical penalties (skill mix, charge requirement, preferences). Float pool staff — who have no home-unit bias and often have lower accumulated hours when critical ICU shifts are scheduled first — benefit most from this bonus, naturally reducing overtime on regular unit staff later in the schedule.

**Weekend equity — cross-schedule memory:** The weekend count used in the incentive/penalty above is **historical + current**. At context-build time, the system queries weekend assignments from the prior schedule period (one `schedulePeriodWeeks` window before the new schedule starts) and adds those counts to each nurse's running total. This prevents the deterministic greedy algorithm from assigning the same nurses to weekends every period. A nurse who worked 3 weekends last period (at quota) starts the new period effectively "already at quota" and is penalised for more weekends; a nurse who was light on weekends last period starts below quota and gets the assignment bonus. New hires and nurses with no prior history start at 0 and receive the full bonus.

---

### 12.5 Weight Profiles

Three profiles are defined. Weights are multiplied by the per-component penalty constants above.

| Weight | Balanced | Fairness-Optimized | Cost-Optimized |
|--------|----------|--------------------|----------------|
| `overtime` | **1.5** | 0.5 | **3.0** |
| `preference` | **1.5** | **2.0** | 0.5 |
| `weekendCount` | 1.0 | **3.0** | 1.0 |
| `consecutiveWeekends` | 1.0 | **3.0** | 1.0 |
| `holidayFairness` | 1.0 | **3.0** | 1.0 |
| `skillMix` | 1.0 | 1.0 | 0.5 |
| `float` | 1.0 | 0.5 | **2.0** |
| `chargeClustering` | 1.0 | 1.0 | 0.5 |
| `agency` | **2.5** | 1.5 | **5.0** |

**Balanced overtime rationale:** Raised from 1.0 → 1.5 so that actual overtime (a real payroll cost at 1.5× pay) is consistently more expensive than any single preference violation. At 1.5, 8h OT costs 1.0 scheduler units vs. a shift-type mismatch at 0.75 — overtime takes priority. The Fairness-Optimized profile intentionally keeps overtime low (0.5) because it accepts some extra hours in exchange for a more equitable weekend/holiday distribution.

**Cost-Optimized float rationale:** Lowered from 3.0 → 2.0. Float differentials are a flat hourly add-on (typically \$3–5/hr), not a multiplier, so they cost less than overtime (1.5× base pay). Setting float equal to overtime (both 3.0) overstated the cost of cross-unit assignments. The corrected weight (2.0) still strongly discourages unnecessary floating of regular-unit nurses while remaining below the overtime penalty.

**Agency weight rationale:** Agency nurses carry a 2–3× markup over base pay (agency fee + premium rate), making them significantly more expensive than even overtime (1.5× base) or float differentials. The `agency` penalty is a flat addition applied to every agency nurse in the candidate pool, ensuring the scheduler exhausts regular employees, float pool, and PRN staff before drawing on agency coverage. Cost-Optimized uses the highest agency penalty (5.0) to aggressively reserve agency as a true last resort. Fairness-Optimized uses a lower penalty (1.5) so equitable distribution across all staff takes precedence over cost avoidance. Agency staff retain all hard rule constraints — they are not scheduled in violation of rest, competency, or leave rules just because they are last resort.

---

### 12.6 Understaffing

When the greedy phase cannot fill a slot, the repair phase (§12.2 Phase 1.5) immediately attempts to fix it by swapping specialised staff from lower-priority shifts. A shift only remains understaffed after generation when **both** the greedy phase and the repair phase have exhausted all possibilities.

For shifts that still cannot be filled after repair:
- The slot is left **empty** — hard rules are never relaxed
- The shift is recorded with: date, shift type, unit, slots required, slots filled, and rejection reason
- After generation, warnings are shown to the manager
- The manager must resolve these manually (assign staff individually, contact an agency, etc.)

Understaffed shifts reported after generation represent **genuine staffing shortages** — the roster does not have enough eligible staff to cover them, regardless of how the schedule is arranged.

---

### 12.7 Audit Trail

| Event | # Entries | Action | Details |
|-------|-----------|--------|---------|
| Schedule auto-generated | 3 (one per variant) | `schedule_auto_generated` | Variant type, assignment count, understaffed count, full score breakdown |
| Scenario applied | 1 | `scenario_applied` | Scenario name, old assignment count, new assignment count |
| Subsequent manual changes | Per-event | Existing behavior | Callouts, swaps, manual assignments continue to produce individual audit entries |

The `assignmentSource` field on each assignment record distinguishes how the assignment was created:
- `auto_generated` — created by the scheduling algorithm (Balanced variant)
- `scenario_applied` — created when a manager applied an alternative scenario
- `manual` — created by a manager through the assignment dialog

---

*Document generated from CAH Scheduler codebase*
