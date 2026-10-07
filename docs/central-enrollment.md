# Central node enrollment and local credential import

Central transport runs as the restricted `hexpayroll_app` role. Enrollment and
revocation run separately using `node dist/cli/central-node.js`, with
`SYNC_MODE=central` and `CENTRAL_ENROLLMENT_DATABASE_URL` supplied only to the
interactive operator process. The command does not load the runtime `.env`, fall
back to `DATABASE_URL`, grant privileges, or accept secrets in arguments. It
rejects `hexpayroll_app` and requires confirmation of the target database name.

The dedicated management role needs database CONNECT, schema USAGE, SELECT on
`application_setup`, and SELECT/INSERT/UPDATE on `sync_nodes`. It requires no auth
table, business table, DDL, DELETE, or role-management privileges. Configure and
verify this role separately; no grants are applied to the VPS by this change.

Enroll only after central bootstrap. Supply the same canonical UUID as the local
installation: `01a10b0c-6aae-7913-90b9-479f8e0a3bca`. The command verifies that the
singleton setup row has an administrator and exactly that organization, then
generates a random node token and stores only its SHA-256 hash centrally.
It writes `{nodeId, organizationId, deviceName, token}` once to a **new** private
file (exclusive creation, mode 0600); the token never appears in console output.
Choose a path outside the deployment/repository, transfer securely to the intended
PC, and remove the file from both machines after import. The runtime cannot
recover a lost token; revoke that node and enroll a new one.

If credential file delivery fails after enrollment, the command attempts to
revoke the new node. Its non-secret node UUID is printed before delivery so the
operator can revoke it explicitly if the database becomes unavailable during
cleanup. Database commit and file delivery are separate operations, not a
distributed transaction. Do not blindly retry after interrupted delivery.

To revoke, rerun the command and select `revoke`, providing the canonical UUID
and node UUID. Revocation is organization scoped and idempotent, disables the
node, and retains its identity/history. Its token stops authenticating new
push/pull requests once revocation commits.

On Windows, stop the local API. With `SYNC_MODE=disabled`, run
`pnpm --filter @hexpayroll/api sync:import` from the repository root. Confirm the
local database name, provide the private credential file path and central HTTPS
API endpoint. Remote plain HTTP, URL credentials, query strings and fragments
are rejected. Loopback HTTP is accepted only for local tests.

Import verifies the UUID against local `application_setup`, stores the matching
node/hash, and refuses another active local node or a changed/revoked identity.
The exact same credential can be retried if configuration-file delivery failed.
The CLI stages a private environment file before the database operation, checks
for intervening `.env` edits, then replaces `.env`. If replacement fails after
the database commit, retry the same credential. It removes obsolete sync/admin
configuration and writes endpoint/node/token settings with **SYNC_MODE=disabled**.
No HTTP administrator session or direct desktop-to-central PostgreSQL connection
is used. Protect the local `.env` with the installation user's Windows ACLs.

After reviewing configuration and removing the transferred credential file,
explicitly set `SYNC_MODE=local` in `apps/api/.env` and remove any conflicting
shell override before restarting the local API. Do this only during the planned
real-machine transport test. The HTTPS reverse proxy must already be verified;
central API and PostgreSQL remain loopback-only.

Central mode does not start attendance processing. Normal local/disabled modes
retain the attendance worker. Existing administrator-session HTTP management
routes remain for compatible installations but are not the management path for
the restricted central role; `sync:enroll` is the legacy HTTP workflow.

The isolated integration test checks narrow management privileges, organization
matching, hashed token storage, local import retries and rejection, PC1 outbox
push through an auth/business-table-inaccessible central role, PC2 inbox pull,
and revocation. Transport receipts mark the outbox `synced`; `applied_at` remains
null and no employee/payroll table replication occurs.

Deployment preparation ships only `central-bootstrap` and `central-node` CLIs.
Migration, provisioning, diagnostics, desktop/frontend, dependencies, local
enrollment/import CLIs, test source and real environment files are excluded.
