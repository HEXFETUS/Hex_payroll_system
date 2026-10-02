# Phase 1 implementation report

Implemented the persisted Phase 1 foundation and connected it to the existing local
application. Payroll calculation and a working synchronization engine remain deferred.
See [setup and architecture](phase1-foundation.md) for endpoint details and operational rules.

## Database

Added and applied five up-only migrations, `0002` through `0006`. Existing `0001_auth.sql`
and existing account IDs/password hashes were preserved. The migration runner now reports
all migrations current. Generated Drizzle schema was pulled from PostgreSQL after migration;
handwritten relations were added separately. Generated SQL/snapshot byproducts are ignored.

New tables: `organizations`, `application_setup`, `permissions`, `roles`, `user_roles`,
`role_permissions`, `departments`, `positions`, `employees`, `employment_versions`,
`biometric_devices`, `biometric_mappings`, `payroll_configurations`, `audit_events`,
`sync_nodes`, and `sync_outbox`. Existing `auth_users` was extended rather than duplicated.

Constraints and indexes include organization-scoped case-insensitive workforce identifiers,
explicit/composite foreign keys, controlled statuses/types, non-overlapping employment
periods, position/department consistency, same-company role assignments, safe integer centavo
rates, unique device mappings, required configuration checks, bounded/versioned outbox
payloads, unique entity/revision events, and employee/audit/outbox/reference lookup indexes.

The local runtime originally connected as `postgres`. A random-password `hexpayroll_app`
role was provisioned and the gitignored local runtime URL updated. Verification confirmed
that the runtime cannot create tables or update/delete audit records. Migrator access remains
separate. Test schemas use a separately granted database CREATE privilege for the migrator.

## Backend and contracts

Added organization/setup, user administration, roles/permissions, department, position,
employee/profile/history, biometric reference/mapping, payroll configuration, audit,
dashboard-summary, sync-summary, and protected system-detail endpoints. Existing login,
session, logout, password hashing, throttling, and readiness routes were extended and preserved.

Shared Zod inputs, response types, enums, pagination, revisions, dates, errors, permissions,
and API-path constants reside in the shared package. Calendar dates remain strings across
PostgreSQL/Node to avoid workstation-timezone shifts. Integer money input/output uses the
existing shared utilities. Database/Drizzle errors are translated to safe structured responses.

Administrative mutations are audited. Synchronizable changes atomically commit business
data, audit, revision changes, and outbox intent on one connection. Tests intentionally
failed audit and outbox insertion and verified rollback of preceding writes.

## Frontend

Added Employees navigation and paginated/searchable/filterable master lists; employee
profiles separate personal, employment history, government, biometric, and metadata sections.
Employment edits append dated versions. Status changes preserve history.

Settings now includes organization, users, roles/permissions, departments, positions,
payroll configuration, system, biometric references/mappings, and audit. User management
reuses the existing account table and status badges with real persisted list/create/edit
behavior; its disconnected preview form was replaced by the shared validated editor.

New reusable UI pieces include validated record forms, query states, record detail views,
pagination, lookup fields, and configuration controls. Existing shell, login, attendance,
dashboard, settings, and health styling remains in place. Dashboard workforce counts are real;
attendance stays explicitly unavailable. Sync Status shows queue counts and identifies the
engine as unconfigured. Local queries/mutations work independently of browser Internet state.

## Security

Seeded Administrator, Payroll Manager, Payroll Clerk, and Viewer with persisted permission
relationships. Custom role creation/editing and assignments are supported. Administrator's
system role definition is protected, and serialized user changes cannot disable or demote
the final active Administrator. Disable/password changes revoke sessions.

Permission groups created:

- `dashboard.view`
- `employees.view/create/update/archive`, `employees.sensitive.view/update`
- `attendance.view/manage`
- `users.view/create/update/disable`, `roles.view/manage`
- `organization.view/update`
- `departments.view/manage`, `positions.view/manage`
- `payroll_config.view/update`
- `system_health.view`, `audit.view`, `sync.view`

Authorization is enforced server-side against current persisted permissions. Company scope
comes from the session. Viewer API responses omit government identifiers and compensation,
including employment history. Passwords, hashes, tokens, database credentials, and stack
traces are excluded from public responses and audit payloads. Outbox payloads allowlist both
top-level and employment-history fields. Credentials, sessions, users, and RBAC do not enter
the generic synchronization payload. Permission changes clear scoped frontend caches.

## Offline foundation

Implemented durable pending events with revisions, payload versions, operation, attempt,
status, timestamp, and error fields. Queue reads expose counts rather than payloads.
Optimistic updates reject stale revisions with `409`; employment changes revise the employee
aggregate. Node schema/repository support UUID identity, with actual installation provisioning
deferred. No event is falsely marked synced and no device is falsely shown connected.

Phase 3 still needs node provisioning, a worker, transport/security, retry/claim recovery,
idempotent receiving, conflict resolution, and credential/RBAC synchronization. Phase 2 still
needs the payroll engine and detailed policy formulas.

## Verification

| Check                                      | Result                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                           | Passed across the workspace                                                                                                   |
| `pnpm lint`                                | Passed, zero errors/warnings                                                                                                  |
| `pnpm --filter @hexpayroll/api test:local` | 12 passed, zero failed/skipped; real PostgreSQL in isolated schemas                                                           |
| `pnpm --filter @hexpayroll/web test`       | 4 passed; browser API fixtures                                                                                                |
| `pnpm build`                               | Passed all workspace packages                                                                                                 |
| Migration runner and schema generation     | Applied/current; schema regenerated                                                                                           |
| `pnpm dev:browser`                         | API/database healthy and UI HTTP 200; test stack stopped afterward                                                            |
| `pnpm dev`                                 | Electron loaded UI successfully after removing inherited `ELECTRON_RUN_AS_NODE` for the test process; stack stopped afterward |

API tests include fresh install, existing-authentication upgrade, migration immutability,
runtime DDL denial, login/logout, uniqueness, organization isolation, permissions, user
creation/revocation, final-admin protection, employment history/overlap, stale revisions,
configuration, biometric mappings, audit protection, and atomic rollback. Browser checks
cover first-run setup, employee create/profile under browser-reported offline connectivity,
Viewer navigation/direct-route restrictions, and persisted user table/creation.

Build output includes non-failing upstream Zod/Rollup annotation warnings and the existing
Electron renderer-configuration notice; the renderer is built by the separate web package.
Physical Internet disconnection, biometric communication, sync transport, and packaged
private PostgreSQL provisioning were not claimed or tested as implemented features.

## Remaining work and activation

- **Implemented:** organization/setup, users/RBAC, departments/positions, employee identity
  and lifecycle, effective-dated employment, validated configuration, audit, and integrated UI.
- **Foundation only:** biometric device/mapping data, outbox, concurrency metadata, node repository.
- **UI only:** existing attendance screens; no attendance ingestion or synthetic records added.
- **Deferred to Phase 2:** payroll calculations, contributions/tax, detailed formulas, payroll runs,
  approvals/posting, and payslips.
- **Deferred to Phase 3:** installation node provisioning and synchronization engine/security.

No production company or Administrator was chosen automatically. The local database remains
ready for explicit administrator selection and real company setup:

```powershell
pnpm --filter @hexpayroll/api auth:bootstrap-admin
pnpm dev:browser
```

Select an existing active username, sign in, and complete Company Setup. If there are no
accounts, first run `pnpm --filter @hexpayroll/api auth:create-user`. Payroll configuration
remains incomplete until an authorized operator approves and saves it.
