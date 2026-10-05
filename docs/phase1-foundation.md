# Phase 1 foundation

Phase 1 adds persisted master data and security to the existing local API and desktop UI.
No payroll calculations, payslips, contribution calculations, attendance ingestion, or
central synchronization are implemented.

## Setup and database workflow

The runtime connection must use `hexpayroll_app`, a DML-only role. The migrator owns
tables and runs SQL history explicitly. `apps/api/.env` remains gitignored. This local
installation was initially using `postgres` at runtime; the implementation provisioned
`hexpayroll_app` with a random password and changed only `DATABASE_URL` locally.

```powershell
pnpm --filter @hexpayroll/api migrate
pnpm --filter @hexpayroll/api schema:pull
# If no account exists:
pnpm --filter @hexpayroll/api auth:create-user
pnpm --filter @hexpayroll/api auth:bootstrap-admin
pnpm dev:browser
```

Bootstrap explicitly selects one existing active username, is serialized, and is allowed
only before bootstrap/setup has completed. Sign in as that user and enter the real company
legal name. Setup creates the primary organization and attaches existing users atomically.
Existing accounts otherwise receive Viewer. No fictional company or sample workforce is seeded.

SQL migrations are the only schema authority. `schema:pull` introspects PostgreSQL and
applies deterministic strict-TypeScript compatibility annotations to generated table
callbacks. It removes generated relations; handwritten query relations live separately.
Drizzle's generated SQL and snapshot byproducts are ignored and never applied. Never use
`drizzle-kit push` or edit an applied migration.

| Migration                           | Changes                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `0001_auth.sql`                     | Existing immutable account/session history                                                          |
| `0002_organization_rbac.sql`        | Company, primary setup singleton, existing user extensions, roles, permissions, assignments         |
| `0003_workforce.sql`                | Departments, positions, employees, effective-dated employment, biometric device references/mappings |
| `0004_configuration_audit_sync.sql` | Payroll configuration, append-only audit, sync node schema, durable outbox                          |
| `0005_foundation_constraints.sql`   | Locale/configuration checks, names and payload version checks, relationship indexes                 |
| `0006_relationship_integrity.sql`   | Cross-organization role assignment protection and preservation of referenced position departments   |

New UUID primary keys use PostgreSQL 18 `uuidv7()`. Existing UUIDs remain unchanged.
Employee numbers and department/position codes are case-insensitive unique within each
organization. Authentication usernames and emails retain their existing global uniqueness
because the existing login identifies users without a company selector.

Composite foreign keys prevent cross-company workforce references. Historical references
do not cascade-delete. Master records are retained through controlled status changes.
Compensation is PostgreSQL `bigint` integer centavos in `[0, Number.MAX_SAFE_INTEGER]`;
API/form conversions reuse shared money functions and decimal strings.

## API and security

The existing bearer-token login, hashed sessions, eight-hour lifetime, scrypt password
hashing, and login rate limiting remain in place. Login/session user contracts add
organization context, role codes, and permission codes. Passwords/hashes and credentials
never appear in public user contracts. Successful login updates last-login time and audits
the event; logout revocation and audit are atomic.

| Endpoint under `/api`                                   | Behavior                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/auth/login`, `/auth/session`, `/auth/logout`          | Existing authentication, extended context and auditing                                        |
| `/organization/setup` GET/POST                          | Setup state; selected bootstrap administrator creates company                                 |
| `/organization` GET/PUT                                 | Primary company settings, expected revision required on update                                |
| `/users` GET/POST; `/users/:id` PUT                     | Paginated/searchable users, creation, editing, password changes, activation, role assignments |
| `/roles` GET/POST; `/roles/:id` PUT; `/permissions` GET | Persisted roles and catalog; Administrator role cannot be edited                              |
| `/departments`, `/positions`, `/employees`              | GET lists, POST create; `/:id` GET and PUT                                                    |
| `/employees/:id/employment` POST                        | Append effective-dated employment version with employee expected revision                     |
| `/biometric-devices`, `/biometric-mappings`             | GET lists, POST create; `/:id` GET and PUT; references only                                   |
| `/payroll-config` GET/PUT                               | Unconfigured until saved; validated configuration with optimistic concurrency                 |
| `/audit` GET                                            | Read-only paginated events, date/user/action/entity filters                                   |
| `/dashboard/summary` GET                                | Employee totals, active totals, department count; attendance unavailable                      |
| `/sync/summary` GET                                     | Status counts, no raw payloads; engine/node provisioning unconfigured                         |
| `/health` GET                                           | Public minimal API/database readiness; no database version/credentials                        |
| `/system/details` GET                                   | Permission-protected version and integration state                                            |

Protected requests resolve active sessions and current database permissions on every request.
Company ownership is derived from the session, never trusted from request JSON. Before setup,
domain endpoints return `SETUP_REQUIRED`. Errors use safe codes for invalid input, missing
records, forbidden access, duplicates, revision conflicts, outages, and unexpected failures.
Malformed JSON and server errors never expose driver details or stack traces to clients.

The permission catalog includes dashboard, employee CRUD/archive and sensitive read/write,
attendance, user administration, roles, organization, departments, positions, payroll
configuration, system health, audit, and sync. Attendance permissions reserve the future API.

| Role            | Default access                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Administrator   | Entire catalog, user/role administration and organization setup                                                |
| Payroll Manager | Workforce and sensitive data, configuration, attendance permissions, organization read, health/audit/sync read |
| Payroll Clerk   | Workforce and sensitive data, attendance permissions, department/position read                                 |
| Viewer          | Dashboard, basic workforce, attendance UI, department/position read                                            |

Viewer responses omit employee government identifiers and compensation, including history
and list rows. Sensitive edits require a separate permission. User creation with role
assignment requires both user-create and role-manage. User updates require user-update and
role-manage; activation changes additionally require user-disable. Serialized changes cannot
disable or demote the final active Administrator. Disabling or changing a password revokes
sessions. Accounts and roles are intentionally excluded from the generic synchronization payload.

## Employment, audit, and offline behavior

Employment versions have inclusive `effective_from` and exclusive `effective_to`. New versions
must follow the latest start date; the prior open version closes atomically. A trigger locks
the employee and rejects overlapping ranges and mismatched position/department references.
Current list information uses the organization timezone and the applicable date interval;
future versions remain visible in history. Changing the department of a referenced position
is rejected to preserve existing employment history; create a new position instead.

Every synchronizable mutation executes business writes, audit inserts, and outbox inserts
on one transaction connection. Any failure rolls back all writes. Employee employment changes
increment the employee aggregate revision and enqueue a snapshot containing employment history.
Updates compare expected revision and return `409` on conflicts rather than silently overwriting.

Audit stores actor, organization, action, entity, timestamp, description, and changed field
names. It does not store field values, passwords, hashes, tokens, credentials, or sensitive
identifiers. The app role has no UPDATE/DELETE/TRUNCATE privilege on audit events. Pre-company
bootstrap/login events remain organization-null; company audit lists expose organization-scoped
events only. The audit UI offers no mutation controls.

Outbox payloads use explicit per-entity field allowlists, a payload version, entity revision,
operation, and a 256 KiB bound. Payloads contain workforce information needed for future
replication, so local database access remains sensitive. Only queue counts are exposed in
normal APIs. Status/attempt/error fields are reserved for the future worker. The database
enforces unique entity/revision events. No worker advances events to synced in Phase 1.

Node schema and repository methods support stable UUID identities; no machine name is used
as identity. Actual installation provisioning and persistence of the selected node identifier
are deferred. Phase 3 must define transport, authentication, retry/backoff, claiming/recovery,
idempotent receiving, conflict handling, payload evolution, and credential/RBAC synchronization.
Very large employee histories will eventually require a revised payload/chunking strategy.

Payroll settings store frequency/cutoff coverage, weekly/biweekly anchors, work weekdays,
start/end, break and standard minutes, grace, enabled policy flags, and rounding configuration.
Semi-monthly cutoffs must cover the month without gaps and remain valid in February.
Biweekly anchors must match the selected weekday. Suggested defaults are unsaved until an
authorized operator approves and saves them. Detailed rates/formulas remain Phase 2.

## Frontend and verification

Employees have first-class navigation, searchable/filterable paginated lists, create/edit,
profiles, employment history, government information, biometric mappings, and metadata.
Settings includes organization, users, roles/permissions, departments, positions, configuration,
system, biometric references, and audit. Sync Status is read-only. Permissions control routes
and actions as UX; the API remains the enforcement boundary.

TanStack local requests use `networkMode: 'always'`. Browser connectivity is advisory and
does not disable local work. Dashboard workforce counts are persisted; attendance is explicitly
unavailable. Health distinguishes API/database, unconfigured biometric communication,
browser connectivity, and an unconfigured sync engine with pending queue counts.

```powershell
pnpm typecheck
pnpm lint
pnpm --filter @hexpayroll/api test
pnpm --filter @hexpayroll/api test:local
pnpm --filter @hexpayroll/web test
pnpm build
```

`test:local` uses configured local connections but creates randomly named isolated test
schemas, runs migrations and fixtures there, and drops them afterward. The migrator needs
CREATE privilege on the database for those schemas, and the runtime must be `hexpayroll_app`.
Normal tests skip PostgreSQL integration unless test connections are supplied. Dedicated test
database URLs must match `hexpayroll_auth_test_*`. Tests cover upgrade/fresh migration behavior,
authorization, company isolation, integer money, employment history, stale revisions, secret
exclusion, final-admin protection, revocation, and rollback when outbox insertion fails.

Browser tests use API fixtures and verify setup, offline browser connectivity, employee
creation/profile rendering, and Viewer navigation/direct-route restrictions. PostgreSQL API
tests separately exercise real persisted mutations. Browser fixtures are not proof of an
actual sync engine or device connection.
