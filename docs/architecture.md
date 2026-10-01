# Architecture

The desktop is **offline-first**: React talks to a **local** Express API backed by a **local**
PostgreSQL 18 cluster, and nothing on the critical path needs the Internet. The same
application code also runs as a central server for later synchronisation.

```
                     HEX PAYROLL

        DESKTOP                                SERVER
        Electron                              Express
           │                                     │
        React UI                              PostgreSQL 18
           │                                     │
      Express (loopback)                         │
           │                                     │
      PostgreSQL 18                              │
           │                                     │
        Outbox ───────────────── HTTPS ─────────►
           │            (Phase 3 sync)
      Sync Engine
```

## One application, two hosts

`createApp()` in `apps/api/src/app.ts` is the single factory. There is no "desktop API" and
"cloud API" to keep in sync — only one application with two entrypoints:

| Host           | Process                                        | API entrypoint                                           |
| -------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Desktop        | Electron main + a private loopback API process | planned `local.ts` (Phase 1/4); today the shared dev API |
| Central server | plain Node                                     | `apps/api/src/server.ts` → `dist/server.js`              |

## Phase 0 process model

| Process    | Dev                                                    | Packaged (Phase 4)                              |
| ---------- | ------------------------------------------------------ | ----------------------------------------------- |
| PostgreSQL | developer-installed cluster on `5432`                  | private cluster spawned by the shell            |
| API        | `tsx watch src/server.ts` on `127.0.0.1:4311`          | child process on an **ephemeral** loopback port |
| UI         | Vite dev server `127.0.0.1:5273`                       | `apps/web/dist` loaded over `file://`           |
| Shell      | `electron-vite dev` → loads the dev URL (with retries) | Electron main, single-instance guarded          |

The API never binds anything but loopback, and in the packaged desktop it will hand its port
and a per-launch bearer token to the renderer **through the preload bridge** — which is why
`apps/web` reads its base URL at runtime instead of hardcoding one.

## Request flow (Phase 0 health check)

```
React (App.tsx)
  └── fetch `${VITE_API_BASE_URL ?? 'http://127.0.0.1:4311'}${HEALTH_PATH}` every 5s
        └── Express  healthRouter
              └── probeDatabase()  ("SELECT version(), current_database(), current_user")
                    └── PostgreSQL 18  as hexpayroll_app
        ◄── 200 HealthStatus  |  503 HealthStatus
  └── StatusPill: ONLINE when status === 'ok', otherwise OFFLINE + the failure message
```

`HealthStatus` is defined once in `packages/shared` and imported by both sides, so the producer
and the consumer cannot disagree about the shape _or_ the path: `HEALTH_PATH` is `/api/health`, and
the router is mounted at `/api` to serve exactly that. Because the UI is served from a different
origin than the API, the response is only readable once the API adds `Access-Control-Allow-Origin`
for loopback origins — see [`apps/api.md`](apps/api.md).

## Why hash routing and relative asset paths

The packaged desktop loads the UI over `file://`, where path-based routing has no server to
resolve deep links. `HashRouter` and `base: './'` behave identically under `file://` and
`http://`, so one build serves the desktop today and a browser deployment later — and that is
also why the renderer must never assume a dev-server origin.

## Offline-first posture

- Local PostgreSQL + local API = the entire critical path. No network call is required to
  compute or view payroll.
- Synchronisation (outbox queue, revision-based concurrency, node identity, conflict handling)
  is Phase 3 and will reuse the same `createApp()` on the central server.
- Auto-update is deliberately disabled: silently shipping changed contribution or tax tables
  mid-period is an incident, not a convenience.
- Payroll rates and contribution tables will be **versioned reference data with effectivity
  dates**, never literals in source — see
  [`packages/payroll-engine.md`](packages/payroll-engine.md).

## Security boundaries

| Boundary     | Control                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Network      | API binds `127.0.0.1`; the packaged desktop will use an ephemeral loopback port plus a per-launch bearer token                  |
| CORS         | loopback origins only, reflected with `Vary: Origin`; never `*`, never credentials; the `file://` (Phase 4) origin stays closed |
| Database     | two roles: `hexpayroll_migrator` owns DDL, `hexpayroll_app` is DML-only; the running API cannot alter its own schema            |
| Renderer     | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; popups denied and opened externally                        |
| Content      | CSP meta tag in `apps/web/index.html` restricts `default-src`/`connect-src` to self and loopback                                |
| Upgrade path | no auto-update, no silent schema or rate changes                                                                                |

## Module boundaries

| Unit                      | May depend on                       | Must never depend on                      |
| ------------------------- | ----------------------------------- | ----------------------------------------- |
| `packages/shared`         | nothing (pure TypeScript + Zod)     | Express, Electron, database               |
| `packages/payroll-engine` | `@hexpayroll/shared` (types)        | I/O of any kind                           |
| `apps/api`                | both packages, `pg`, Express, pino  | Electron                                  |
| `apps/web`                | `@hexpayroll/shared`, React         | Electron (it must stay browser-buildable) |
| `apps/desktop`            | Electron, `apps/web`'s build output | payroll rules                             |

The locked-in decisions behind these boundaries are recorded in
[`README.md`](README.md#decision-record); phase status is in
[`README.md`](README.md#roadmap).
