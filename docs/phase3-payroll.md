# Phase 3 payroll operations and contracts

Payroll runs locally through the same API used by the desktop and browser. There is
no Internet prerequisite for computation, review, or finalization. No statutory
rates, brackets, holiday multipliers, or sample financial totals ship as production
data. Synthetic reference fixtures exist only in automated tests.

## Preparation and lifecycle

1. Complete employee employment history, schedule assignments, and attendance
   processing/approval in the existing Phase 1/2 screens.
2. Create a company-approved monetary policy in Settings → Payroll Monetary
   Policies. Specify an effective range, monthly allocation, proration basis,
   rational daily divisor, standard paid minutes, attendance deduction settings,
   and contribution collection cutoff. Policy end dates are exclusive. Versions
   contents cannot be edited and applicability windows cannot overlap. Explicit
   supersession closes a predecessor window at the new start date, provided no
   finalized payroll's applicability would change.
3. Import verified SSS, PhilHealth, Pag-IBIG, and BIR rule versions under Settings →
   Statutory Tables. Check provenance before activation. Missing required versions
   block finalization even when a draft can display its non-statutory amounts.
4. Configure earning/deduction types and recurring employee assignments. One-time
   assignments identify a period; recurring assignments identify an inclusive date
   range and apply once per eligible period, without amortization or automatic
   partial-period proration. Every assignment requires a reason.
5. Create and open a period, compute, inspect employee explanations, resolve errors,
   recompute, mark the latest run reviewed, then finalize.

Periods are organization/frequency populations. Non-cancelled dates cannot overlap
for that population. Regular monthly periods cover full calendar months, weekly
periods cover seven days, and biweekly periods cover fourteen days. Semi-monthly
dates must match the existing company semi-monthly cutoff configuration. Partial
hire/termination pay is computed within regular windows, not by shortening the
period. States are `draft`, `open`, `review`, `finalized`, and
`cancelled`. Runs have `processing`, `computed`, or `failed` states. Processing is
synchronous and transactional; an infrastructure failure rolls back the attempt,
whereas employee calculation errors persist a failed run for inspection.

Review and finalization have separate permissions and record separate actors; the
same person may hold both permissions. Finalized periods cannot be reopened.
The default Viewer role has no payroll financial access. Assign the explicit
Payroll Viewer role for read access, or the relevant preparation/review permissions.
Corrections require a future adjustment/reversal feature rather than editing old
results. Cancelled periods cannot be edited either.

## Calculation rules

All authoritative amounts are safe integer centavos. PostgreSQL stores `bigint`;
API persistence responses serialize those values as integer strings. Shared
response schemas convert them to safe integers. Input amounts are integer
centavos; decimal peso text conversion is restricted to input/display boundaries.

Engine intermediates use `BigInt` numerators/denominators. Rounding is nearest
centavo, with midpoint away from zero, once per persisted calculation line.
Totals are exact integer sums. Allocation uses integer largest remainders with
stable index ordering. No engine stage uses the older floating-point money
multiplication helpers.

Eligibility uses effective employment intervals `[from,to)`, inclusive hire and
termination dates, active/on-leave employment status, organization, and matching
pay frequency. The current employee status does not exclude historical eligible
employment. Compensation changes produce separate basic-pay lines.

The calendar-month allocation policy pays a full monthly entitlement for a monthly
cutoff, half for a semi-monthly cutoff, and a calendar-day share for weekly/biweekly
cutoffs. Annual-period allocation uses monthly salary × 12 divided by 12, 24, 52,
or 26 respectively. Hire/termination/rate-change proration then uses eligible
calendar days or scheduled minutes over the full cutoff basis. These are explicit
company policies, not claims about legally mandated divisors.

Daily basic pay uses `(worked + paid leave minutes) / configured daily minutes`;
hourly basic pay uses those minutes / 60. Monthly absence, late, undertime, and
unpaid-leave adjustments use the configured rational daily divisor and minutes.
Daily/hourly missed time has zero-valued explanatory adjustment lines because it
was already excluded from basic pay. Paid and unpaid leave derive from approved
attendance's snapshotted leave treatment; odd half-day minutes assign the extra
minute to the second half, matching Phase 2.

Gross pay is the sum of earning lines, including basic pay. Attendance adjustments
are separate deduction lines and reduce taxable compensation. Company deductions
are post-tax. Non-taxable earnings and verified tax-deductible employee contribution
shares are excluded from taxable compensation. Net pay is gross minus ordinary
deductions, employee contribution shares, and withholding tax. Employer shares
remain separate expenses.

Monthly contribution basis is actual finalized month-to-date basic/gross earnings
plus the current run. A configured final cutoff defers collection until month end;
every-period collection reconciles the cumulative obligation each cutoff. Earlier
eligible dates require finalized payroll coverage. Prior employee and employer
collections are subtracted separately. Overcollection blocks the run and requires
a future correction mechanism. Cross-month monthly statutory allocation is not yet
supported: such runs produce an explicit blocking issue rather than assigning an
obligation to the wrong month. Period-frequency reference rules can be evaluated
for cross-month weekly/biweekly periods.

Automatic overtime/holiday/night-differential earnings are foundation only. The
pure premium function accepts approved source identity, minutes, rate basis, and
an explicit rational multiplier. Phase 2 supplies no approved premium facts yet.

## Verified reference import

`POST /api/payroll/rules/import` accepts:

```text
type: sss | philhealth | pagibig | bir
version: unique version within organization/type
effectiveFrom: YYYY-MM-DD
effectiveTo: YYYY-MM-DD or null; exclusive
agency, sourceTitle, sourceReference, verificationNote: nonempty text
rules:
  basis: basic | gross | taxable
  frequency: monthly | semi_monthly | weekly | biweekly
  effectiveDateBasis: period_end | pay_date
  minimumBasis: integer centavos
  maximumBasis: integer centavos or null
  employeeShareTaxDeductible: boolean
  brackets:
    lower: inclusive integer centavos
    upper: exclusive integer centavos or null
    fixedEmployee, fixedEmployer, excessOver: integer centavos
    employeeRate, employerRate:
      numerator: nonnegative integer string
      denominator: positive integer string
```

This describes the supported evaluator, not an official statutory table format.
Each share equals its fixed amount plus `max(0, capped basis - excessOver) × rate`,
rounded once. Brackets must begin at zero, be ordered and contiguous, and end
unbounded. Imports carry a SHA-256 content checksum, importer, and timestamp.
Activation records verifier/timestamp and prohibits overlapping active versions
for the same organization, type, and frequency. BIR tables for different
frequencies can coexist. An exact payroll-frequency contribution table takes
precedence over a monthly fallback. Multiple matches under conflicting
effective-date policies block calculation.

Active rule contents are immutable. Activation can specify `supersedesId` to
close an earlier matching version's applicability window at the new effective
date. Both reference events commit atomically; finalized payroll that used the
earlier version on/after that date blocks supersession. Import checksums continue
to identify original submitted documents; window supersession is separately
audited. Monetary policy creation supports the same explicit predecessor option.

BIR requires a taxable basis matching the payroll frequency. Monthly contribution
rules require basic or gross basis; a taxable contribution basis is rejected as
unsupported rather than introducing a circular tax calculation. BIR annualization,
exemption categories, and statutory formulas beyond this declarative evaluator
must be added and verified before importing data that require them. No authority
verification is inferred merely from uploading JSON: activation is the authorized
operator's explicit verification event.

## API and permissions

All endpoints authenticate through existing sessions, enforce organization scope,
and use existing error envelopes. Requests use camelCase; persisted resource
responses use database column names, with shared Zod response contracts.

| API under `/api/payroll`                                    | Behavior                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET/POST /periods`                                         | List persisted periods / create a draft                              |
| `GET /periods/:id`                                          | Latest run, employee results, historical run summaries, stale status |
| `GET /periods/:id/runs/:runId`                              | Inspect a historical run and its employee results                    |
| `GET /periods/:id/results/:resultId`                        | Preserved inputs, earnings, deductions, contributions, tax trace     |
| `POST /periods/:id/open`, `/cancel`, `/review`, `/finalize` | Revision-guarded state transitions                                   |
| `POST /periods/:id/compute`, `/recompute`                   | Batch computation with revision and UUID idempotency key             |
| `GET/POST /types`                                           | Earning/deduction catalog; GET selects `kind=earning                 | deduction` |
| `GET/POST /entries`                                         | Recurring/one-time assignments; GET selects kind                     |
| `POST /entries/:id/deactivate`                              | Stop an assignment, preserving historical snapshots                  |
| `GET/POST /policies`                                        | Inspect / create immutable monetary policies                         |
| `GET /rules`                                                | Contribution rules; `kind=deduction` selects BIR                     |
| `POST /rules/import`, `/rules/:id/activate`                 | Import and explicitly verify/activate reference versions             |

Transitions take `expectedRevision` and optional `warningAcknowledgments` (issue
codes). Computation additionally takes `idempotencyKey`; retry the same key after a
transport failure. Ordinary compute refuses a period with an existing run;
recompute creates a new run and invalidates review. Closed periods reject retries
and new computation. HTTP errors contain actionable messages and omit driver
details. Missing references and unsupported bases never become valid zero amounts.

Administrator/payroll-manager defaults include payroll preparation, review,
finalization, and reference configuration. Clerks can prepare/recompute and manage
ordinary entries; viewers can inspect. Permissions can be assigned independently.

## Finalization and offline events

Canonical SHA-256 fingerprints include eligible employee identities, employment,
attendance/revisions, schedules, policy, payroll configuration, entries/type
revisions, applicable rules, prior finalized monthly collections, pending jobs,
and evidence identities. Evidence is inspected for freshness only; no punch
interpretation occurs in payroll. Complete, approved attendance must agree with
current assignments, applicable schedule versions, approved leave revisions, and
current punch/correction identities.

Payroll transitions acquire a PostgreSQL organization transaction advisory lock
before the period row lock. Source-write database triggers acquire the same lock,
covering direct SQL and worker mutations as well as API services. Integrity and
freeze triggers lock before checking parent state. Conflicting source changes
either commit before finalization and invalidate its fingerprint, or occur after
the immutable result has been committed. Period revisions guard competing users.

Finalization verifies current inputs, review, warnings, employee/line reconciliation,
period totals, and nonnegative net pay, then freezes the run and period and writes
audit/outbox events in one transaction. Result row status records its calculation
outcome; the run's `finalized` flag and period state are the authoritative lifecycle.
All results and lines belonging to a finalized period, including historical runs,
are protected from writes. Result/line update/delete/truncate privileges are also
revoked from the application role.

Offline events are separate period/run/result/line/reference entities. Run events
omit the potentially large batch snapshot; employee-result events contain their
reproducible input contexts. Individual events retain the 256 KiB bound and fail
safely if exceeded. Full sync transport/receiver/chunking remains deferred.
Success audit and outbox are atomic; rejected finalization is audited separately
after rollback with a safe error code. No credentials are stored in payroll traces.

## Verification

Run engine tests with `pnpm --filter @hexpayroll/payroll-engine test`, API and isolated
PostgreSQL tests with `pnpm --filter @hexpayroll/api test:local`, browser tests with
`pnpm --filter @hexpayroll/web test`, then workspace `typecheck`, `lint`,
`format:check`, and `build`. Local database tests use randomly named isolated
schemas and the DML-only application role, leaving production workforce/payroll
data untouched. See the Phase 3 implementation report for exact results.
