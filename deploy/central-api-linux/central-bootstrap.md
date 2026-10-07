# Central bootstrap and runtime packaging

The central long-running `hexpayroll_app` connection remains restricted to sync
transport. A health check verifies connectivity, not authentication/setup rights.
Do not use the local provisioning CLI or grant broad table access to make central
bootstrap work.

`node dist/cli/central-bootstrap.js` is a separate, interactive, one-time command.
It requires `SYNC_MODE=central` and `CENTRAL_BOOTSTRAP_DATABASE_URL`, never falls
back to `DATABASE_URL`, refuses the `hexpayroll_app` role, shows the database and
role, and requires the operator to type the database name before continuing.
It prompts for the canonical local organization UUID, company name and initial
administrator. Password entry is hidden and confirmed; no credentials are
accepted in command arguments or printed in errors.

Supply the separate bootstrap connection through the operator's protected
environment for this process only. Do not put it in the runtime `.env`, persistent
service configuration, or archive. Unset it when finished. The command does not
load the application's `.env` or change grants.

The intended temporary bootstrap role needs CONNECT to the target database,
USAGE on public, and only these table operations:

| Table             | Operations             |
| ----------------- | ---------------------- |
| application_setup | SELECT, UPDATE         |
| auth_users        | SELECT, INSERT, UPDATE |
| organizations     | SELECT, INSERT         |
| roles             | SELECT                 |
| user_roles        | INSERT                 |
| audit_events      | INSERT                 |
| sync_outbox       | INSERT                 |

The existing UUID defaults and inserts must also be executable by that role.
It needs no DDL, role management, DELETE, or access to payroll business tables.
Role provisioning and verification are separate operator steps; this change
does not create a privileged role or run anything against the VPS.

All writes happen in one transaction under the singleton setup row lock. The
command requires an empty installation and the seeded system administrator role.
It hashes the password, assigns the administrator, creates the organization with
the provided UUID, sets application setup, writes audit records and an outbox
event. Failures roll back all writes. Concurrent or repeated attempts are refused.
An existing or partly configured installation requires investigation, not reset.

Bootstrap does **not** enable HTTP administrator login for a sync-only role.
Use the separate [central node management command](central-enrollment.md) for
enrollment/revocation and local credential import. Node push/pull use node
credentials and the existing transport tables. No sync is enabled by bootstrap.

From the Windows repository root, run `pnpm build`, then
`powershell -NoProfile -File scripts/prepare-central-runtime.ps1`.
The preparation script keeps the existing production package/lock/workspace
structure, replaces compiled output, and ships only central-bootstrap from the
CLI directory alongside central-node. Migration, provisioning, diagnostics, local enrollment and local
user CLIs are excluded, together with the unused migration module. It does not
copy dependencies, frontend, Electron, source, tests or environment secrets.
It does not rebuild the archive/checksum or touch the VPS. After reviewing the
refreshed folder, use `powershell -NoProfile -File scripts/archive-central-runtime.ps1`
to validate its contents, create the archive and generate an ASCII SHA-256 file.

Local database tests use disposable schemas through `test-local.ts` or explicit
dedicated test database URLs; they verify
identity preservation, password hashing, runtime-role rejection, audit/outbox
rollback, concurrency and repeated-bootstrap refusal. They do not bootstrap the
existing local organization or central database.

`TEST_BOOTSTRAP_DATABASE_URL` optionally selects a pre-created
`hexpayroll_bootstrap` test role in a dedicated `hexpayroll_auth_test_*` database.
The test fixture grants only the table operations above in its disposable schema
and verifies that auth-session INSERT and organization DELETE remain unavailable.
