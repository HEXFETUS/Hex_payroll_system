# `@hexpayroll/web`

The React renderer is Electron-agnostic and browser-buildable. It uses React 19,
TypeScript, Vite 7, Tailwind 4, React Router 7, and TanStack Query 5.

## Running and routing

- `pnpm dev:browser` starts the API and browser renderer at `http://127.0.0.1:5273`.
- `pnpm dev` starts those services plus the Electron shell.
- `pnpm build` builds all workspace packages; `pnpm typecheck` and `pnpm lint` check them.
- `HashRouter` keeps the same routing under HTTP and Electron's `file://` build.
  Login is `#/login`; the protected entry page is `#/dashboard`. Root, legacy `#/app`, and unknown
  routes redirect according to authentication state with history replacement.
- Vite retains `base: './'` for relative production assets. No Electron APIs are used
  by the renderer. The existing loopback-only Content Security Policy remains unchanged.

## Login components

`AuthLayout` provides branding, a responsive 440px card, and local-service status.
`LoginPage` supplies the page heading. `LoginForm` owns credential validation,
recovery guidance, and submission feedback. `PasswordInput`
provides an accessible show/hide control. Styling uses system fonts, Tailwind,
and small shared input/action classes in `src/index.css`.

Empty identifiers (including whitespace) and empty passwords produce associated
inline errors and focus the first invalid input. Usernames need not be emails.
Passwords are preserved exactly. Changes clear stale errors and submission feedback.
Pending submissions disable credential controls and Sign In, show “Signing in...”,
and use a synchronous guard against duplicate requests.

## Local authentication

`src/auth/authentication.ts` defines a typed asynchronous `SignInAdapter`, accepting
identifier, password, and remember-me state. `LoginForm` accepts an adapter prop for
integration and verification. Its result is success or a safe error category:
invalid credentials, authentication failure, local service unavailable, unexpected
failure, invalid request, or throttling. Thrown errors show generic feedback.

The default adapter calls the local authentication API and validates its responses
using shared Zod contracts. AuthProvider holds the session token and public user in
memory; successful login opens Dashboard inside the protected application shell. Sessions expire
after eight hours and are verified on page entry and every minute, with local-service
outages handled separately from invalid sessions. Remember me is disabled; credentials
and tokens are never logged or persisted. Reloading requires sign-in again.
Forgot password? reveals guidance to contact an administrator; no recovery route
or backend flow is invented. Payroll calculations are not implemented.

See [local authentication](../authentication.md) for setup commands, account creation,
HTTP contracts, logout behavior, and test-database configuration.

## Local readiness and offline operation

`src/api/health.ts` centralizes `VITE_API_BASE_URL`, retaining the existing fallback
`http://127.0.0.1:4311`. Vite environment values are build-time configuration;
future runtime port injection is not implemented by this UI task.

`SystemHealthProvider` owns one shared `/api/health` query and polling timer for
login, shell, dashboard, and System Health. It polls every five seconds with a
four-second timeout, no retries, and `networkMode: 'always'`. Shared Zod contracts
validate both HTTP 200 readiness and HTTP 503 database failures. A valid 503 means
the API is running but the database is disconnected. Malformed, timed-out, and
failed requests show API unavailable and database unknown, even if older successful
data is cached. Probe errors are sanitized server-side; credentials are not exposed.

Local readiness is independent of authentication and Internet availability.
Internet status never disables Sign In or pauses local health requests. Synchronization
states remain unimplemented until a real sync engine provides them.

## Authenticated pages

Routes: `#/dashboard`, `#/attendance`, `#/system-health`, `#/settings`, and
`#/settings/users`. `AppLayout` provides grouped navigation, account/logout controls,
page titles, session verification, and a shared status footer. Navigation collapses
on smaller screens; tables scroll horizontally and controls support keyboard focus.

Dashboard contains employee/attendance metrics, an attendance summary, recent records,
and System Health. `src/api/operations.ts` centralizes typed future-integration
boundaries. These return explicit unavailable results, not fake records or zero
counts. `DataState` handles loading, failure/retry, and integration-pending results;
tables handle genuine empty and populated results when integration becomes available.
Attendance keeps date, employee, and status filters locally and passes them to its
adapter. Dates and displayed timestamps use `Asia/Manila`; hours worked must come
from the backend.

System Health displays database version and last-check information when provided,
with manual refresh. Biometric status is Not configured, and synchronization is Not
implemented. Network status comes from `navigator.onLine` and browser events; it
does not verify Internet reachability or block local operations.

Settings links to User Management and System Health; configuration sections are
future functionality. User Management is a preview: listing and creation APIs and
application roles do not exist. The modal uses shared username/password validation,
local password-confirmation validation, native dialog focus handling and Escape
support. Password fields are discarded on close/unmount. Creation and role selection
are disabled; status is a draft only. Nothing is persisted, and no user-management
authorization or database migrations were added.
