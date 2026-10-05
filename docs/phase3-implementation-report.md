# Phase 3 implementation report

Implemented the local deterministic payroll workflow across PostgreSQL, shared
contracts, the pure engine, authenticated API services, and browser screens.
Operational instructions and calculation conventions are in
[Phase 3 payroll operations](phase3-payroll.md).

## Persistence and integrity

Up-only migrations `0017` through `0027` were added and applied to the configured
local database. Previously applied migrations were preserved. The database schema
was regenerated through `schema:pull`; composite foreign-key column ordering is
verified against PostgreSQL catalog metadata during generation.

The new tables store periods, historical runs, employee results and snapshots,
earning/deduction types and entries, normalized earning/deduction/contribution
lines, monetary policies, and statutory rule sets. Tax traces, validation issues,
review acknowledgments, actors, revisions, and canonical input hashes are persisted
with their aggregates. Organization-qualified references, population overlap
guards, request-key uniqueness, employee membership uniqueness, monetary bounds,
and effective-date lookup indexes enforce consistency.

Periods progress through draft, open, review, and finalized; cancellation is
available before finalization. Each recomputation creates a historical run.
Completed calculations and their children cannot be rewritten. PostgreSQL guards
protect finalized periods and every associated historical run, result, snapshot,
and line. Future correction linkage is reserved without implementing reopening.

An exclusive organization transaction advisory lock serializes payroll source
mutations and finalization. Period row locks and revision checks provide additional
protection. Source mutation triggers cover the existing employment, attendance,
leave, schedules, configuration, evidence, and correction paths. Finalization
reloads inputs and compares hashes under that protocol, including population and
pending processing changes. Review, warning acknowledgments, successful latest
run, complete rules, consistent totals, and nonnegative net pay are required.

Successful finalization, audit, and outbox writes commit atomically. Rejected
finalization attempts are audited separately after rollback. Compact aggregate
events and separate result/line entities retain the existing 256 KiB outbox bound;
oversized individual snapshots produce an actionable error and rollback.

## Engine and orchestration

Engine version `0.3.0` implements compensation resolution, basic pay, attendance
adjustments, earnings, contributions, ordinary deductions, taxable compensation,
withholding tax, reconciliation, and validation as pure stages. All four
frequencies are supported. Effective employment intervals, compensation changes,
hire/termination boundaries, and historical active/on-leave employment determine
eligibility independently of the current employee status.

Explicit company monetary policies select monthly allocation, proration, rational
daily divisor, standard paid minutes, attendance adjustments, and monthly
collection cutoff. Existing organizations receive no activated monetary default.
Monthly pay separates entitlement/proration from attendance reductions. Daily and
hourly pay use approved payable worked time plus paid leave; excluded missed time
is not deducted twice. Partial leave uses approved schedule/leave snapshots.
Missing, incomplete, unapproved, or outdated scheduled-day attendance blocks
completion. Payroll does not interpret biometric punches.

Money uses BigInt rational intermediates and nearest-centavo rounding with ties
away from zero. Each persisted line rounds once; totals sum exact integers.
Unsafe output values fail validation. Rational trace components serialize as
integer strings, and peso display preserves centavos near the safe-integer limit.

The API bulk-loads context and persists per-employee errors alongside successful
draft results. Snapshots capture source revisions, identity, eligibility, policy,
rules, prior monthly collections, and engine version. Canonically sorted inputs
produce deterministic hashes. Request UUIDs reuse completed attempts; explicit
recomputation does not duplicate recurring or manual source entries. Entries
require reasons and recurring amounts apply once per eligible period.

## Statutory verification status and boundaries

**Production statutory data await verification and import.** No government rates,
brackets, or contribution tables were researched or seeded. Test fixtures are
explicitly synthetic and cannot serve as legal payroll references.

Organization-scoped JSON imports support inspection, source references, importer
and verifier metadata, checksums, effective-date policies, activation, and
non-overlapping applicability by agency/frequency. Activated contents are
immutable. Explicit prospective supersession can shorten a predecessor window
without changing finalized payroll applicability.

Declarative evaluators provide brackets, rational rates, fixed shares, bounds,
employee/employer allocation, deductible-share treatment, and BIR bracket/base/
excess/rounding traces. Employer shares never reduce employee net pay. Configured
monthly collection reconciles against earlier finalized collections and detects
overcollection. Missing or unsupported rules block finalization rather than being
treated as zero.

Monthly statutory allocation across a cross-month period remains unsupported and
produces a blocking issue. Weekly/biweekly basic pay can span months; applicable
frequency-specific statutory rules can be used. Agency-specific legal formulas,
special tax regimes, and annualization are not certified by this foundation.

**Premium earnings are foundation only.** Explicit rate-basis/rational-multiplier
interfaces are available. Automatic overtime, holiday, and night differential
remain unavailable pending approved upstream facts and verified rules.

## API, interface, and permissions

Authenticated `/payroll` routes cover periods, run history, results, computation,
recomputation, review, finalization, cancellation, types, recurring/manual entries,
monetary policies, and statutory import/activation. Route handlers delegate domain
work to services after authorization and validation.

The browser provides `/payroll/periods`, period review and historical runs,
employee explanations, persisted totals, source/rule snapshots, validation issues,
and stale recomputation notices. Payroll configuration contains earnings and
deductions; Settings contains monetary policies and statutory versions. Dashboard
payroll summaries use persisted data and are permission-filtered. Historical runs
retain their own calculation status rather than inheriting finalization labels.

Preparation, review, finalization, entry management, and statutory configuration
have separate permissions. The default Viewer role does not expose financial
payroll data; an explicit Payroll Viewer role provides payroll read access.
Preparer, reviewer, and finalizer can be the same authorized person. Payroll
queries support local API access while offline and sensitive caches clear when
authorization changes.

## Verification

Executed successfully against this workspace and local PostgreSQL:

| Check                                           | Result                         |
| ----------------------------------------------- | ------------------------------ |
| Payroll engine tests                            | 42 passed; 0 failed; 0 skipped |
| API tests including isolated PostgreSQL schemas | 46 passed; 0 failed; 0 skipped |
| Playwright browser tests                        | 9 passed                       |
| Workspace typecheck                             | Passed                         |
| ESLint                                          | Passed                         |
| Prettier formatting check                       | Passed                         |
| Workspace production build                      | Passed                         |

Coverage includes frequencies and compensation bases, boundary hires/terminations,
rate changes, partial paid/unpaid leave, attendance deductions, recurring/manual
entries, exact rounding and large totals, synthetic statutory shares and tax
treatment, historical rules, reconciliation, overlap races, retries, concurrent
computation/finalization, stale source mutations, immutable children, permission
denial, and audit/outbox rollback. Browser tests cover creation, errors,
explanations, stale recomputation, permitted actions, and finalization alongside
the existing Phase 1/2 flows. Database tests use isolated schemas and clean up their
fixtures; they do not seed production payroll data.

No requested verification suite was skipped. The production build emitted
non-fatal warnings about the web bundle size, dependency comment annotations, and
the existing desktop renderer configuration. Formatting normalized six existing
workspace files in addition to the payroll changes.

## Deferred scope

Stopped at Phase 3. Payslip distribution, remittances, banking, accounting,
advanced loan amortization, retroactive/supplemental payroll, cloud sync, and
adjustment/reversal runs remain deferred. No deployment or publishing was done.
