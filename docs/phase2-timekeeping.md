# Phase 2 timekeeping

Phase 2 interprets timekeeping facts. It does not calculate salary, deductions,
overtime pay, statutory contributions, or payslips.

```
Raw punch evidence → effective time records → schedule + approved leave
  → daily attendance → staff approval → future payroll
```

## Database and setup

SQL migrations `0007`–`0016` extend Phase 1. Applied migrations remain immutable.
Run `pnpm --filter @hexpayroll/api migrate`, then
`pnpm --filter @hexpayroll/api schema:pull`. Introspection includes the new tables;
handwritten relationships remain in `apps/api/src/db/relations.ts`.

No employee, schedule, or leave entitlement is seeded. Configure schedules, assign
employees, and create organization-managed leave types before operational use.
The API worker starts with `pnpm dev:browser` or `pnpm dev`; it also runs in the
built API server. Calling the application factory alone does not start a worker.

## Dates, schedules, and history

- Calendar dates are PostgreSQL `date` and API `YYYY-MM-DD` values. They never pass
  through the workstation timezone. Effective assignment ends are **exclusive**;
  leave request end dates are **inclusive**.
- Schedule clocks are local PostgreSQL `time` values, with explicit zero/one day
  offsets. The schedule version captures the organization timezone at creation.
  PostgreSQL resolves these local boundaries to absolute instants. Duration
  calculations use elapsed time between those instants.
- Punches are PostgreSQL `timestamptz`. API/manual inputs require ISO timestamps
  with an explicit offset; responses use UTC ISO timestamps. Timekeeping displays
  use the organization timezone, not the browser timezone.
- Templates have immutable versions with seven weekday definitions. New versions
  must have a later effective start than the latest version. A historical start
  requires a reason and queues reprocessing. Status changes prevent new assignment
  to inactive schedules while preserving existing assignments.
- Assignment changes close the preceding applicable interval atomically. Overlaps
  are rejected under an employee lock. Explicit corrections require a reason and
  preserve previous revisions in assignment history. Both assignment changes and
  corrections advance the employee aggregate revision and its workforce outbox
  snapshot.
- Attendance preserves its schedule version, normalized evidence, approved leave,
  calculated values, review flags, and processor version. Replaced attendance
  revisions and manual adjustments remain inspectable.

## Interpretation rules

The server service resolves the assignment/version valid on the work date. An
overnight shift belongs to its starting calendar date. Punches within two hours
before/after a shift are candidates; overlapping candidate windows require review.
Up to two neighboring work dates in either direction are considered for shifts
that span midnight. Unknown punch types and invalid sequences are never guessed.

Two-punch and four-punch arrangements are supported. Typed IN/OUT intervals count
only their overlap with scheduled working intervals. Scheduled breaks, explicit
breaks, and approved leave are removed without subtracting overlapping exclusions
twice. Early arrival and work after the scheduled end remain raw evidence but do
not increase this Phase 2 scheduled-work total.

Worked seconds are summed and rounded **down** to whole minutes. Positive lateness
and early-departure seconds round **up**. Grace is a threshold: 08:03 with an 08:00
start and five-minute grace has zero late minutes; 08:12 has twelve late minutes.
Undertime measures early departure from the remaining expected end after leave.
No monetary consequence is calculated.

Statuses are `present`, `late`, `absent`, `on_leave`, `rest_day`, and `incomplete`.
Missing schedules, missing/unknown punches, ambiguous matching, and unexpected
rest-day/full-day-leave punches require review. An unpunched shift is not absent
until its two-hour matching allowance has closed. Rest-day approval also waits
for the calendar day to close.

Leave types capture paid/unpaid and approval requirements without entitlement or
balance automation. Approval-required requests start pending; other requests are
automatically approved with their submission actor recorded. Pending requests can
be approved, rejected, or cancelled; approved requests can be cancelled. Rejected
and cancelled requests are terminal. Rejection requires remarks.

Full-day approved leave removes the expected working intervals. Single-date half
leave selects the first or second half of working minutes, excluding breaks; an
odd minute belongs to the second half. Complementary halves may coexist. Otherwise
overlapping pending/approved requests are rejected, including concurrent submissions.
Pending/rejected requests never substitute for approved leave.

## Evidence, approval, and local processing

Original punches and correction events are append-only for the runtime database
role. Manual punches require an actor and reason. Replacement/void corrections
append an event with a correction revision and preserve original evidence.

Biometric adapters submit normalized batches to the API. Active device mappings
resolve the employee server-side. Stable device/external IDs are unique; replay
with different evidence is a conflict. Without an external ID, the uniqueness key
is device, device employee identifier, exact instant, and normalized type. Batch
replay creates no new punches. Unmapped identifiers are reported without creating
records. The adapter should consistently supply stable IDs when available; the
two deduplication modes are separate boundaries.

Business writes, audit, outbox, and processing invalidation share one transaction.
Mutable records require expected revisions. Audit follows Phase 1's changed-field
metadata policy; reasons remain on their business/correction records. Outbox
payloads use explicit allowlists and retain the existing 256 KiB limit.

Durable jobs survive restart. The worker claims one employee/day at a time with
row locks and commits the result and cursor together. Each tick processes at most
50 days. Short ranges receive priority, and multi-day jobs yield between days.
The scheduler recovers up to seven missed dates per minute and revisits yesterday
and today for shift closure. Automatic processing uses a null/system audit actor;
staff-requested processing retains its requester. Failed jobs retain a safe error
and resume when an authorized user requests reprocessing for their date range.

Daily attendance is unique by organization/employee/work date. An input hash makes
unchanged interpretation a no-op, preserving approval and existing adjustments.
Changed source data invalidates affected approval before background work runs.
New calculations retain prior snapshots and reset adjustments for review.

Approval is separate from interpretation: `unreviewed`, `approved`, `needs_review`.
Only closed, complete results without review flags or pending processing may be
approved. Adjustments append reasoned overrides and retain computed facts. They
require approval again and cannot clear missing/ambiguous source evidence merely
by changing the visible attendance status.

## API and permissions

All paths below are under `/api`. Authentication and current permissions are
enforced server-side; organization ownership comes from the session.

| Interface                                                                              | Operations                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/schedules`, `/schedules/:id`, `/:id/status`                                          | List, inspect versions, create, append dated version, activate/deactivate        |
| `/employees/:id/schedules`, `/schedule-assignments/:id`                                | Assignment history/change and auditable correction                               |
| `/time-records`, `/:id`, `/manual`, `/ingest`, `/:id/corrections`                      | Evidence filters/detail, manual punch, normalized device batch, replacement/void |
| `/leave-types`, `/leave-types/:id`                                                     | List, detail, create, update/configure                                           |
| `/leave`, `/leave/:id`, `/:id/approve`, `/:id/reject`, `/:id/cancel`                   | Requests, detail, controlled transitions                                         |
| `/attendance`, `/:id`, `/reprocess`, `/:id/approve`, `/:id/reopen`, `/:id/adjustments` | Daily results, history/evidence, processing, approval, adjustments               |
| `/timekeeping/context`, `/timekeeping/processing`                                      | Organization clock context and permission-protected pending/failed counts        |

Added permissions: `attendance.adjust`, `attendance.approve`,
`time_records.view`, `time_records.create_manual`, `time_records.correct`,
`time_records.ingest`, `schedules.view`, `schedules.create`, `schedules.update`,
`schedules.assign`, `leave.view`, `leave.create`, `leave.approve`, `leave.reject`,
`leave.cancel`, `leave.configure`. Existing attendance view/manage permissions
remain in use.

Administrators and Payroll Managers receive management/approval access. Clerks
receive read access plus manual punch and leave request entry; their former
reserved attendance-manage permission is removed. Viewers receive read access.
Custom role grants are not expanded automatically.

The `/schedules`, `/time-records`, `/leave`, and `/attendance` screens include
filters, pagination, empty/loading/error states, evidence and workflow actions.
Employee profiles show assignment history, current days/hours, and correction
controls. Dashboard counts come from persisted attendance with processing coverage;
present and late are separate counts. System Health separates ingestion timestamps
from hardware communication, which remains unconfigured without a vendor adapter.
Local queries and mutations use TanStack `networkMode: 'always'`; Internet is not a
prerequisite while local API/PostgreSQL services are healthy.

See [the implementation report](phase2-implementation-report.md) for verification
results and the boundary between completed work and deferred integrations.
