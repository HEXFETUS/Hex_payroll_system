# Local authentication

Authentication runs against the local Express API and PostgreSQL database. Internet
access is not required. Payroll users are separate from PostgreSQL service roles.

## First-time setup

From the repository root:

```powershell
pnpm --filter @hexpayroll/api migrate
pnpm --filter @hexpayroll/api auth:create-user
pnpm dev:browser
# Or: pnpm dev
```

On Windows, use `pnpm.cmd` if PowerShell execution policy blocks `pnpm.ps1`.

The migration command reads `MIGRATION_DATABASE_URL` from `apps/api/.env`.
It needs the migrator role, validates applied migration checksums, serializes
runners with a PostgreSQL advisory lock, and applies each numbered SQL file in
a transaction. Changed, missing, or out-of-order applied history is rejected.
The API never applies migrations or uses migration credentials to run queries.
Do not edit an applied migration; add the next numbered file.

The account command uses the runtime `DATABASE_URL`. It requires an interactive
terminal and prompts for username, optional email, display name, and a hidden
password with confirmation. Password arguments and noninteractive input are
rejected. No account is created automatically, and duplicate identities are not
overwritten. Username: 3–64 ASCII letters, digits, dots, underscores, or hyphens.
Email and username matching is case-insensitive. Password: 15–128 Unicode
characters, including spaces; it is not trimmed or normalized. Usernames cannot
contain `@`, so email and username lookups are unambiguous.

Password hashes use asynchronous scrypt (N=131072, r=8, p=1, maxmem=256 MiB),
a random 16-byte salt, and a versioned encoding. Unknown users still incur
password verification work. Comparison uses timingSafeEqual.

## HTTP contract

Shared Zod schemas, types, and route constants are exported by
`@hexpayroll/shared`.

| Endpoint              | Request                         | Success                                |
| --------------------- | ------------------------------- | -------------------------------------- |
| POST /api/auth/login  | JSON `{ identifier, password }` | 200 `{ user, accessToken, expiresAt }` |
| GET /api/auth/session | Bearer header                   | 200 `{ user, expiresAt }`              |
| POST /api/auth/logout | Bearer header                   | 204, including expired/revoked tokens  |

Public user: `{ id, username, email?, displayName }`. Errors:
`{ error: { code } }` with 400 INVALID_REQUEST, 401 INVALID_CREDENTIALS or
SESSION_INVALID, 429 RATE_LIMITED, 503 SERVICE_UNAVAILABLE, or 500
AUTHENTICATION_FAILED. Unknown users, incorrect passwords, and inactive users
share INVALID_CREDENTIALS. Auth responses have Cache-Control: no-store.
Login accepts at most 8 KiB of JSON; validation also bounds individual fields.

Login allows ten attempts per client IP per minute, includes Retry-After on
throttled responses, and caps tracked clients at 10,000. New clients are refused
when tracking is full until a window expires. Proxy trust remains disabled.
Credentials, bearer tokens, request bodies, and password hashes are never logged.

Sessions use random 32-byte bearer tokens. Only SHA-256 token hashes are stored
in PostgreSQL. Every session check validates expiry and active-user status.
Expiry is fixed at eight hours; no refresh or sliding timeout exists. Logout
deletes the token record. Expired rows are inert; automated session pruning is
not part of this first version.

## Renderer behavior

The adapter uses the existing VITE_API_BASE_URL configuration and a ten-second
request timeout, validates responses, and displays safe error messages.
AuthProvider holds the session in memory. No token or password is stored in
localStorage, sessionStorage, cookies, or files. Remember me is disabled with an
explanation.

Successful login navigates to the protected `#/dashboard` page.
Unauthenticated access redirects to `#/login`; authenticated access to login
redirects to dashboard. The legacy `#/app` URL redirects to dashboard. Session verification runs on shell entry and every minute, even
when Internet connectivity reports offline. Known expiry or a 401 clears the
session. Local-service outages show retry feedback without being treated as
invalid credentials. Sign Out clears local state immediately and attempts server
revocation; failures show a notice explaining the abandoned session's expiry.
Logout and confirmed invalidity cancel and remove session-scoped queries, including
operational data, while retaining the public local-health query.

Restarting/reloading the renderer requires sign-in again. Password recovery,
payroll calculations, authorization roles, central identity synchronization, and
persistent sessions are not implemented.

The authenticated shell provides Dashboard, Employee Attendance, System Health,
Settings, and User Management preview routes. All authenticated accounts can access
these pages; no administrator authorization is claimed. User listing and creation
remain unconnected, and the create-user form cannot submit or persist passwords.
Continue using the interactive CLI for account provisioning.

Development browser and Electron flows use the HTTP renderer. Packaged file-origin
requests remain blocked by the existing CORS boundary. Production Electron origin
and transport setup are deferred to packaging; user-session tokens are separate
from any future desktop transport credential.

## Tests

`pnpm --filter @hexpayroll/api test` runs contract, password, throttle,
checksum, and HTTP error tests. Database tests run only when both
TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are supplied.

Database tests require a **fresh, disposable** database named
`hexpayroll_auth_test_<suffix>`, with a migrator owner and a runtime role granted
schema usage and default table DML privileges. They create test accounts and
extra migrations to verify rollback and concurrent runners; they are deliberately
not reusable against an already populated database. Never point them at development
or production. Missing test database configuration is reported as a skipped test.

Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` for workspace verification.
