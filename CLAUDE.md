# CLAUDE.md — CAH Scheduler

This file provides context and conventions for Claude Code when working in this repository.

---

## Project Overview

**CAH Scheduler** is a nurse scheduling application for Critical Access Hospitals (small rural hospitals, ≤25 beds). It automates complex staff scheduling while enforcing hard rules (safety/legal) and soft rules (fairness/preferences).

- **Current version:** 1.4.33
- **GitHub:** https://github.com/GrowthToDo/cah-scheduler
- **Local path:** D:\Pradeep\Personal\Projects\Nurse-scheduling

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.1.6 (App Router) |
| Language | TypeScript 5.x (strict mode) |
| UI | React 19, Radix UI, Tailwind CSS 4 |
| Icons | Lucide React |
| Database | SQLite via `better-sqlite3` (synchronous) |
| ORM | Drizzle ORM 0.45.1 |
| Validation | Zod 4 |
| Date utilities | date-fns 4, react-day-picker 9 |
| Excel | xlsx 0.18.5 |
| Linting | ESLint 9 (flat config) |

---

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes (route.ts files)
│   ├── dashboard/          # Dashboard page
│   ├── staff/              # Staff management
│   ├── schedule/           # Schedule grid + [id] detail
│   ├── scenarios/          # Scenario comparison
│   ├── callouts/           # Callout logging
│   ├── open-shifts/        # Coverage requests
│   ├── leave/              # Leave approval workflow
│   ├── swaps/              # Shift swap management
│   ├── availability/       # PRN availability
│   ├── rules/              # Rule configuration
│   ├── settings/           # Unit + holiday config
│   ├── audit/              # Audit trail
│   └── setup/              # Excel import/export
├── components/
│   ├── layout/sidebar.tsx  # Main navigation (update when adding pages)
│   ├── schedule/           # Schedule grid, assignment dialog, violations modal
│   ├── staff/              # Staff table, form, detail dialog, calendar
│   └── ui/                 # Radix UI wrappers (button, card, dialog, etc.)
├── db/
│   ├── schema.ts           # Drizzle ORM schema (single source of truth)
│   ├── index.ts            # DB initialization + export
│   └── seed.ts             # Test data seeder
└── lib/
    ├── engine/
    │   ├── rule-engine.ts  # Main rule evaluation orchestrator
    │   ├── rule-calculator.ts
    │   ├── census-calculator.ts
    │   ├── rules/          # 20+ individual rule evaluators
    │   └── scheduler/      # Auto-generation engine
    │       ├── types.ts         # WeightProfile, AssignmentDraft, SchedulerContext
    │       ├── state.ts         # SchedulerState (O(1) mutable tracking)
    │       ├── eligibility.ts   # passesHardRules + getRejectionReasons
    │       ├── scoring.ts       # softPenalty (7-component)
    │       ├── weight-profiles.ts # BALANCED, FAIR, COST_OPTIMIZED
    │       ├── greedy.ts        # greedyConstruct (phase 1)
    │       ├── local-search.ts  # localSearch (phase 2, swap improvement)
    │       ├── index.ts         # buildSchedulerContext + generateSchedule
    │       └── runner.ts        # runGenerationJob (3 variants, writes DB)
    ├── callout/escalation.ts
    ├── coverage/find-candidates.ts
    ├── import/parse-excel.ts
    ├── audit/logger.ts
    └── utils.ts

docs/                       # End-user documentation (01- through 10-)
RULES_SPECIFICATION.md      # Full business rules reference
CHANGELOG.md                # Version history
```

---

## Development Commands

```bash
npm run dev          # Start dev server on port 3000
npm run build        # db:push + db:seed + next build
npm start            # Production server
npm run lint         # ESLint

# Database
npm run db:generate  # Generate migrations after schema changes
npm run db:push      # Apply schema to database
npm run db:migrate   # Run pending migrations
npm run db:studio    # Drizzle Studio (visual DB browser)
npm run db:seed      # Seed test data (src/db/seed.ts)
```

### Database Workflow (after schema changes)
1. Edit `src/db/schema.ts`
2. `npm run db:generate`
3. `npm run db:push`
4. Update `src/db/seed.ts` if needed

---

## Naming Conventions

| Thing | Convention |
|---|---|
| Pages | `src/app/[name]/page.tsx` |
| API routes | `src/app/api/[resource]/route.ts` |
| React components | PascalCase (`StaffForm.tsx`) |
| Utilities | camelCase (`findCandidates.ts`) |
| DB columns | snake_case |
| TS variables | camelCase |
| Path alias | `@/*` → `./src/*` |

---

## Key Patterns

### Adding a New Page
1. Create `src/app/[pagename]/page.tsx`
2. Add route to `src/components/layout/sidebar.tsx`

### Adding a New API Endpoint
1. Create `src/app/api/[resource]/route.ts`
2. Export named functions: `GET`, `POST`, `PUT`, `DELETE`
3. Use Drizzle ORM for all DB access
4. Log changes to `exceptionLog` via `src/lib/audit/logger.ts`

### Adding a New Rule
1. Create `src/lib/engine/rules/[rule-name].ts`
2. Export a `RuleEvaluator` object with `id`, `type`, `category`, `evaluate(context)`
3. Register it in `src/lib/engine/rules/index.ts`
4. Return an array of `RuleViolation` objects

### UI Components
- Use Radix UI wrappers from `src/components/ui/`
- Style with Tailwind CSS utility classes
- Accept `className` prop for flexibility
- No Redux/Zustand — use React `useState` + URL params for client state

---

## Business Rules Summary

### Hard Rules (13 — cannot be violated)
- Minimum staff per shift (census-band-based)
- Charge nurse requirement (**Level 4+ only**; Level 5 preferred, Level 4 stand-in)
- Patient-to-nurse ratio
- ≥10 hours rest between shifts
- ≤5 consecutive working days
- ICU competency Level 2+
- Level 1 orientee must have Level 5 preceptor
- Level 2 in ICU/ER needs Level 4+ supervisor
- No overlapping shifts for same staff
- PRN staff can only work dates they submitted availability
- Approved leave blocks scheduling
- On-call limits (max 1/week, max 1 weekend/month)
- Max 60 hours in any rolling 7-day period (all 7 windows checked, not just backward)

### Soft Rules (8 — scored with penalties)
- Overtime (>40 h/week = HIGH penalty; extra ≤40 = LOW)
- Preference matching (shift type + days off)
- Weekend count (min 3 per 6-week period)
- Consecutive weekends (max 2)
- Holiday fairness (annual tracking)
- Skill mix (diverse experience per shift)
- Float penalty (minimize cross-unit assignments)
- Charge clustering (distribute charge nurses)

Full specification: `RULES_SPECIFICATION.md`

---

## Database Key Tables

| Table | Purpose |
|---|---|
| `unit` | Healthcare unit config (ICU, ER, etc.) |
| `staff` | Nurse/staff members |
| `staff_preferences` | Shift/day-off preferences |
| `shift_definition` | Shift templates |
| `schedule` | Scheduling periods (6-week blocks) |
| `shift` | Shift instances within a schedule |
| `assignment` | Staff-to-shift assignments |
| `rule` | 21 configurable rules |
| `census_band` | Patient count → staffing requirements |
| `staff_leave` | Leave requests + approval workflow |
| `prn_availability` | PRN date availability submissions |
| `shift_swap_request` | Staff swap requests |
| `callout` | Absence + escalation tracking |
| `open_shift` | Coverage requests (auto-recommended) |
| `scenario` | Schedule scenarios for comparison (Balanced/Fair/Cost variants) |
| `generation_job` | Background generation job tracking (pending/running/completed/failed) |
| `staff_holiday_assignment` | Annual holiday fairness tracking |
| `exception_log` | Full audit trail of all changes |

---

## Important Notes

- **No authentication system** — assumed internal hospital use
- **Single SQLite file** — sufficient for CAH scale, not for multi-facility
- **Synchronous DB** — `better-sqlite3` is sync; no `async/await` needed for DB calls
- **No caching** — direct DB queries on every request
- **Excel is the import/export mechanism** — no external system integrations
- **Audit everything** — all state changes must be logged to `exception_log`
- **Safe Harbor** — `safeHarborInvoked` flag exists on assignments (Texas law)

---

## Reference Documents

- `RULES_SPECIFICATION.md` — Complete rule definitions
- `CHANGELOG.md` — Feature history and migration notes
- `docs/01-introduction.md` through `docs/11-generating-schedules.md` — User-facing guides
- `src/db/seed.ts` — Canonical example of test data structure

---

## Working Style Preferences

- **Ground all suggestions in real-world nursing and hospital operations.** Before proposing any algorithm change, penalty weight, rule threshold, or workflow adjustment, reason through how it would play out in an actual hospital — consider payroll costs, staff fatigue, charge nurse responsibilities, and what a scheduling manager would naturally do. If a suggestion does not hold up to that test, revise it or flag the concern before implementing.
- When multiple approaches are possible, discuss the practical trade-offs first and ask for direction before writing code.

---

## Documentation Maintenance Rules

These are non-negotiable requirements for every change made to this codebase.

### RULES_SPECIFICATION.md
- Must always reflect the **exact, current logic** the application is running on
- Update this file whenever any change affects: rule behavior, thresholds, penalty weights, unit configuration, escalation logic, or any scheduling constraint
- Update the document version number and the inline changelog table at the bottom of the file
- Even bug fixes that correct rule behavior must be documented here — if the fix changes what the rule actually does in practice, it belongs in this document

### Beginner Documentation (docs/)
- The `docs/` folder contains user-facing guides written for non-technical staff
- Keep these aligned with the current state of the application
- `docs/05-scheduling-rules.md` is the most rule-sensitive — update it when rules change
- Language should remain simple and jargon-free; do not introduce technical implementation details

### CHANGELOG.md
- Add a new versioned entry for every commit that changes application behavior
- Review previous entries before writing a new one — match the established style, structure, and level of detail exactly
- Patch version (1.x.Y) for bug fixes; minor version (1.Y.0) for new features
- Each entry should explain: what changed, why it changed, and what files were modified
