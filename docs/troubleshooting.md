# Troubleshooting (code level)

Symptoms you hit while working **on** the code. Environment-level problems — the Electron
binary behaving as Node, `(!) renderer config is missing`, `ERR_PNPM_IGNORED_BUILDS` — are
covered in the [project README](README.md#troubleshooting).

## The dashboard shows OFFLINE with "Failed to fetch" (and a red "Database: unreachable")

Two separate defects produce this one screen, so fix them in this order.

**1. `Failed to fetch` is CORS, not a dead API.** The UI runs on a _different origin_ than the API
(`http://127.0.0.1:5273` vs `http://127.0.0.1:4311`), so Chromium will not hand the response to the
page unless the API answers with `Access-Control-Allow-Origin`. It does not, by default — hence
`apps/api/src/middleware/cors.ts`. The tell is in the API log: the `request handled` line for
`/api/health` keeps being written every five seconds, because the request _did_ reach Express and
the browser rejected the answer afterwards. That same browser rule also hides the second detail: had
CORS been satisfied, the 404 body `{ status: 'error', message: 'Not found' }` carries no `error`
field, so the row would have read `API responded with status 404` instead. See
[`apps/api.md`](apps/api.md).

**2. `Database: unreachable` was a rendering fallback, not a verdict.** `App.tsx` printed
`unreachable` whenever `health.data` was `undefined` — which is exactly what an errored query gives
you. The row now reads `unknown` in that case, and reserves `unreachable` for a real `503` whose body
says `database: 'unreachable'`. If PostgreSQL itself is down the API never binds a port at all:
`probeDatabase()` runs first and the process exits `1` (see the section below).

Separate the two by hand:

```powershell
# 200 + no ACAO header (no Origin sent, so there is nothing to reflect)
curl.exe -i http://127.0.0.1:4311/api/health

# 200 + Access-Control-Allow-Origin reflected + Vary: Origin
curl.exe -i -H "Origin: http://127.0.0.1:5273" http://127.0.0.1:4311/api/health

# 404 — the route is /api/health, never /health
curl.exe -i http://127.0.0.1:4311/health
```

## `password authentication failed for user "hexpayroll_app"` (PostgreSQL 28P01)

The API exits with `fatal error during startup` and code `1` — that is by design: it probes the
database _before_ binding a port, so a misconfigured stack cannot serve requests.

The password inside `DATABASE_URL` in `apps/api/.env` (gitignored) does not match the role's
password in the cluster. Either:

- re-run the provisioning pair so the role password matches `apps/api/.env` — `provision.ps1`
  drives `01_create_roles_and_database.sql` and then **verifies using the credentials parsed
  out of `apps/api/.env`**, or
- align the role with the file: `ALTER ROLE hexpayroll_app LOGIN PASSWORD '<the password in .env>';`
  as a superuser.

Roles that already exist make step 1 of the SQL fail; the script says so and you can run step 2
alone. Note that the passwords committed in `01_create_roles_and_database.sql` are
**local-development only**.

## `Cannot find module '@hexpayroll/shared'` (or `@hexpayroll/payroll-engine`)

Apps resolve those packages through their built `dist/` directory, so the packages have to be
built first:

```powershell
pnpm build          # or: pnpm typecheck   (builds packages/* before type-checking apps)
```

Fresh clones hit this because `dist/` is gitignored. See
[`development.md`](development.md#workspace-and-build-graph).

## `Cannot find module './App'`, or "extension is not allowed" style errors

Each package has one correct specifier style, set by its `moduleResolution`:

| Mode       | Packages                                                 | Correct                           | Wrong                                                            |
| ---------- | -------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `Bundler`  | `apps/web`, `apps/desktop`                               | `import App from './App'`         | `'./App.tsx'` (needs `allowImportingTsExtensions`), `'./App.js'` |
| `NodeNext` | `packages/shared`, `packages/payroll-engine`, `apps/api` | `'./money.js'` for `src/money.ts` | `'./money'`                                                      |

If the file plainly exists, the editor is usually showing a stale TypeScript server cache
(typical after a file was just created): run **TypeScript: Restart TS Server** and re-check
with `npx tsc -p <project>/tsconfig.json --noEmit`.

## The desktop window stays blank in development

The shell loads `process.env.HEX_WEB_DEV_URL ?? 'http://127.0.0.1:5273'` and retries 20 times,
500 ms apart, before logging `[desktop] failed to load the UI`. Check that:

- `pnpm dev` (or at least the web dev server) is running, and
- the port matches `apps/web/vite.config.ts` (`strictPort: true`, so a busy port fails loudly
  instead of moving).

A blank window should be rare now: in development the shell waits for the dev server _before_ it
creates a window, and if no window appears at all then the wait timed out rather than the load
failing — see the next section.

## `pnpm dev` prints `[desktop] waiting for the web dev server` forever

The shell probes `HEX_WEB_DEV_URL` (default `http://127.0.0.1:5273`) before it creates a window, so
this means nothing answered on that port for the whole budget. The heartbeat names the reason —
`ECONNREFUSED` is "nothing is listening", `ETIMEDOUT` is "listening but stuck".

Three causes, in the order they actually happen:

1. **`pnpm dev` was run from `apps/desktop`.** That package's `dev` script is
   `electron-vite dev --watch` — the shell alone, no API and no web dev server. The one command is
   `pnpm dev` **from the repository root**; `pnpm dev:desktop` is the deliberate "shell only" alias.
2. **The web dev server died.** Read the `[web]` lines: `strictPort: true` means a busy `5273` fails
   loudly instead of moving (see the section below).
3. **Something else is expected on that port.** Then set `HEX_WEB_DEV_URL` to the right one.

Confirm what is actually listening:

```powershell
Get-NetTCPConnection -LocalPort 5273 -State Listen
```

`HEX_WEB_WAIT_TIMEOUT_MS` changes the 60 s budget, and `HEX_WEB_WAIT_TIMEOUT_MS=0` skips the gate
entirely — the shell then loads first and depends on the late-load retry, blank window and all.

## `pnpm dev` prints nothing and no Electron window appears

A **previous Electron instance is probably still alive**. The single-instance guard
(`app.requestSingleInstanceLock()`) makes a second launch quit immediately, and since the root script
runs `concurrently -k`, that exit tears down the API and the dev server too — so the command looks
like it did nothing at all. Confirm and clear it:

```powershell
Get-Process electron -ErrorAction SilentlyContinue
taskkill /F /IM electron.exe
```

The reverse case is equally quiet: the `[desktop] waiting for the web dev server` loop with no ready
line means the shell is up and the dev server is not — see the section above.

## `Port 5273 is already in use` when starting `pnpm dev`

`apps/web/vite.config.ts` sets `strictPort: true` deliberately: the shell expects exactly `5273`, so a
busy port must fail loudly instead of silently moving. Either free the port —

```powershell
Get-NetTCPConnection -LocalPort 5273 -State Listen | Select-Object OwningProcess
```

— or, if a dev server is already running and only the shell is needed, use `pnpm dev:desktop`.

## The browser refuses to call the API (CSP violation)

`apps/web/index.html` sets `connect-src 'self' http://127.0.0.1:* http://localhost:*`. A
non-loopback API URL — a LAN IP or a hostname — is blocked by design; extend the CSP
deliberately if the deployment ever changes.

## `pnpm format:check` reports every file

A Windows checkout with `core.autocrlf=true` materialises CRLF while `.gitattributes` stores LF
and Prettier is configured with `endOfLine: "lf"`. Git will normalise on commit, so this is a
local artifact. Verify content formatting instead, e.g.
`npx prettier --check README.md --end-of-line crlf`, or re-checkout with LF endings.
