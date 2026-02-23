# CAH Scheduler Documentation

Welcome to the CAH Scheduler documentation! This guide will help you understand everything about healthcare staff scheduling, from the very basics to advanced features.

## Who Is This For?

This documentation is written for **complete beginners**. You don't need to know anything about healthcare, nursing, or scheduling systems. We'll explain every concept from scratch.

---

## Table of Contents

### Getting Started
1. **[Introduction](./01-introduction.md)** - What is CAH Scheduler and why does it exist?

### Core Concepts
2. **[Healthcare Scheduling Basics](./02-healthcare-scheduling-basics.md)** - Why scheduling in healthcare is different and challenging
3. **[Understanding Staff](./03-understanding-staff.md)** - Nurses, roles, experience levels, and employment types
4. **[Understanding Shifts](./04-understanding-shifts.md)** - Day shifts, night shifts, patient census, and acuity
5. **[Scheduling Rules](./05-scheduling-rules.md)** - The rules that govern fair and safe scheduling

### Day-to-Day Operations
6. **[Managing Requests](./06-managing-requests.md)** - Leave requests, shift swaps, and PRN availability
7. **[Handling Callouts](./07-handling-callouts.md)** - What happens when staff can't come to work

### Setup & Configuration
8. **[Configuration](./08-configuration.md)** - Setting up units, holidays, and scheduling rules
9. **[Using the Application](./09-using-the-app.md)** - Step-by-step guide to each page in the app

### Generating Schedules
11. **[Generating Schedules](./11-generating-schedules.md)** - How to auto-generate a full schedule, understand the three variants, and read the violations report

### Reference
10. **[Glossary](./10-glossary.md)** - Quick definitions of all terms used in this guide

---

## Quick Start Path

If you're brand new, we recommend reading in this order:

```
Introduction → Healthcare Basics → Understanding Staff → Understanding Shifts → Scheduling Rules
```

Once you understand the concepts, move on to:

```
Managing Requests → Handling Callouts → Configuration → Using the App → Generating Schedules
```

Keep the **Glossary** handy for quick reference!

---

## About CAH Scheduler

CAH Scheduler is a staff scheduling application designed for **Critical Access Hospitals (CAH)** - small rural hospitals that serve communities far from large medical centers. These hospitals have unique challenges:

- Small staff pools (can't just call in extra people)
- Staff who wear multiple hats
- 24/7 coverage requirements
- Strict regulatory compliance
- Limited budgets

This application helps nurse managers create fair, compliant, and cost-effective schedules while keeping staff happy and patients safe.

### Key Features

- **Auto-generate schedules** — Click "Generate Schedule" on any schedule and the system builds a full roster from scratch in seconds. Three variants are produced automatically: Balanced, Fairness-Optimized, and Cost-Optimized.
- **Hard rule enforcement** — Constraints like rest hours, 60-hour weekly limits, competency requirements, and approved leave are *never* violated. If a shift can't be filled, it is flagged as understaffed rather than silently breaking a rule.
- **Automatic hard-violation repair** — After the initial schedule is built, a repair pass automatically resolves remaining hard violations (missing charge nurse, missing Level 4+ ICU supervisor, understaffed slots) using direct assignment and staff-swap strategies. Only genuine staffing shortages reach the manager.
- **Charge nurse rules** — Only Level 5 nurses (or Level 4 as a stand-in when no Level 5 is available) can be assigned as charge nurse. A Level 2 or Level 3 nurse cannot hold a charge role regardless of how their record is configured.
- **Violations dashboard** — After generating or editing a schedule, the page shows a full breakdown of hard violations (must fix) and soft violations (schedule quality), with a per-staff view so you know exactly who is affected and why.
- **Scenario comparison** — The two alternative variants are saved as scenarios you can review and apply at any time without regenerating.
- **Informed manual assignment** — The assignment dialog shows each eligible nurse's current weekly hours, FTE target, whether assigning them would cause overtime, and any preference mismatches — so you can make the right call when adjusting a shift manually.

---

## Need Help?

- **Technical Issues:** Check the [GitHub repository](https://github.com/GrowthToDo/cah-scheduler)
- **Questions:** Open an issue on GitHub

---

*Last Updated: February 2026 — v1.4.13 (auto-generation, charge nurse rules, violations modal, overtime/weekend rule improvements, scenario switching, penalty calibration, charge protection look-ahead, PRN availability, automatic hard-violation repair, non-OT scheduling preference, marginal extra-hours display, local search safety guards, assignment dialog context indicators, assigned staff hours and preference context, OT badge on all overtime shifts)*
