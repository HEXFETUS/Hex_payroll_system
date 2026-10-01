# `@hexpayroll/web`

The React renderer is Electron-agnostic and browser-buildable. It uses React 19,
TypeScript, Vite 7, Tailwind 4, React Router 7, and TanStack Query 5.

## Running and routing

- `pnpm dev:browser` starts the API and browser renderer at `http://127.0.0.1:5273`.
- `pnpm dev` starts those services plus the Electron shell.
- `pnpm build` builds all workspace packages; `pnpm typecheck` and `pnpm lint` check them.
- `HashRouter` keeps the same routing under HTTP and Electron's `file://` build.
  Login is `#/login`; the protected confirmation page is `#/app`. Root and unknown
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
memory; successful login opens the protected confirmation page. Sessions expire
after eight hours and are verified on page entry and every minute, with local-service
outages handled separately from invalid sessions. Remember me is disabled; credentials
and tokens are never logged or persisted. Reloading requires sign-in again.
Forgot password? reveals guidance to contact an administrator; no recovery route
or backend flow is invented. No dashboard or payroll modules are implemented.

See [local authentication](../authentication.md) for setup commands, account creation,
HTTP contracts, logout behavior, and test-database configuration.

## Local readiness and offline operation

`src/api/health.ts` centralizes `VITE_API_BASE_URL`, retaining the existing fallback
`http://127.0.0.1:4311`. Vite environment values are build-time configuration;
future runtime port injection is not implemented by this UI task.

`LocalServiceStatus` polls the shared `/api/health` path every five seconds with a
four-second timeout, no retries, and `networkMode: 'always'`. HTTP success must contain
`status: 'ok'`, `database: 'reachable'`, and a valid timestamp. Non-success, malformed,
timed-out, and failed requests show local service unavailable, even if an older
successful response remains cached. Raw backend errors and database details are hidden.

Status labels are Checking local system, Local system ready, and Local payroll service
unavailable. Local readiness is independent of authentication and Internet availability.
Internet status never disables Sign In or pauses local health requests. Synchronization
states remain unimplemented until a real sync engine provides them.
