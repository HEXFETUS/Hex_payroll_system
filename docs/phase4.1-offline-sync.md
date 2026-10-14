# Phase 4.1 — offline synchronization foundation

Phase 4.1 hardens the local outgoing worker. The existing central HTTP protocol,
ledger, inbox, and account receiver remain supported; this phase adds no central
business replication, conflict UI, deployment, or Electron packaging.

## Reused infrastructure and migration

Reuse PostgreSQL 18, UUIDv7 defaults, the checksum-verified SQL migration runner,
transaction helper, audit trail, entity snapshot projections, revision guards,
outbox statuses/leases/receipts, enrollment credentials, session permissions,
and TanStack Query health integration. Money remains integer centavos; finalized
payroll guards and history are unchanged.

Migration `0033_offline_sync_foundation.sql` adds `sync_local_identity` and outbox
`origin_node_id`, `base_revision`, `publication_sequence`, and
`retry_cycle_attempts`. Existing columns are reused. Origin is organization-scoped
through a composite foreign key to `sync_nodes`. A lazy transactional identity
uses an existing active node (preferring an enrolled node), or provisions an
unenrolled UUIDv7 node; no Internet or token is required to save local work.
Enrollment/import changes the identity for future events without rewriting
origins in existing events. The existing wire protocol still authenticates the
current sending node; historical origin metadata is retained locally for the
future versioned protocol.
Worker startup also adopts the locally validated configured node for future
publication, preserving queued origins if configuration predates this migration.

The migration backfills publication order by `created_at,id`. Historical commit
order cannot be reconstructed. Existing acknowledgments and event identities
are retained. Use the project migration runner, then `schema:pull`; never edit
past migrations or use Drizzle push. Introspected SQL is not migration authority.

## Atomic mutations and ordering

Foundation and timekeeping publish through the existing snapshot projection into
the shared `enqueueOutbox` helper. Payroll uses the same insertion helper while
retaining its existing raw snapshot format and payload-size guard. Business data,
audit, and publication use one PostgreSQL transaction client. Creates have base
revision zero; the existing mutation paths increment revisions by one, so their
update/archive base is the preceding revision. The helper also accepts an
explicit base revision.

The SQL insertion trigger obtains an organization transaction advisory lock
before allocating a publication sequence. The lock lasts until commit/rollback,
so another publisher cannot commit a higher sequence before its predecessor.
Sequence gaps after rollback are harmless. This trigger also covers existing
account exports and direct SQL inserts, without duplicating their payload logic.
It uses invoker permissions, not a privileged security-definer function.

Delivery uses strict organization FIFO. Claimers take a separate organization
transaction advisory lock and inspect a locked, ordered prefix of unsynchronized
events. They never skip a processing, deferred, or failed predecessor. A failed
head blocks the organization until administrator retry. Other organizations and
local operations remain independent. Network calls happen after claim commit,
outside business transactions and database locks.

Schedule masters now publish before schedule versions. Payroll runs publish
before employee results, which precede earning/deduction/contribution lines.
Employment remains embedded in the employee aggregate snapshot. Schedule days
remain embedded in their version snapshot. Attendance/schedule history and
processing queues remain derived local infrastructure rather than duplicate
replication events. Biometric ingestion state is local device diagnostics.
Audit-only rejected-finalization records describe a failed operation, not a
committed business mutation.

The mutation review found the normal foundation, timekeeping, and payroll paths
already transactional. Their payload behavior is preserved. A pre-existing
account creation bug attempted tenant export before company setup; initial
account creation now retains its audit and skips export until a tenant exists.
Existing account export after setup remains supported. Login, sessions, roles,
and credential handling are otherwise unchanged.

## Worker, retries, and recovery

The push adapter exposes stable IDs plus local organization/origin/base-revision
metadata and a cancellation signal. The HTTP adapter explicitly projects the
existing central wire shape. Injectable adapters exist for testing and future
integration; there is no fake production central server.

| Configuration             | Default    | Accepted values                              |
| ------------------------- | ---------- | -------------------------------------------- |
| `SYNC_MODE`               | `disabled` | Existing disabled/local/central modes        |
| `SYNC_INTERVAL_MS`        | 15000      | 1000–300000 ms                               |
| `SYNC_BATCH_SIZE`         | 3          | 1–3, matching the current central contract   |
| `SYNC_REQUEST_TIMEOUT_MS` | 10000      | 100–60000 ms                                 |
| `SYNC_LEASE_MS`           | 30000      | 1000–300000 ms; greater than request timeout |
| `SYNC_MAX_ATTEMPTS`       | 10         | 1–100 attempts per automatic cycle           |

Each claim increments lifetime and cycle attempts and stores last-attempt time,
lease token, and expiry. Transient failure uses equal jitter between half and
all of `min(300 seconds, 2 seconds × 2^(attempt−1))`. HTTP 400/401/403/409/413/422
or cycle exhaustion requires administrator review. Retrying failed events
resets cycle attempts and scheduled delay, preserving lifetime attempts.

Only a complete validated durable receipt set can acknowledge a batch. Event
IDs and central sequence values must be unique and every claimed event must
match. Acknowledgment commits atomically and requires a still-valid owned lease.
A stale or partially reclaimed batch cannot be partially acknowledged. Lost
responses resend the same IDs for central deduplication: delivery is at least
once, never exactly once.

Shutdown stops scheduling and aborts transport immediately, waits for active
database work and ownership-safe claim cleanup, and then closes the pool. A
crash leaves durable processing events; an expired lease is reclaimed unless
the retry cycle has exhausted. Expired workers cannot acknowledge or overwrite
a newer owner. Pull and inbox processing continue independently of a failed
outgoing head. Local attendance, leave, and payroll require no central access.

## API and UI

`GET /api/sync/summary` remains session-authenticated and requires `sync.view`.
Existing mode, provisioning, queue, conflict, and inbox counts remain available.
The strict shared schema now matches the API, including:

- `lastSuccessfulPush`: maximum persisted synchronized receipt timestamp, or null.
- `workerState`: disabled, starting, idle, running, blocked, stopping, or stopped.
- `transportAvailability`: unconfigured, unknown, available, or unavailable.
- `lastTransportVerification`: timestamp of the latest verified response/failure.

Worker diagnostics are process-owned and organization-scoped. After restart,
transport starts unknown. Availability expires to unknown after two configured
poll intervals. A configured endpoint, browser connectivity, or successful HTTP
connection without a valid protocol response never means central is available.
Database/inbox errors do not erase a verified remote response.

System Health and Sync Status parse the shared contract and scope cache keys to
organization and session. Failed status fetches suppress cached success labels.
The health refresh also refreshes sync when permission allows. No secrets or
payroll payloads are exposed through status or error text.

## Validation and next phases

New tests cover populated migration backfill, atomic creation and rollback,
pre-enrollment origins, enrollment history, concurrent publication, duplicate
workers, dependency blocking, jitter, timeouts, retry exhaustion, administrator
retry, expired leases, stale/invalid/duplicate receipts, cancellation, restart,
status expiry, and tenant isolation. Existing domain integration workflows now
first attempt an unreachable HTTP transport, then continue through attendance,
leave, payroll computation, finalization, immutability, and rollback checks.

Use the existing dedicated `hexpayroll_test` database fixture with effective
`hexpayroll_app` runtime permissions and `hexpayroll_migrator` schema ownership.
The fixture explicitly merges URL startup options with its isolated search path
so role settings cannot accidentally direct tests into public tables.

Phase 4.2/4.3 still require bootstrap/snapshot policy, versioned provenance/base
revision transport, entity-specific business receivers, transaction grouping,
business conflict handling, actor mapping, and central deployment validation.
Strict FIFO preserves outgoing dependencies but does not reconstruct missing
pre-existing central business data. A durable transport receipt is not proof of
business replication. Do not automatically enable transport or advance phases.

## Implementation report — October 14, 2026

Migration `0033` was applied to the local `payroll_sys` database through the
project runner. The existing migrations were unchanged. Drizzle schema was
regenerated with `schema:pull`. No private `.env` file was modified, no production
central endpoint was contacted, and no deployment or packaging was performed.

The complete API suite passed **102 tests, 0 failures, 0 skipped**. Tests used
isolated schemas in a newly created dedicated `hexpayroll_test` database, with
`hexpayroll_migrator` schema ownership. Since local app login credentials were
not configured, runtime connections used the existing local connection with
PostgreSQL startup `role=hexpayroll_app`; all runtime queries executed with that
role's DML permissions. The existing tests verified forbidden DDL and immutable
ledger/history permissions. Test schemas were removed by the fixtures; the
dedicated test database remains available for future runs. Test connection
settings were supplied only to child processes, not written to `.env`.

| Check                                           | Result                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Complete API unit/integration suite             | Passed: 102/102, no skips                                           |
| `pnpm typecheck`                                | Passed across the workspace                                         |
| `pnpm lint`                                     | Passed                                                              |
| `pnpm build`                                    | Passed across the workspace; final API changes rebuilt successfully |
| Formatting of changed TypeScript/Markdown files | Passed                                                              |
| `pnpm format:check`                             | Existing failures in two unchanged setup guides listed below        |
| `git diff --check`                              | Passed                                                              |

The repository-wide formatting failures are
`docs/HEX_PAYROLL_LAPTOP_2_FRESH_SETUP.md` and
`docs/HEX_PAYROLL_VPS_SETUP_GUIDE.md`. Both were verified unchanged from HEAD and
left outside the implementation diff.

### New files

- `database/migrations/0033_offline_sync_foundation.sql`
- `apps/api/src/sync/delivery.ts`
- `apps/api/src/sync/outbox.ts`
- `apps/api/src/sync/status.ts`
- `apps/api/src/sync/transport.ts`
- `apps/api/src/sync/worker.ts`
- `apps/api/test/offline-fixture.ts`
- `apps/api/test/offline-sync-database.test.ts`
- `apps/api/test/sync-worker.test.ts`
- `docs/phase4.1-offline-sync.md`

### Modified files

- API configuration/startup: `apps/api/.env.example`, `apps/api/drizzle.config.ts`,
  `apps/api/src/config/env.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`.
- Mutation integration: `apps/api/src/auth/service.ts`,
  `apps/api/src/foundation/repository.ts`, `apps/api/src/foundation/router.ts`,
  `apps/api/src/payroll/services.ts`, `apps/api/src/timekeeping/services.ts`.
- Existing sync: `apps/api/src/sync/client.ts`, `apps/api/src/sync/import-node.ts`,
  `apps/api/src/sync/router.ts`, `apps/api/src/cli/sync-enroll.ts`.
- Generated schema: `apps/api/src/db/generated/schema.ts` (machine-generated
  introspection includes reordered definitions).
- Contract/UI: `packages/shared/src/foundation.ts`,
  `apps/web/src/components/system/SystemHealth.tsx`,
  `apps/web/src/pages/FoundationPages.tsx`.
- Existing tests: `apps/api/test/central-bootstrap.test.ts`,
  `apps/api/test/database-fixture.test.ts`, `apps/api/test/database-fixture.ts`,
  `apps/api/test/database.test.ts`, `apps/api/test/payroll-database.test.ts`,
  `apps/api/test/timekeeping-database.test.ts`.
- Documentation: `docs/central-bootstrap.md`, `docs/central-enrollment.md`,
  `docs/phase4-sync.md`.

The worker architecture, retry/recovery policy, atomic outbox integration,
API/status changes, coverage, and remaining Phase 4.2/4.3 dependencies are
documented in the preceding sections. Work stops at Phase 4.1.
