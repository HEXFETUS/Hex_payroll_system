# `database/` — PostgreSQL 18

PostgreSQL 18 runs everywhere: local development, the packaged desktop (a private cluster,
Phase 4) and the central server. One SQL dialect, one migration runner, no ORM-driven DDL.

## Two roles, one database

| Role                  | Rights                                                   | Used by                                  |
| --------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `hexpayroll_migrator` | owns the schema; the **only** role that may run DDL      | the migration runner (Phase 1)           |
| `hexpayroll_app`      | `SELECT`/`INSERT`/`UPDATE`/`DELETE` only — no DDL at all | the running Express API (`DATABASE_URL`) |

A payroll application that cannot silently alter its own schema is a real safety property:
schema evolution becomes a deliberate, auditable act. The API's `MIGRATION_DATABASE_URL` is
optional precisely because the running process never needs it.

## Provisioning (`database/provision/`)

| File                               | What it does                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_create_roles_and_database.sql` | creates both roles **with local-development passwords** (the file says so explicitly — replace them for any shared, staging or production database) and `CREATE DATABASE hexpayroll_dev OWNER hexpayroll_migrator`. On PostgreSQL 15+ the `public` schema is owned by `pg_database_owner`, so database ownership is what grants the migrator its DDL rights without weakening `public` globally |
| `02_grant_app_privileges.sql`      | security model inside `hexpayroll_dev`: `REVOKE ALL ON SCHEMA public FROM PUBLIC`, `GRANT USAGE ON SCHEMA public TO hexpayroll_app` (usage, **not** create), then `ALTER DEFAULT PRIVILEGES FOR ROLE hexpayroll_migrator IN SCHEMA public` granting `SELECT/INSERT/UPDATE/DELETE` on tables, `USAGE/SELECT` on sequences and `EXECUTE` on functions                                             |
| `provision.ps1`                    | optional driver that runs the two SQL files in order                                                                                                                                                                                                                                                                                                                                            |

`ALTER DEFAULT PRIVILEGES` is what makes "new table → the app can use it" automatic, so Phase 1
migrations never need hand-written `GRANT`s that somebody will eventually forget.

### `provision.ps1`

- Parameters: `-SuperUser` (default `postgres`), `-DbHost`, `-Port`, `-PsqlPath` (falls back to
  `psql` on `PATH`).
- The superuser password is read as a `SecureString` and lives only in `$env:PGPASSWORD` for
  the duration of the run.
- Runs `01_…` against `postgres`, then `02_…` against `hexpayroll_dev`, both with
  `-v ON_ERROR_STOP=1`.
- Verification reuses the **runtime** credentials parsed out of `apps/api/.env`, so it tests
  exactly what the API will use: it asserts the app role connects, and that
  `CREATE TABLE` is denied.
- It finishes by telling the operator to "check /api/health" — see the path inconsistency
  recorded in [`apps/api.md`](apps/api.md#known-inconsistency-health-vs-apihealth-phase-0).

## Migrations (`database/migrations/`)

`0001_auth.sql` adds local application users and hashed-token sessions. Run
`pnpm --filter @hexpayroll/api migrate` explicitly using `MIGRATION_DATABASE_URL`.
See [local authentication](authentication.md) for account creation and tests.
The rules are:

- `NNNN_name.sql` is the **single authoritative schema history**, plain SQL, numbered and
  applied in lexical order.
- **Up-only.** There is no `.down.sql`: a rollback that drops payroll columns is a loaded gun,
  so mistakes are fixed forward with a new migration.
- A merged migration is **immutable**; the runner checksums every already-applied file and
  refuses to start if one changed.
- `drizzle-kit push` is **banned** (on PostgreSQL 18 it emits a destructive
  `ALTER TABLE … DROP CONSTRAINT` on re-run — drizzle-kit issue #4944). Migrations are applied
  by our own `pg`-only runner, which needs no dev tooling at runtime and behaves identically in
  dev, inside the desktop child process and on the central server.
- The runner connects as `hexpayroll_migrator`; the API never does.

## Generated schema

`schema.ts` is **machine-owned**: regenerate it with `pnpm --filter @hexpayroll/api schema:pull` after every migration
and commit both together. Never hand-edit it. Hand-written query metadata lives in a separate
`relations.ts`, which maps to no DDL and therefore cannot drift out of sync with the database.

## Data conventions that touch this layer

| Convention                                                                                                                            | Where                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Money is `bigint` integer **centavos**, constrained to JavaScript safe-integer bounds; never a float | [`packages/shared.md`](packages/shared.md#moneyts--money-is-an-integer-number-of-centavos) |
| Primary keys are UUIDv7 (`uuidv7()`, PostgreSQL 18): time-ordered, so a desktop can mint valid keys while offline without index bloat | Phase 1 migrations                                                                         |
| Trigger functions (e.g. `hex_touch()`) are created by the migrator and are executable by the app role through default privileges      | `02_grant_app_privileges.sql`                                                              |
