# Using the Application

[← Back to Index](./README.md) | [← Previous: Configuration](./08-configuration.md) | [Next: Glossary →](./10-glossary.md)

---

## Application Overview

The CAH Scheduler is a web application. You access it through a browser (Chrome, Safari, Firefox, etc.).

**Main navigation:** A sidebar on the left shows all available pages.

---

## Pages Reference

Here's every page in the application and what you can do on each.

---

## Setup (`/setup`)

**Purpose:** Import and export your hospital's data via Excel spreadsheet.

### When to Use This Page

- **First time setup** - Import all your staff, units, and holidays at once
- **Bulk updates** - Export current data, edit in Excel, and re-import
- **Reset** - Upload a new Excel file to replace all existing data

### What You'll See

- **Download Data** - Export current database as Excel file
- **Upload Area** - Drag and drop your Excel file
- **Preview** - See counts of what will be imported
- **Errors/Warnings** - Issues that need fixing before import

### The Export → Edit → Import Workflow

```
1. Click "Download Data" (exports current Staff, Units, Holidays, Staff Leave)
        ↓
2. Edit in Excel (add rows, remove rows, change values)
        ↓
3. Upload the modified Excel file
        ↓
4. Review the preview (fix any errors)
        ↓
5. Click "Import Data"
        ↓
6. Confirm the data reset
        ↓
7. Done! Changes are applied
```

**First-time setup:** If the database is empty, the exported file will have headers only - fill in your data and upload.

### Excel Template Sheets

**Sheet 1: Staff**
- First Name, Last Name (required)
- Role: RN, LPN, or CNA (required)
- Employment Type: full_time, part_time, per_diem, float, agency (required)
- FTE, Home Unit, Competency Level, Charge Nurse Qualified, etc. (optional)
- **Staff Preferences** (optional):
  - Preferred Shift: day, night, or any (evening is not a valid shift type in this application)
  - Preferred Days Off: comma-separated days (e.g., "Saturday, Sunday")
  - Max Consecutive Days: 1-7 (default: 3)
  - Max Hours Per Week: 8-60 (default: 40)
  - Avoid Weekends: Yes or No

**Sheet 2: Units**
- Name (required) - e.g., ICU, ER, Med-Surg
- Min Staff Day, Min Staff Night (required)

**Sheet 3: Holidays**
- Name (required) - e.g., Christmas Day
- Date (required) - e.g., 2026-12-25

**Sheet 4: Staff Leave** (optional)
- First Name, Last Name (required — must match a staff member in the Staff sheet)
- Leave Type (required): vacation, sick, maternity, medical, personal, bereavement, or other
- Start Date, End Date (required): YYYY-MM-DD format
- Status (required): pending, approved, or denied
- Reason (optional): free text
- Staff on **approved** leave will be blocked from scheduling during that period
- If a name does not match any imported staff member, that row is skipped silently

### Common Tasks

| Task | How To |
|------|--------|
| Export current data | Click "Download Data" button |
| Upload data | Drag file to upload area or click "Browse" |
| Fix errors | Read error messages, fix in Excel, re-upload |
| Import | Click "Import Data" after preview looks good |
| Start over | Click "Remove" on uploaded file |

### Important Notes

- **Data Reset**: Importing REPLACES all existing data with the uploaded file
- **Validation**: System checks for errors before importing
- **Defaults**: After import, default rules and shift definitions are created
- **Bulk edits**: For bulk changes, export → edit in Excel → re-import is faster than UI edits

---

## Dashboard (`/dashboard`)

**Purpose:** Your home base. Quick overview of what's happening.

### What You'll See

- **Schedule Summary** - Current schedule status (draft/published)
- **Coverage Alerts** - Shifts that need attention
- **Pending Items** - Leave requests, swaps waiting for approval
- **Quick Stats** - Staff count, upcoming shifts, etc.

### Common Tasks

| Task | How To |
|------|--------|
| See today's coverage | Check the "Today" section |
| Review pending requests | Look at "Pending Items" |
| Jump to a problem | Click any alert to go to details |

---

## Staff (`/staff`)

**Purpose:** Manage all staff members in the system.

### What You'll See

- **Staff List** - Everyone in the system
- **Key Info** - Name, role, employment type, competency
- **Status** - Active/inactive

### Common Tasks

| Task | How To |
|------|--------|
| View all staff | Just open the page |
| Find a specific person | Use search/filter |
| Add new staff | Click "Add Staff" button |
| Edit staff info | Click on a staff member, then "Edit" |
| Deactivate staff | Edit and set "Active" to No |
| View certifications | Click into staff detail view |
| **View staff calendar** | Click on staff member's name to see their schedule |

### Adding New Staff

Required information:
1. First name, Last name
2. Role (RN, LPN, CNA)
3. Employment type (Full-time, Part-time, PRN, etc.)
4. Home unit
5. Competency level
6. FTE (for non-PRN)

---

## Schedule (`/schedule`)

**Purpose:** View and edit the schedule.

### What You'll See

- **Calendar Grid** - Days across the top, shifts down the side
- **Assignments** - Who's working each shift
- **Coverage Indicators** - Green (good), Yellow (warning), Red (problem)
- **Schedule Status** - Draft or Published

### Common Tasks

| Task | How To |
|------|--------|
| View a day's coverage | Click on the day |
| See who's working a shift | Click on the shift |
| Add an assignment | Click any shift to open the assignment dialog |
| Remove an assignment | Open the shift dialog, click "Remove" next to the staff member |
| **Generate schedule automatically** | Click **"Generate Schedule"** button in the top-right |
| Publish schedule | Click "Publish" button |

### The Assignment Dialog

When you click any shift in the grid, a dialog opens showing:

- **Currently Assigned** — everyone on this shift, with:
  - Badges for Charge, competency level, and **OT** (red) if this nurse's total hours for the week exceed 40h — the badge appears on every overtime shift, not just the first one
  - Hours worked this week *including* this shift — shown in amber if a part-time nurse is above their FTE target
  - FTE target in parentheses for part-time staff (e.g., "28h this week (20h FTE target)")
  - Preference mismatches in amber — "Prefers nights", "Prefers Monday off", "Avoids weekends"
- **Available Staff** — all staff who pass hard scheduling rules for this shift, each showing:
  - Hours already worked this week — helps you pick someone with capacity
  - FTE target for part-time staff (shown in amber if they're already above it)
  - **Would OT** badge (red) — assigning this person would cross 40 h/week
  - Preference mismatches in amber — "Prefers nights", "Prefers Monday off", "Avoids weekends"
- **Unavailable** — staff blocked by a hard rule, with the reason shown (e.g., "insufficient rest", "on approved leave")

If a shift requires a charge nurse, eligible charge nurses (Level 4+) show an **Assign as Charge** button instead of the plain Assign button.

### Schedule Workflow

```
1. Create new schedule (set date range)
        ↓
2. Click "Generate Schedule" → system builds 3 variants automatically
        ↓
3. Go to Scenarios page, compare variants and Apply your preferred one
        ↓
4. Return here and review the applied schedule
        ↓
5. Make manual adjustments if needed
        ↓
6. Publish (make visible to staff)
```

---

## Scenarios (`/scenarios`)

**Purpose:** Generate and compare different scheduling options, then choose the best one.

### What Is a Scenario?

Every time you click **"Generate Schedule"**, the system automatically creates **three** complete schedule variants at once — each with a different priority:

| Variant | Priority | Auto-applied? |
|---------|----------|---------------|
| **Balanced** | Equal weight across all goals | ✅ Yes — becomes the active draft immediately |
| **Fairness-Optimized** | Maximises fair weekend/holiday distribution and preference matching | No — shown as an alternative |
| **Cost-Optimized** | Minimises overtime and use of float/agency staff | No — shown as an alternative |

The Balanced variant is applied to the schedule automatically. You can review the other two and **Apply** one if you prefer it.

### What You'll See

- **Schedule dropdown** - Select which schedule to view scenarios for (auto-filled when you arrive from the Schedule page)
- **Generate Schedule button** - Starts generation; shows a live progress bar while it runs
- **Scenario cards** - One per variant, each showing score bars for Coverage, Fairness, Cost, Preference, and Skill Mix
- **Overall score** - A single percentage summarising the variant's quality
- **Status badge** - Draft (available), Active Schedule (currently applied), or Rejected
- **Understaffing warnings** - If any shifts couldn't be fully staffed (shown after generation)

### Common Tasks

| Task | How To |
|------|--------|
| Generate all three variants | Select a schedule, click "Generate Schedule" |
| Watch generation progress | Progress bar and phase label appear automatically |
| Compare variants | View score bars side-by-side on the cards |
| Switch to a different variant | Click **"Apply"** on the card you prefer (available on any non-active variant, including previously rejected ones) |
| Dismiss a variant you don't want | Click **"Reject"** (only available while the variant is in Draft status) |
| See understaffed shifts | Check the yellow warning panel after generation |

### Understaffing Warnings

If any shift could not be fully staffed (because every available nurse failed a hard rule), a warning panel appears listing:
- Which shift (date, type, unit)
- How many slots were filled vs. required
- Why candidates were rejected (e.g., "on approved leave", "insufficient rest time")

Review these with your team and assign the remaining slots manually from the Schedule page.

### Score Bars Explained

Each score bar shows 0–100% where **higher is better**:
- **Coverage** — How many required slots were filled
- **Fairness** — How evenly weekends and holidays are distributed
- **Cost** — How little overtime and float/agency use is required
- **Preference** — How well staff shift preferences are honoured
- **Skill Mix** — How well competency levels are balanced across shifts

### Staff Calendar View

When you click a staff member's **name** (not the edit button), a calendar opens showing their schedule:

**Color Coding:**
- **Blue** - Day shift assigned
- **Purple** - Night shift assigned
- **Green** - On approved leave
- **Gray** - Off / not scheduled

**Features:**
- Navigate between months using arrows
- Default view: current schedule period
- Shows staff summary (role, FTE, home unit)

---

## Coverage (`/open-shifts`)

**Purpose:** Review and approve replacement candidates for shifts needing coverage.

### What You'll See

- **Coverage Requests** - Shifts that need replacements with auto-found candidates
- **Filter Tabs** - Pending, Filled, Cancelled, All
- **Top Recommendation** - The best candidate for each shift
- **Status Badges** - Pending Approval, Filled, Cancelled, No Candidates

### Common Tasks

| Task | How To |
|------|--------|
| See requests needing approval | Click "Pending" filter tab |
| Review candidates | Click "Review" button to see top 3 candidates |
| Approve a candidate | Click "Approve" next to your choice |
| Cancel a request | Click "Cancel" button |

### Approval Workflow

1. Leave is approved for dates with existing assignments
2. System automatically finds top 3 replacement candidates
3. Manager clicks "Review" to see all candidates with reasons
4. Manager clicks "Approve" on their choice
5. Assignment is created automatically

### Candidate Sources

Candidates are found in this order (escalation ladder):
1. **Float Pool** - Staff designated for floating (highest priority)
2. **PRN** - Per diem staff who marked the date as available
3. **Overtime** - Regular staff who could work extra
4. **Agency** - External staffing (requires phone call)

---

## Callouts (`/callouts`)

**Purpose:** Log and manage staff callouts.

### What You'll See

- **Callout List** - All recorded callouts
- **Status** - Open, Filled, Unfilled Approved
- **Details** - Who, when, why, replacement

### Common Tasks

| Task | How To |
|------|--------|
| Log a new callout | Click "Log Callout" |
| Find replacement for an open callout | Click "Find Replacement" on that row |
| Mark as filled | Assign replacement staff in the escalation dialog |
| Close without fill | Mark "Unfilled Approved" with justification |

### Logging a Callout

1. Click "Log Callout"
2. Select the **schedule** the staff member is on
3. Select the **staff member** from the alphabetically sorted list
4. Select the **specific shift** from that person's assignments
5. Select the **reason** (sick, emergency, etc.)
6. Add optional details, then click **Log Callout**
7. The replacement candidates dialog opens automatically

### Finding a Replacement for an Existing Callout

If you closed the replacement dialog (for example, to check the schedule grid for rest-hour conflicts), the candidates are not lost. Each open callout row in the history table has a **Find Replacement** button that re-fetches and reopens the escalation dialog with fresh candidates.

---

## Leave Management (`/leave`)

**Purpose:** Handle time-off requests.

### What You'll See

- **Request List** - All leave requests
- **Status Filters** - All, Pending, Approved, Denied
- **Request Details** - Who, dates, type, status

### Common Tasks

| Task | How To |
|------|--------|
| See pending requests | Click "Pending" filter |
| Approve a request | Click "Approve" button |
| Deny a request | Click "Deny" button |
| Create request for staff | Click "New Leave Request" |

### Approving/Denying

**Before approving, consider:**
- Is coverage available for those dates?
- How many others are already off?
- Is this a blackout period?

**When denying:**
- Provide a reason (staff will see it)
- Be consistent in your criteria

---

## Shift Swaps (`/swaps`)

**Purpose:** Manage shift trade requests between staff.

### What You'll See

- **Swap List** - All swap requests
- **Parties** - Who wants to swap with whom
- **Shifts** - Which shifts are being traded
- **Status** - Pending, Approved, Denied

### Common Tasks

| Task | How To |
|------|--------|
| See pending swaps | Click "Pending" filter |
| Approve a swap | Click "Approve" |
| Deny a swap | Click "Deny" |

### Before Approving

The system should validate:
- Both parties are qualified for each other's shifts
- No rule violations created
- Coverage remains adequate

Review these checks before approving!

---

## PRN Availability (`/availability`)

**Purpose:** See when PRN staff can work.

### What You'll See

- **Staff List** - PRN staff members
- **Submission Status** - Who has/hasn't submitted
- **Availability Calendar** - Dates each person is available
- **Missing Alert** - Staff who need to submit

### Common Tasks

| Task | How To |
|------|--------|
| See who hasn't submitted | Check "Missing Submissions" card |
| View someone's availability | Click on their row |
| See availability calendar | Scroll to calendar section |

### Using This Information

- Only schedule PRN on dates they marked available
- Identify gaps where no PRN is available
- Follow up with staff who haven't submitted

---

## Rules (`/rules`)

**Purpose:** View and configure scheduling rules.

### What You'll See

- **Rule List** - All hard and soft rules
- **Type Badge** - Hard vs Soft
- **Category** - Staffing, Rest, Fairness, etc.
- **Status** - Active/Inactive

### Common Tasks

| Task | How To |
|------|--------|
| View all rules | Open the page |
| See rule details | Click on a rule |
| Toggle rule on/off | Use active toggle |
| Adjust parameters | Edit the rule |

---

## Unit Configuration (`/settings/units`)

**Purpose:** Configure scheduling rules per unit.

### What You'll See

- **Unit Cards** - Each unit with its settings
- **Settings Summary** - Key values at a glance

### Common Tasks

| Task | How To |
|------|--------|
| Add a unit | Click "Add Unit" |
| Edit unit settings | Click "Edit" on the unit card |
| Delete a unit | Click "Delete" (careful!) |

### What You Can Configure

- Weekend shift requirements
- Holiday requirements
- Callout escalation order
- Low census order
- Acuity staffing levels
- On-call limits
- OT thresholds

---

## Holidays (`/settings/holidays`)

**Purpose:** Manage public holidays.

### What You'll See

- **Year Selector** - Switch between years
- **Holiday Table** - Each holiday with date and day of week
- **Weekend Badge** - Shows if holiday falls on weekend

### Common Tasks

| Task | How To |
|------|--------|
| Add US holidays | Click "Add Standard Holidays" |
| Add custom holiday | Click "Add Holiday" |
| Edit a holiday | Click "Edit" |
| Delete a holiday | Click "Delete" |
| Change year | Click year buttons |

---

## Audit Trail (`/audit`)

**Purpose:** See complete history of all changes.

### What You'll See

- **Event List** - Every action taken in the system
- **Details** - Who, what, when
- **Entity** - What was affected (assignment, rule, etc.)
- **Action** - What happened (created, updated, etc.)

### Common Tasks

| Task | How To |
|------|--------|
| Find a specific change | Use filters |
| See who made a change | Check "Performed By" column |
| View change details | Click on an entry |

### Why Use Audit Trail?

- **Compliance** - Prove you followed procedures
- **Troubleshooting** - "What happened to Maria's shift?"
- **Accountability** - Track who made decisions
- **Disputes** - "I was scheduled for X, not Y"

---

## Common Workflows

### Publishing a New Schedule

```
1. Go to Schedule page
2. Create new schedule (set dates)
3. Click "Generate Schedule" — system builds 3 variants in background
4. Go to Scenarios page when generation completes
5. Review score cards; click "Apply" on your preferred variant
6. Return to Schedule, make any manual adjustments
7. Click "Publish"
```

### Handling a Same-Day Callout

```
1. Get the call: "I can't come in"
2. Go to Callouts page
3. Click "Log Callout"
4. Select schedule → staff member → shift → reason
5. Click "Log Callout" — replacement candidates appear automatically
6. Review candidates (source, competency, overtime risk)
7. Click "Assign" on your choice — status updates to "Filled"
   (If you close the dialog, click "Find Replacement" on the row to reopen it)
```

### Approving Leave Requests

```
1. Go to Leave page
2. Filter by "Pending"
3. For each request:
   - Check calendar for coverage
   - Consider other requests same period
   - Approve or Deny
   - Add notes if denying
```

---

## Tips & Best Practices

### Daily
- Check Dashboard for alerts
- Review any pending callouts
- Monitor today's coverage

### Weekly
- Process pending leave requests
- Process pending swap requests
- Review schedule for next week

### Before Each Schedule Period
- Collect PRN availability
- Process vacation requests
- Build/generate the schedule
- Review scenarios
- Publish

### Monthly
- Review callout patterns
- Check fairness metrics (weekend/holiday distribution)
- Adjust configuration if needed

---

## Summary

The application is organized around your workflow:

1. **Setup** - Import data from Excel (first-time setup)
2. **Dashboard** - Your starting point
3. **Staff** - Who you're scheduling (click names for calendar view)
4. **Schedule** - The main event; use "Generate Schedule" to auto-build, click issue badges for details
5. **Scenarios** - Generate 3 variants, compare scores, Apply your preferred one
6. **Callouts** - Handle absences
7. **Coverage** - Review and approve replacement candidates
8. **Leave** - Time-off requests (auto-creates open shifts when approved)
9. **Swaps** - Shift trades
10. **Availability** - PRN scheduling
11. **Rules** - Scheduling constraints
12. **Units** - Department configuration
13. **Holidays** - Special days
14. **Audit** - Change history

Navigate using the sidebar, and you'll find what you need!

---

[Next: Glossary →](./10-glossary.md)
