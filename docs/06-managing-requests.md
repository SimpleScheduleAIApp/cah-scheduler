# Managing Requests

[← Back to Index](./README.md) | [← Previous: Scheduling Rules](./05-scheduling-rules.md) | [Next: Handling Callouts →](./07-handling-callouts.md)

---

## Types of Requests

Staff regularly submit requests that affect scheduling. There are three main types:

1. **Leave Requests** - "I need time off"
2. **Shift Swap Requests** - "I want to trade shifts with someone"
3. **PRN Availability** - "Here's when I can work" (PRN staff only)

---

## Leave Requests

### What Is a Leave Request?

A leave request is when staff asks for time off from work.

**Common scenarios:**
- "I want to take vacation February 10-15"
- "I need to be out for surgery next month"
- "I have a family emergency tomorrow"

### Types of Leave

| Leave Type | Description | Typical Notice |
|------------|-------------|----------------|
| **Vacation** | Planned time off for rest/travel | Weeks/months in advance |
| **Sick** | Illness, can't work | Day of or day before |
| **Maternity/Paternity** | New baby | Months in advance (usually) |
| **Medical** | Surgery, treatment, recovery | Weeks in advance |
| **Personal** | Personal matters (moving, etc.) | Varies |
| **Bereavement** | Death in family | Immediate |
| **Other** | Anything else | Varies |

### The Leave Request Workflow

```
Staff Submits Request
        ↓
   Request is "Pending"
        ↓
Manager Reviews
        ↓
   ┌────┴────┐
   ↓         ↓
Approved   Denied
   ↓         ↓
Cannot be  Staff must
scheduled  work (or
those days resubmit)
```

### What Happens When Leave Is Approved?

When a manager approves leave, the system **automatically handles affected shifts**:

#### If Leave is Far in Advance (> 7 days)

The system finds replacement candidates automatically:

```
Leave Approved
      ↓
Find all shifts during leave dates
      ↓
For each shift:
  1. Search Float Pool staff
  2. Search PRN staff (who marked date as available)
  3. Search Regular staff for overtime
  4. Include Agency as fallback
      ↓
Rank candidates by suitability
      ↓
Present top 3 candidates with reasons
      ↓
Manager approves one → Assignment created!
```

**What the manager sees:**
- Go to Coverage page (`/open-shifts`)
- See "Pending Approval" requests
- Click "Review" to see top 3 candidates
- Each candidate card shows a **Pros / Cons** breakdown:
  - **Pros (green ✓):** float pool source, competency level, home unit match, reliability rating, charge-qualified (when the original nurse held the charge role)
  - **Cons (amber ✗):** overtime cost, weekend burden (≥ 3 weekends already worked this period), consecutive-day fatigue (≥ 4 consecutive days before this shift)
  - **Cons (red ✗):** "Not charge nurse qualified — will create hard rule violation" when the original nurse was charge and this candidate is not
- A **charge nurse warning banner** appears at the top of the dialog when the original nurse held the charge role and none of the candidates are charge-qualified (Level 4+)
- Click "Approve" on chosen candidate
- Assignment is created automatically

#### If Leave is Last-Minute (≤ 7 days)

This is treated as a **callout** situation:

```
Leave Approved
      ↓
Find all shifts during leave dates
      ↓
Create callout records (urgent)
      ↓
Manager follows escalation sequence manually
```

The 7-day threshold can be configured per unit.

#### Summary

| Timing | What Happens | Manager Action |
|--------|--------------|----------------|
| > 7 days out | Auto-finds candidates, presents top 3 | Review & approve one |
| ≤ 7 days out | Creates callout | Follow escalation manually |

### What Happens When Leave Is Denied?

1. **Denial reason required** — A written reason must be entered before the denial can be saved. This is not optional.
2. **Record is permanent** — The reason is stored on the leave record and written to the audit trail. It cannot be removed later.
3. **Staff can resubmit** — If the denial was date-specific (e.g., "Too many people off that week"), staff may resubmit for different dates.

### Who Can Approve Leave?

Typically:
- **Nurse Manager** - Day-to-day approvals
- **Director/CNO** - Extended leave, special circumstances

### Why Would Leave Be Denied?

- Too many people already off on those dates
- Critical coverage period (e.g., holiday season)
- Not enough notice given
- Leave balance insufficient

---

## Shift Swap Requests

### What Is a Shift Swap?

A shift swap is when two staff members trade shifts with each other.

**Example:**
> Maria is scheduled for Tuesday Day. She wants to go to her kid's school event.
> John is scheduled for Thursday Day. He'd rather work Tuesday.
> They swap: Maria works Thursday, John works Tuesday.

### Why Allow Swaps?

- **Flexibility** - Staff can handle unexpected life events
- **Retention** - Feeling of control over schedule
- **Coverage** - Hospital still has the shifts covered
- **Morale** - Employees help each other

### The Swap Request Workflow

```
Manager logs swap request (Log Swap Request button)
        ↓
Specifies: Requesting staff + their shift
           Target staff + their shift (optional)
        ↓
   Request is "Pending"
        ↓
Manager Reviews → clicks "Approve"
        ↓
System automatically checks hard rules:
   - ICU competency level ≥ 2 for each incoming staff member
   - Charge nurse role: incoming staff must be Level 4+
   - Level 2 supervision: must have Level 4+ coworker remaining
   - No approved leave on the new shift date
   - No overlapping shift already scheduled
        ↓
   ┌─────────┴──────────┐
   ↓                    ↓
Rules pass          Rules violated
   ↓                    ↓
Shifts swapped      "Swap Cannot Be Approved"
automatically       dialog lists each issue —
                    swap is NOT performed
```

### What Does the System Check Automatically?

When you click "Approve" on a directed swap, the system validates these hard rules **before** making any changes:

| Check | What It Catches |
|-------|-----------------|
| **ICU competency** | Incoming staff is Level 1 (below ICU minimum of 2) |
| **Charge nurse** | Incoming staff is Level <4 but the slot carries the charge role |
| **Level 2 supervision** | Incoming staff is Level 2 with no Level 4+ coworker remaining on that shift |
| **Approved leave** | Incoming staff has approved leave on the date of their new shift |
| **Shift overlap** | Incoming staff is already assigned to another shift that overlaps |
| **Rest hours** | Incoming staff would have fewer than 10 hours rest before or after this shift based on their existing adjacent assignments |

If any check fails, a dialog appears listing every violation. The swap is **not** performed and the request stays Pending so you can investigate and either deny it or correct the issue.

### Example: Valid Swap

> **Before:**
> - Tuesday Day: Maria (RN, Level 4), John (RN, Level 3), others...
> - Thursday Day: Lisa (RN, Level 4), Tom (RN, Level 3), others...
>
> **Swap Request:** Maria ↔ Lisa
>
> **After:**
> - Tuesday Day: Lisa (RN, Level 4), John (RN, Level 3), others...
> - Thursday Day: Maria (RN, Level 4), Tom (RN, Level 3), others...
>
> **Result:** Both shifts still have a Level 4 nurse. System approves automatically!

### Example: Invalid Swap (Blocked)

> **Before:**
> - Tuesday Day: Maria (RN, Level 5, Charge), John (RN, Level 2), others...
> - Thursday Day: Sam (RN, Level 3), others...
>
> **Swap Request:** Maria ↔ Sam
>
> **What happens when you click Approve:**
> - System detects: Sam is Level 3 — charge nurse role requires Level 4+
> - System detects: John is Level 2 and would be left with no Level 4+ supervisor
> - "Swap Cannot Be Approved" dialog appears with both violations listed
> - Assignments are **unchanged**
>
> **Resolution:** Deny the request and explain why, or find a different swap partner.

### Open Requests

Sometimes staff cannot find a specific trade partner:

> "I need to give up my Tuesday shift. Can someone else cover it?"

Log this as an **open swap request** (leave Target Staff blank). When you approve an open swap:

1. The requesting staff member's assignment is marked as unavailable (hidden from the grid)
2. A **Coverage Request** is automatically created for that shift — it appears on the Coverage page exactly like a leave or callout replacement request
3. Use the Coverage page to find a replacement through the normal escalation workflow

---

## PRN Availability

### What Is PRN Availability?

PRN (per diem) staff aren't scheduled automatically. They must tell us when they're available to work.

**Think of it as:** "Here are the days I'm willing and able to work."

### Why Is This Required?

PRN staff have no obligation to work. They work "as needed" when it suits them. But we can only count on them if we know when they're available.

**Without availability submission:**
- We can't schedule them
- They might miss out on shifts
- We might be understaffed

### The Availability Workflow

```
New Schedule Period Opens
(e.g., March 1 - April 15)
        ↓
PRN Staff Notified
"Submit your availability by Feb 15"
        ↓
PRN Staff Submit
"I can work March 3, 5, 10, 12, 15..."
        ↓
Manager Creates Schedule
Only assigns PRN to dates they marked available
        ↓
Schedule Published
PRN staff see their assignments
```

### What PRN Staff Submit

For each schedule period:
- **List of available dates** - "I can work March 3, 5, 10..."
- **Notes (optional)** - "Prefer day shifts" or "Available after 3pm only"

### Viewing Availability (Manager Side)

Managers can see:
- Which PRN staff have submitted availability
- Which PRN staff have NOT submitted (need a reminder?)
- A calendar view of who's available when

### Example Scenario

> **Schedule Period:** March 1 - April 15 (6 weeks)
>
> **PRN Staff:**
> - Tom: Available 12 days
> - Sarah: Available 8 days
> - Mike: Has not submitted!
>
> **Manager Action:**
> 1. Remind Mike to submit
> 2. Build schedule using Tom and Sarah's availability
> 3. If Mike never submits, he gets no shifts

---

## Managing Requests in the App

### Leave Management Page (`/leave`)

**What you see:**
- List of all leave requests, filtered by All / Pending / Approved / Denied
- Staff name, leave type, date range, day count, submission date, and status
- A **View** button on every row to see full request details

**What you can do:**
- **Create** a new leave request on behalf of staff
- **Approve** pending requests — coverage workflow triggers automatically
- **Deny** pending requests — a dialog opens requiring a written denial reason before the denial can be confirmed; the reason is saved to the record and the audit trail
- **View** any request (pending, approved, or denied) to see the complete detail: submission time, approval/denial timestamp, approver name, denial reason, and full notes

**Why denial reasons are required:**
A written reason protects the hospital from fairness disputes. Staff have a right to know why their request was turned down, and the reason becomes part of the permanent audit trail.

### Shift Swaps Page (`/swaps`)

**What you see:**
- List of all swap requests with requesting staff, their shift, target staff, and target shift
- Status of each request (Pending, Approved, Denied)

**What you can do:**
- **Log Swap Request** — click the button in the top-right to open the creation dialog:
  1. Select the requesting staff member and the shift they want to give up
  2. Optionally select target staff and their shift (leave blank for an open request)
  3. Add optional notes and click **Submit Request**
- **Approve** pending swaps — system validates hard rules automatically; shows a violation dialog if any rule fails
- **Deny** pending swaps — request stays on file with Denied status
- Filter by status (All / Pending / Approved / Denied)

### PRN Availability Page (`/availability`)

**What you see:**
- List of PRN staff
- Who has submitted availability
- Who is missing (hasn't submitted)
- Available dates for each person

**What you can do:**
- View the availability calendar
- Identify who needs reminders
- Plan coverage based on availability

---

## Best Practices

### For Leave Requests

1. **Set clear deadlines** - "Vacation requests due 2 weeks in advance"
2. **First-come, first-served** - Encourages early planning
3. **Holiday blackout periods** - Communicate when leave is restricted
4. **Approval timeframes** - "You'll hear back within 48 hours"

### For Shift Swaps

1. **Allow reasonable swaps** - Don't be too restrictive
2. **Check all rules** - Use the system's validation
3. **Document denials** - Explain why so staff understands
4. **Encourage direct swaps** - Staff should find their own trades first

### For PRN Availability

1. **Send reminders** - "Availability due in 3 days!"
2. **Set deadlines** - "Submit by the 15th of the prior month"
3. **Reward reliability** - PRN who submit on time get first pick
4. **Follow up** - Contact staff who don't submit

---

## Summary

Request management is a key part of scheduling:

**Leave Requests:**
- Staff request time off
- Manager approves or denies
- Approved leave blocks scheduling

**Shift Swaps:**
- Staff trade shifts with each other
- Manager ensures swap is safe
- Both parties must benefit

**PRN Availability:**
- PRN staff submit when they can work
- Scheduler only uses available dates
- No submission = no shifts

The application provides dedicated pages for managing all three types of requests, keeping everything organized and auditable.

---

[Next: Handling Callouts →](./07-handling-callouts.md)
