# Phase 2 implementation report

Report date: October 5, 2026, Asia/Manila.

Phase 2 establishes persisted timekeeping and staff approval on top of Phase 1.
It preserves the separation between raw evidence, interpreted attendance, and the
future payroll engine. No payroll calculation, leave balance deduction, statutory
entitlement automation, or synchronization transport has been implemented.

## Database

Ten up-only SQL migrations were created and applied to the configured local
database. The existing migration history was preserved, and schema generation was
run through the repository's `schema:pull` workflow. Generated schema was not edited
manually. Handwritten relations cover the new domain and its history records.

| Migration                                   | Purpose                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `0007_schedules.sql`                        | Templates, immutable versions/weekday definitions, effective-dated assignments, overlap protection    |
| `0008_time_records.sql`                     | Append-only punches/corrections, device deduplication, ingestion timestamps                           |
| `0009_leave.sql`                            | Configurable leave types, request workflow, serialized overlap validation                             |
| `0010_attendance.sql`                       | Daily results, history/adjustments, durable processing jobs/cursors                                   |
| `0011_timekeeping_permissions.sql`          | Extended permission catalog and built-in role defaults                                                |
| `0012_overnight_break_integrity.sql`        | Duration-based overnight break bounds, replacing a clock-wrapping check without modifying applied SQL |
| `0013_timekeeping_evidence_constraints.sql` | Immutable version name/code snapshots, manual-reason/rest-day constraints                             |
| `0014_schedule_assignment_history.sql`      | Append-only assignment revision snapshots                                                             |
| `0015_automatic_processing_actor.sql`       | Null/system actor for automatic processing instead of attributing it to an arbitrary user             |
| `0016_processing_queue_fairness.sql`        | Short-range priority, per-day yielding, queued reprocessing reason                                    |

Fifteen tables were added:

- `work_schedules`, `work_schedule_versions`, `work_schedule_days`,
  `employee_schedule_assignments`, `schedule_assignment_history`.
- `time_records`, `time_record_corrections`, `biometric_ingestion_state`.
- `leave_types`, `leave_requests`.
- `attendance_records`, `attendance_history`, `attendance_adjustments`,
  `attendance_processing_jobs`, `attendance_processing_cursors`.

New entity keys use PostgreSQL UUIDv7. Organization-scoped composite foreign keys
protect employee, schedule, version, leave type, and attendance relationships.
History is retained rather than cascade-deleted. Checks enforce controlled states,
positive revisions, valid shift/break bounds, partial-day leave dates, date ordering,
nonnegative minutes, and required correction/manual reasons.

Unique boundaries include organization/schedule code, schedule/effective start,
version/weekday, organization/employee/work date, source device/external identifier,
fallback punch identity, and entity/history revision. Employee locking plus database
triggers prevent concurrent assignment and pending/approved leave overlaps.

Indexes support attendance by organization/date/status, employee punch instants,
leave date/status searches, assignment effective dates, ingestion deduplication,
and prioritized worker claims. Phase 1 employment indexes support historical
department filters.

The runtime role has no UPDATE/DELETE/TRUNCATE access to original punches,
corrections, schedule version/day evidence, or append-only history/adjustment tables.
Live runtime permission checks confirmed original-punch and schedule-version UPDATE
privileges are false.

## Schedules

Reusable templates have dated immutable versions with seven weekday definitions,
optional breaks, per-day grace, timezone/name/code snapshots, and explicit next-day
offsets. A 22:00–06:00 shift with a next-day 02:00–03:00 break is supported and was
tested against PostgreSQL, not just client validation.

Assignment intervals use inclusive start/exclusive end semantics. Changes close
the preceding applicable assignment atomically; explicit corrections preserve its
previous revision. Overlap/stale-revision checks prevent silent replacement.
Assignments advance the employee revision and emit its existing workforce snapshot
alongside assignment audit/outbox events. Historical attendance resolves the dated
assignment/version and retains the calculation's evidence snapshot.

Template version edits require a later effective start than the latest existing
version. Historical changes require a reason and enqueue affected dates. Inactive
templates cannot receive new assignments but continue explaining existing history.

## Time records

Sources are controlled as biometric, manual, import, and system. Biometric batch
ingestion and manual entry are implemented; import/system are schema/service
foundations without dedicated import or device-vendor tooling.

Authenticated ingestion resolves active device mappings on the server. Stable
device/external IDs prevent replay duplication and reject conflicting reuse. The
fallback key uses device, device employee identifier, exact instant, and normalized
type. Unknown types remain reviewable. Unmapped employee identifiers are reported
without manufacturing punches. Both stable-ID and fallback replay were tested.

Manual punches store actor, reason, source, creation instant, and the supplied
absolute timestamp. Corrections append replacement/void events using expected
correction revisions. Original biometric evidence remains unchanged and inspectable.
The UI visibly separates original source evidence from correction provenance.

Last successful ingestion and latest punch timestamp are tracked independently.
These do not imply hardware connectivity: vendor SDK communication remains
unconfigured, and React never accesses hardware directly.

## Attendance

A dedicated server processor resolves dated schedules, approved leave, effective
corrections, typed punches, and review flags. Routes validate/authorize and delegate;
React contains no attendance calculation logic.

Work dates belong to shift starts. Automatic matching allows two hours before/after
each shift and checks neighboring dates for ambiguity. Missing schedules, missing
punches, unknown types, invalid sequences, or ambiguous windows require review.
Absence waits for the matching window to close. Rest-day approval waits until the
calendar day has closed.

Worked time counts paired intervals within the scheduled working intervals.
Scheduled breaks, explicit break intervals, and leave exclusions are combined
without double deduction. Two-punch and four-punch arrangements are supported.
Out-of-schedule time remains raw evidence rather than being monetized.

Worked seconds round down to whole minutes; positive late/undertime seconds round
up. Grace is a threshold: beyond it, late minutes start at scheduled start. Undertime
records departure before the remaining expected end after leave. Statuses are
present, late, absent, on leave, rest day, and incomplete.

Results are unique per organization/employee/work date. Input hashes make unchanged
processing a no-op, preserving approval and adjustments. Changed input invalidates
affected approval, retains prior results, and calculates a new reviewable result.
Durable jobs survive restart, claim employee/day work with row locks, and commit
attendance/cursor changes together. Short ranges receive priority and long jobs
yield between days. Failed processing rolls back its business/audit/outbox writes,
keeps its date cursor, and becomes visible for authorized retry.

Explicit approval records actor and timestamp. Incomplete/open/flagged results and
results with pending processing cannot be approved. Reopening and reasoned manual
adjustments produce revisioned audit/outbox changes; computed facts and adjustment
history remain available. An override cannot erase unresolved source-evidence flags.

## Leave

Organization-managed leave types capture paid/unpaid and approval requirements.
Requests retain type snapshots so later type renaming/configuration does not change
their explanation. Approval-required requests begin pending; other types record
automatic approval using the submission actor.

Pending requests may be approved, rejected, or cancelled; approved requests may be
cancelled. Rejection requires remarks. Every transition records actor, timestamp,
remarks, and revision. Terminal states cannot be silently reopened.

Full-day ranges and single-date first/second-half leave are available. Half-day
splits use scheduled working minutes excluding breaks, with an odd minute assigned
to the second half. Complementary halves may coexist. Overlapping pending/approved
intervals are rejected, including concurrent submissions.

Only approved leave affects expected work. Approval/cancellation queues attendance
reprocessing atomically. Pending/rejected leave never changes absence into on-leave.
Balances and statutory entitlement rules remain deferred.

## Security, audit, offline, and sync foundation

The shared permission catalog adds attendance adjustment/approval, raw-record
view/manual/correction/ingestion, schedule management/assignment, and leave
configuration/request/transition permissions. Administrators and Payroll Managers
manage and approve; Clerks enter manual punches and leave requests; Viewers read.
Custom roles are not expanded automatically.

API tests verify forbidden manual entry, schedule assignment, leave approval, and
attendance adjustments, plus organization isolation and stale revisions. Frontend
visibility improves UX while backend permissions remain the enforcement boundary.
Session-scoped timekeeping query caches are cleared when authorization changes or
the user signs out.

Mutations share a transaction with Phase 1 audit/outbox events and processing
invalidation. Explicit payload allowlists and the existing payload/revision format
are preserved. Outbox failure tests verify rollback instead of a partial commit.
Automatic attendance events use a null/system actor; staff requests retain their
requester. Audit retains the established changed-field metadata policy and excludes
credentials/driver errors.

Local API/PostgreSQL operation requires no Internet. TanStack reads and writes use
`networkMode: 'always'`. Sync transport, receiving, retries/conflict reconciliation,
and installation node provisioning remain future work; this phase does not mark
queued events as synchronized.

## UI

Created `/schedules`, `/time-records`, and `/leave`; replaced `/attendance` with
persisted results, evidence/history, adjustments, reprocessing, approval/reopening,
and pending/failed job visibility. Lists include filtering, pagination, and operational
loading/empty/error states. Selection lists fetch beyond the first 100 records.

Employee profiles show current schedule days/hours, effective dates, assignment
history, changes, and reasoned correction controls. Navigation retains Workforce,
System, and Administration sections, with Dashboard first.

Dashboard attendance counters and recent rows now come from persisted results;
present and late are separate counts, with processed/pending/review coverage shown.
Historical schedule and leave type labels use their versions/snapshots. Organization
timezone controls timekeeping display and user-login timestamp formatting.

System Health shows ingestion timestamps separately from unconfigured hardware
communication. Device disconnection does not disable historical attendance or
authorized manual workflows.

## Verification

| Command/check                                    | Result                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @hexpayroll/api migrate`          | Applied `0007`–`0016`; existing history preserved                                                                                                                                                                 |
| `pnpm --filter @hexpayroll/api schema:pull`      | Passed; generated schema includes Phase 2 tables                                                                                                                                                                  |
| `pnpm typecheck`                                 | Passed across all workspace packages                                                                                                                                                                              |
| `pnpm lint`                                      | Passed, no errors or warnings                                                                                                                                                                                     |
| `pnpm --filter @hexpayroll/api test`             | 22 passed, 3 database tests skipped, 0 failed                                                                                                                                                                     |
| `pnpm --filter @hexpayroll/api test:local`       | 25 passed, 0 skipped, 0 failed                                                                                                                                                                                    |
| `pnpm --filter @hexpayroll/web test`             | 6 passed, 0 failed on final run                                                                                                                                                                                   |
| `pnpm build`                                     | Passed for shared, payroll-engine foundation, API, web, and desktop shell                                                                                                                                         |
| `git diff --check`                               | Passed                                                                                                                                                                                                            |
| `pnpm dev:browser` live smoke                    | Login rendered with no JavaScript errors; local API/database healthy; HTTP 200 with browser offline signal                                                                                                        |
| Runtime append-only privileges / worker failures | Original punches and schedule versions cannot be updated; zero failed processing jobs at smoke check                                                                                                              |
| Fresh `pnpm dev` launch                          | Partial verification: initial inherited `ELECTRON_RUN_AS_NODE` failure; retry with that flag cleared encountered occupied port 5273. Existing desktop session was left untouched. Desktop build/typecheck passed. |

The API tests use real PostgreSQL and isolated schemas, including authentication,
HTTP routes, domain writes, constraints, concurrency, and transaction rollback.
Browser workflow tests use API fixtures and verify the complete staff interaction
and Viewer restrictions. The live browser smoke uses actual local services.

Tests cover normal/two/four-punch attendance, grace, second-level rounding, late/
undertime, incomplete/unknown/ambiguous evidence, rest days, full/half-day leave,
odd-minute splits, overnight database schedules, effective dates/history, biometric
replay/conflicts/unmapped IDs, manual records/corrections, adjustments, approval
invalidation, unchanged processing, failed-job recovery, concurrent leave overlap,
organization isolation, and database-session timezone independence.

The build retains existing Electron renderer-configuration and dependency Rollup
annotation warnings; they do not fail compilation. A browser run overlapping build
activity timed out in an existing Settings-navigation test; the isolated final
browser run passed all six tests. The PostgreSQL same-connection concurrency warning
was fixed rather than suppressed, and the complete PostgreSQL suite was rerun successfully.

## Remaining work classification

| Classification      | Items                                                                                                                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Complete**        | Persisted schedules/assignments/history, raw evidence and corrections, deduplication, manual records, leave types/workflow/partial days, interpretation/reprocessing/approval/adjustment history, permissions, atomic audit/outbox, operational screens, employee profile, real dashboard data, browser/local database operation |
| **Partial**         | Fresh desktop first-launch verification in this environment; build/typecheck and live browser verification passed, but a fresh desktop stack could not be isolated from the existing session/port                                                                                                                                |
| **Foundation only** | Normalized biometric API adapter, import/system source types, outbox transport compatibility and existing node/conflict foundations                                                                                                                                                                                              |
| **Deferred**        | Vendor SDK/hardware connection, dedicated import tooling, leave balances/entitlements, holidays/official business/advanced scheduling, payroll calculations/payslips/contributions, full synchronization engine and packaged private database deployment                                                                         |

Operational conventions and endpoint/permission details are documented in
[Phase 2 timekeeping](phase2-timekeeping.md). Large snapshots retain Phase 1's
256 KiB outbox bound; exceeding it fails safely rather than committing attendance
without its corresponding event. Future sync work should define snapshot/chunking
and receiver policy before attempting replication.
