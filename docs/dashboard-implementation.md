# Dashboard and application shell implementation

Implemented on October 1, 2026. The frontend remains browser-buildable and
Electron-independent. Existing login styling, in-memory authentication, HashRouter,
database migrations, credentials, and desktop infrastructure are preserved.

## Working functionality

- Protected routes: `#/dashboard`, `#/attendance`, `#/system-health`, `#/settings`,
  and `#/settings/users`. Root, unknown routes, and legacy `#/app` redirect to
  Dashboard when authenticated and Login otherwise.
- Application shell with grouped navigation, current page title, account/logout
  controls, responsive navigation, skip link, and workstation status footer.
- Existing minute-based session verification, fixed expiry, invalid-session
  handling, immediate local logout, and outage notices. Session-scoped queries
  are cancelled and removed on logout or confirmed session invalidity.
- Dashboard metric cards, attendance summary/recent-records sections, navigation
  actions, and System Health widget. Unavailable counts are displayed as `—`.
- Attendance date, employee, and status controls pass local filter state to a
  typed adapter. Tables, badges, and Philippine-time formatting are prepared for
  records supplied by an eventual backend; no hours-worked calculations run in React.
- System Health reuses `GET /api/health`. One provider owns the five-second health
  polling query/timer across all views; requests run even when browser connectivity
  reports offline. The page supports manual refresh, version, and last-check display.
- A validated HTTP 503 indicates a running API with a disconnected database.
  Transport failures, timeouts, and malformed responses show API unavailable and
  database unknown. Cached successes are not presented as current health after failure.
- The health endpoint retains PostgreSQL-backed 200/503 readiness semantics, adds
  no-store caching, and returns a fixed safe failure message. Raw driver errors,
  connection strings, database names, and runtime roles are not included.
- Settings navigation and a User Management interface preview. The native modal
  supports Escape, focus wrapping, shared credential validation, confirmation
  validation, and password disposal on close/unmount.

## Prepared for future backend integration

- Dashboard/attendance adapters explicitly return unavailable integration results.
  There are no fabricated employee counts or attendance records in production code.
  Loading, error/retry, unavailable, genuine empty, and populated presentations exist.
- User listing and creation are not connected. The current session is not presented
  as a complete user list. Creation and role selection are disabled; status is only
  a form draft. No accounts, passwords, or drafts are persisted by this interface.
- There are no application roles or administrator-only routes. All authenticated
  users can access these previews. Continue provisioning accounts through the CLI.
- Biometric status is Not configured; no vendor SDK or device communication was added.
- Synchronization is Not implemented. Network connectivity is browser-reported and
  does not establish Internet reachability or disable local navigation/operations.

## Endpoints and contracts

Reused `/api/auth/login`, `/api/auth/session`, `/api/auth/logout`, and `/api/health`.
No endpoints or authentication schemas were added. Shared health validation now
uses `healthStatusSchema` and `parseHealthResponse`; frontend operational boundaries
live in `api/operations.ts`. No database migrations or authorization changes were made.

## Files

Created:

- `apps/api/test/health.test.ts`
- `apps/web/src/api/operations.ts`
- `apps/web/src/components/DataState.tsx`
- `apps/web/src/components/attendance/AttendanceTable.tsx`
- `apps/web/src/components/dashboard/MetricCard.tsx`
- `apps/web/src/components/system/StatusIndicator.tsx`
- `apps/web/src/components/system/SystemHealth.tsx`
- `apps/web/src/components/system/useSystemHealth.ts`
- `apps/web/src/components/users/CreateUserForm.tsx`
- `apps/web/src/components/users/UsersTable.tsx`
- `apps/web/src/layouts/AppLayout.tsx`
- `apps/web/src/pages/DashboardPage.tsx`
- `apps/web/src/pages/AttendancePage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/UsersPage.tsx`
- `apps/web/src/utils/dates.ts`
- `docs/dashboard-implementation.md`

Modified:

- `apps/api/src/routes/health.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/api/health.ts`
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/components/auth/LocalServiceStatus.tsx`
- `apps/web/src/index.css`
- `packages/shared/src/health.ts`
- `docs/authentication.md`
- `docs/apps/web.md`
- `docs/apps/api.md`
- `docs/packages/shared.md`
- `docs/index.md`

Removed `apps/web/src/pages/AuthenticatedPage.tsx`, replacing its confirmation
screen with `AppLayout`. Reusable components include MetricCard, AttendanceTable,
AttendanceStatusBadge, StatusIndicator, HealthCard, SystemHealthWidget, DataState,
UsersTable, and CreateUserForm; existing PasswordInput remains reused.

## Verification

| Check                                | Result                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                     | Passed                                                                                     |
| `pnpm lint`                          | Passed                                                                                     |
| `pnpm build`                         | Passed                                                                                     |
| `pnpm --filter @hexpayroll/api test` | 9 passed, 1 skipped, 0 failed                                                              |
| `git diff --check`                   | Passed                                                                                     |
| `pnpm dev:browser`                   | API and Vite started; live readiness returned PostgreSQL 18.6 reachable                    |
| `pnpm dev`                           | Started and loaded the UI after clearing inherited `ELECTRON_RUN_AS_NODE` for that process |
| Browser smoke checks                 | Passed in headless Edge at 1440×900, 1024×768, and 390×844                                 |
| Electron smoke checks                | Passed in the actual development shell with live health and intercepted authentication     |

Browser checks covered protected routes and redirects, active Settings navigation,
filter input, modal validation/focus/password clearing, disabled creation, health
200/503/malformed/transport/timeout/recovery, browser offline events, local navigation,
one polling timer, logout during revocation failure, changed-user sign-in, revoked
sessions, and expiry. Separate intercepted-module fixtures verified loading,
populated dashboard/attendance/users, all attendance badges, Philippine timestamps,
adapter filter inputs, genuine empty results, and error/retry recovery. Fixtures
exist only in temporary smoke scripts outside the repository.

Electron checks covered Dashboard, Attendance, System Health, Settings, User
Management modal, and logout. Authentication responses were intercepted for UI
verification; no real accounts were created or modified. API automated tests verify
health contracts, readiness failures, sanitization, and recovery using injected probes.

The database integration test was skipped because disposable test-database
configuration was not supplied. Real credential sign-in and database session
revocation were not retested against development accounts.

## Discovered concerns

- The execution environment inherited `ELECTRON_RUN_AS_NODE`, causing plain
  `pnpm dev` to fail with `electron.app` undefined. Clearing the variable for the
  child process fixed startup; no persistent environment or infrastructure was changed.
- Existing startup diagnostics report that the runtime connection uses `postgres`
  rather than the intended restricted application role. Configuration was preserved.
- Build output retains the intentional desktop missing-renderer-config warning
  because the renderer belongs to `apps/web`, plus non-fatal Zod comment-annotation
  warnings from Rollup. Neither prevented the build.
- Packaged file-origin API access remains part of the existing production-packaging
  work; only browser and Electron development flows were verified here.
