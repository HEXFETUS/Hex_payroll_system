# Phase 4A: synchronization transport

Phase 4A delivers events from the existing local outbox to a durable central
ledger and pulls that ledger into a local inbox. It does **not** apply received
events to workforce, attendance, or payroll tables. `synced` means central
transport receipt, not business replication. `sync_inbox.applied_at` stays null.

## Deployment prerequisites

Both hosts must run the same API/shared build, PostgreSQL 18, and immutable
migrations through `0029_sync_delivery_safety.sql`. The local `0028` remains
unchanged. `0029` adds organization/node foreign keys, publication ordering,
outbox leases/receipts, and the inbox. Apply migrations with the project runner,
never `psql -f`, Drizzle push, or manually edited generated schema.

The central API uses its own DML database role. Database access remains private;
installations communicate with the central **HTTPS API**, not PostgreSQL or a
MobaXterm session. Put the API behind your HTTPS reverse proxy. Device tokens
permit transport of all events for their organization, including payroll data.
Only administrators may enroll, revoke, list installations, or close conflicts.

The organization UUID on each installation must match central. Prepare a verified
initial database/bootstrap separately; Phase 4A does not bootstrap existing
business records or synchronize users, password hashes, sessions, roles, or
permissions. Old `sync_nodes` records without tokens cannot authenticate.

## Configuration and enrollment

Sync defaults to `SYNC_MODE=disabled`. Migration and schema generation do not
enable it. On central set `SYNC_MODE=central`, then restart its API. No local
delivery worker runs in central mode. Central business changes are not yet
automatically published from its outbox in this phase.

On a local installation, keep sync disabled while enrolling. In your terminal
set `SYNC_CENTRAL_URL` to the central API origin (without `/api`),
`SYNC_DEVICE_NAME` to a descriptive installation name, and `SYNC_ADMIN_TOKEN`
to an authenticated **central administrator session**. Do not put that session
token in command arguments, Git, logs, or shared documentation. Run:

```powershell
pnpm --filter @hexpayroll/api sync:enroll
```

The CLI checks the local organization, registers the installation centrally,
stores the matching node/hash locally, and writes `SYNC_MODE=local`,
`SYNC_CENTRAL_URL`, `SYNC_NODE_ID`, and `SYNC_NODE_TOKEN` into the gitignored local
`apps/api/.env`. The device secret is returned once and never printed by the CLI.
Central stores only its SHA-256 hash. Local needs the secret to authenticate;
protect this file with installation-user filesystem permissions and exclude it
from ordinary backups/log collection. Remove `SYNC_ADMIN_TOKEN` from the shell
after enrollment. Restart the API with `SYNC_MODE=local` in the process environment
too if an environment override was used; process variables override `.env`.
`SYNC_INTERVAL_MS` defaults to 15000.

Enrollment spans a remote request, local transaction, and filesystem write. If
the connection or file write fails after central registration, inspect/revoke
the orphan central node before re-enrolling; the CLI does not claim distributed
atomicity. Loopback HTTP is allowed for development; remote HTTP and credentialed
URLs are rejected. Redirects are rejected so credentials cannot follow a redirect.

## Protocol

For a restricted sync-only central runtime, use
[central administrative enrollment and local credential import](central-enrollment.md)
instead of the legacy administrator-session enrollment above. That path leaves
transport disabled until explicitly enabled, and needs no runtime auth-table grants.

All responses use `Cache-Control: no-store`. JSON request bodies are bounded to
1 MiB. Each push/pull page contains at most three events; events retain the
256 KiB database payload bound. Unsupported payload versions are rejected.
Bigint sequence values are decimal **strings** in JSON.

| Endpoint                               | Authentication              | Behavior                                                                                                  |
| -------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /api/sync/nodes`                 | Administrator session       | `{deviceName, organizationId}`; returns `{nodeId, organizationId, token}` once                            |
| `GET /api/sync/nodes`                  | Administrator session       | Lists installation metadata, never hashes/secrets                                                         |
| `POST /api/sync/nodes/:id/revoke`      | Administrator session       | Disables authentication immediately after revocation commits                                              |
| `POST /api/sync/push`                  | Installation bearer token   | `{events:[{eventId, entityType, entityId, operation, revision, payloadVersion, payload}]}`                |
| `GET /api/sync/pull?after=0`           | Installation bearer token   | `{changes, nextSequence}`, ordered and scoped to the token's organization                                 |
| `GET /api/sync/conflicts`              | Administrator session       | Lists bounded conflict metadata without sensitive snapshots                                               |
| `POST /api/sync/conflicts/:id/resolve` | Administrator session       | `{status:"resolved"}` or `{status:"ignored"}`; closes a transport conflict without altering business data |
| `POST /api/sync/outbox/retry`          | Local administrator session | Retries this organization's failed outgoing events                                                        |
| `GET /api/sync/summary`                | Session with `sync.view`    | Mode, queue counts, open conflicts, events awaiting business application                                  |

Push receipts contain `{eventId, sequence}`. Authentication establishes the
organization; callers cannot choose a target tenant. Same event identity and
contents return the original receipt. Different contents under an accepted
identity reject the batch with 409 and retain a transport conflict. The original
accepted event is never overwritten. Closing that conflict does not make an
altered retry acceptable; restore the original contents or produce a new valid
event through the eventual business conflict workflow.

Ledger insertion uses a global transaction advisory lock **before assigning the
published sequence in a trigger**. PostgreSQL identity allocation alone can
commit out of order; it would allow a cursor to skip a late lower sequence. The
trigger replaces the initially reserved identity, so gaps are expected. Ledger
mutation/delete/truncate privileges are revoked from the runtime role.

Pull includes the requesting node's own changes, allowing one cursor to traverse
the entire organization stream. Local receipt inserts the entire page and
advances `sync_nodes.last_pull_sequence` in one transaction. This cursor means
last **durably received** central sequence. Network or inbox failures do not
advance it. Returned organization/order/cursor/response sizes are checked before
receipt. Duplicate concurrent pulls recheck the cursor under a node row lock.

Outgoing batches use `FOR UPDATE SKIP LOCKED`, UUID lease tokens, and 30-second
leases. HTTP calls time out after 10 seconds. A process crash leaves a recoverable
lease; stale workers cannot acknowledge another worker's batch. Lost HTTP
responses retry the same event IDs. Transient errors use exponential backoff up
to 300 seconds. Rejected payloads, invalid/revoked credentials, and conflicts
become `failed` for administrator review/retry; attempt counts remain intact.
An unavailable outgoing connection does not prevent independent pull attempts.
Local operations remain usable while central is unavailable.

## Verification

Run shared build, API tests, workspace typecheck/lint/format checks, and build.
Database tests must be enabled with dedicated `TEST_DATABASE_URL` and
`TEST_MIGRATION_DATABASE_URL` pointing to a database named
`hexpayroll_auth_test_*`. They create and remove isolated schemas. The migration
role needs permission to create schemas there, never superuser permissions for
normal API operation. `test:local` also supports isolated schemas in the local
database when that privilege has been explicitly configured.

```powershell
pnpm --filter @hexpayroll/shared build
pnpm --filter @hexpayroll/api exec tsx --test --test-concurrency=1 test/*.test.ts
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

The sync integration test covers hashed enrollment, duplicate receipts, altered
identity conflicts, cross-tenant rejection, immutable ledger permissions,
publication order, accepted events followed by lost responses, inbox rollback,
cursor validation, expired leases, revocation, and disabled central routes. It
also verifies that business tables remain untouched by transport.

## Next phase

Business replication still needs entity-specific allowlists/adapters, dependency
and transaction grouping, bootstrap snapshots, conflict resolution for divergent
entity revisions, credential/actor identity mapping, and payroll freeze/history
validation. Do not enable production payroll replication based only on a
successful Phase 4A delivery receipt. Central deployment is a separate step;
use the exact checksum-verified migrations and builds validated locally.
