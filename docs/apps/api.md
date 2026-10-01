# `@hexpayroll/api`

The Express 5 + `pg` + Zod + pino HTTP API. Built as one deployable so the **same
application** runs as the desktop's private local server and as the central server — there is
no "desktop API" and "cloud API" to keep in sync.

|               |                                                                 |
| ------------- | --------------------------------------------------------------- |
| Source        | `apps/api/src/`                                                 |
| Dev           | `pnpm --filter @hexpayroll/api dev` → `tsx watch src/server.ts` |
| Build / start | `tsc -p tsconfig.json` → `dist/`, then `node dist/server.js`    |
| Listens on    | `API_HOST:API_PORT` (defaults `127.0.0.1:4311`, loopback only)  |

## Files

| File                     | Responsibility                                                           |
| ------------------------ | ------------------------------------------------------------------------ |
| `src/server.ts`          | entry point: probe, listen, graceful shutdown                            |
| `src/app.ts`             | `createApp()` factory, `logger`, request logging, 404 + error middleware |
| `src/config/env.ts`      | Zod-validated environment, loaded from `apps/api/.env`                   |
| `src/db/pool.ts`         | the `pg` pool (runtime role) and `probeDatabase()`                       |
| `src/middleware/cors.ts` | loopback-only CORS so the renderer may read API responses (see below)    |
| `src/routes/health.ts`   | `healthRouter` — the readiness probe                                     |

`tsconfig.json` uses `module: NodeNext`, which is why every relative import in this package
carries a `.js` extension (`./config/env.js`) — the specifier names the file as it will exist
after compilation. `createApp()`'s doc comment also names a future `local.ts` entrypoint (the
desktop child process); that file does not exist yet — it arrives with the desktop's local
API in Phase 1/4.

## Boot sequence (`server.ts`)

1. Importing `config/env.ts` validates the environment. On failure it prints **every** problem
   at once and exits `1` — an API that boots half-configured and fails later, mid-payroll, is
   far worse than one that refuses to start.
2. `probeDatabase()` runs **before** a port is bound. If PostgreSQL is unreachable the process
   fails loudly instead of accepting requests it cannot serve.
3. `createApp()` then `app.listen(API_PORT, API_HOST)`, logging host, port, `NODE_ENV` and
   `PAYROLL_ENGINE_VERSION`.
4. `SIGINT`/`SIGTERM` → `server.close()` → `pool.end()` → `process.exit(0)`.
5. Any startup rejection → `logger.error({ err })` then `process.exit(1)`.

## Middleware order (`app.ts`)

| Order | Middleware                       | Behaviour                                                                                                             |
| ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | `app.disable('x-powered-by')`    | no framework fingerprint                                                                                              |
| 2     | `corsMiddleware`                 | loopback-only CORS, before the body parser so a preflight is never parsed (see "Cross-origin access")                 |
| 3     | `express.json({ limit: '1mb' })` | JSON body parsing, bounded                                                                                            |
| 4     | `requestLogger`                  | on `finish`, logs `method`, `path`, `status`, `durationMs` via pino                                                   |
| 5     | `healthRouter`                   | mounted at `/api`, so the path clients call is `/api/health`                                                          |
| 6     | `notFound`                       | `404 { status: 'error', message: 'Not found' }`                                                                       |
| 7     | `errorHandler`                   | logs `{ err }`, returns `500 { status: 'error', message: 'Internal server error' }` — no internals leak to the caller |

`logger = pino({ level: env.LOG_LEVEL })` is exported from `app.ts` so entrypoints share one
log stream.

## Environment contract (`config/env.ts`)

`dotenv` resolves `.env` relative to the process working directory, and pnpm runs package
scripts with the working directory set to the package folder — so this reads
`apps/api/.env` (gitignored; `apps/api/.env.example` is the committed template).

| Variable                 | Rule                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `development \| test \| production`, default `development`                              |
| `API_HOST`               | non-empty, default `127.0.0.1` — the desktop API must not be reachable from the network |
| `API_PORT`               | integer `1–65535`, default `4311`                                                       |
| `LOG_LEVEL`              | pino level, default `info`                                                              |
| `DATABASE_URL`           | **required**; runtime role, DML only                                                    |
| `MIGRATION_DATABASE_URL` | optional; only the Phase 1 migration runner needs it                                    |

## The pool (`db/pool.ts`)

- `const { Pool } = pg` — `pg` is CommonJS, so under ESM/NodeNext the default export is
  destructured (standard interop for this driver).
- `max: 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`.
- `probeDatabase()` deliberately runs `SELECT version(), current_database(), current_user`
  instead of `SELECT 1`: health must prove the connection is authenticated, on the expected
  database, as the expected role. It throws when the query returns no row, and returns
  `DatabaseProbe = { version, database, user }` (the row check exists because of
  `noUncheckedIndexedAccess`).
- The pool connects as `hexpayroll_app` — DML rights, no DDL. Schema changes belong to the
  migration runner only (see [`../database.md`](../database.md)).

## Health contract

The router is mounted at `/api` and registers **`/health`**, so the endpoint the clients actually
call is **`GET /api/health`** — the path `HEALTH_PATH` in `@hexpayroll/shared` declares and
`apps/web` interpolates into its fetch URL:

| Outcome           | Status | Body                                                                                                                               |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| database answered | `200`  | `HealthStatus` with `status: 'ok'`, `database: 'reachable'`, `databaseVersion`, `timestamp`, plus `databaseName` and `connectedAs` |
| database failed   | `503`  | `HealthStatus` with `status: 'error'`, `database: 'unreachable'`, `timestamp`, `error`                                             |

Because a real query must succeed for a 200, this doubles as a readiness probe rather than a
liveness no-op. Field-by-field meaning of `HealthStatus` lives in
[`../packages/shared.md`](../packages/shared.md#healthts--the-phase-0-end-to-end-contract).

## Cross-origin access (`middleware/cors.ts`)

The UI is served from a **different origin** than the API — in development `http://127.0.0.1:5273`
(Vite) calls `http://127.0.0.1:4311` — so a browser will not let the page read the response unless
the API opts in with `Access-Control-Allow-Origin`. Without that header `fetch()` rejects with
`TypeError: Failed to fetch`, and the dashboard renders OFFLINE even though the request reached the
server and PostgreSQL answered it. That asymmetry is visible in the log: the `request handled` line
for `/api/health` **is** written, because the rejection happens in the browser after the response was
sent.

The policy is an allowlist, never `*`:

| Request `Origin`                       | Response                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `http://127.0.0.1:<port>` or localhost | `Access-Control-Allow-Origin` reflected, plus `Vary: Origin`             |
| anything else, or no `Origin` at all   | no CORS headers — a same-origin or non-browser caller needs none         |
| `OPTIONS` preflight                    | `204` with the allow headers above, or `204` without them if not allowed |

`Access-Control-Allow-Credentials` is deliberately never set: the desktop's per-launch credential
will be a bearer token, and reflecting credentials to arbitrary origins is what that rule exists to
prevent. `Access-Control-Allow-Headers` already lists `authorization` for that Phase 1/4 token, and
`Access-Control-Allow-Methods` lists `POST`/`PUT`/`PATCH`/`DELETE` ahead of the resource routes that
will need them.

The middleware sits **before** `express.json` because a preflight carries no body and a rejected
origin must not be able to make the server parse anything.

**Not covered, deliberately:** the packaged shell loads the UI over `file://`, which sends
`Origin: null`. Allowing that is a Phase 4 decision (a custom protocol vs. permitting `null`), so the
boundary stays closed rather than being widened just to make development work — see
[`../architecture.md`](../architecture.md#security-boundaries).

## Resolved: `/health` vs `/api/health` (was a Phase 0 inconsistency)

Phase 0 shipped a path mismatch: `HEALTH_PATH` in `@hexpayroll/shared`, the handler's doc comment
and `provision.ps1` all said `/api/health`, while `app.use(healthRouter)` mounted the router at the
root. The router therefore served `/health`, and the dashboard's request for `/api/health` got a bare
`404 {"status":"error","message":"Not found"}` — a body with no `error` field, which is why the pill
reported a status code instead of a reason.

It was resolved by mounting the router where its consumers expect it:

```ts
// apps/api/src/app.ts
app.use('/api', healthRouter);
```

`/api/health` is now the contract, and `/health` is a 404. The alternative — changing `HEALTH_PATH`
and the two comments to `/health` — would have given up the `/api` namespace for the rest of the
surface, so it was the weaker option.
