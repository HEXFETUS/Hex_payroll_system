# Hex Payroll

Offline-first desktop payroll system for Philippine payroll operations — Electron + React +
Express + PostgreSQL 18. A payroll clerk must be able to keep working when the Internet is
unavailable, and synchronise later.

**Current phase: Phase 0 — foundation is complete.** The workspace, PostgreSQL roles, the
Express API, the shared packages and the Electron shell are wired together and proven to
build. There are deliberately **no payroll tables, no contribution rules and no sync logic
yet** — those begin in Phase 1.

## Documentation

| Where                                                | What                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`docs/index.md`](docs/index.md)                     | Map of the whole documentation set — start here                                                                       |
| [`docs/README.md`](docs/README.md)                   | Project overview, stack, decision record, first-time setup, scripts, roadmap                                          |
| [`docs/architecture.md`](docs/architecture.md)       | Topology, process model, request flow, security and module boundaries                                                 |
| [`docs/apps/`](docs/apps/api.md)                     | [`api`](docs/apps/api.md) · [`web`](docs/apps/web.md) · [`desktop`](docs/apps/desktop.md)                             |
| [`docs/packages/`](docs/packages/shared.md)          | [`shared`](docs/packages/shared.md) (money, primitives, health) · [`payroll-engine`](docs/packages/payroll-engine.md) |
| [`docs/database.md`](docs/database.md)               | PostgreSQL 18 roles, provisioning, migration rules                                                                    |
| [`docs/development.md`](docs/development.md)         | Build graph, toolchain pins, conventions                                                                              |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Failures you will actually hit                                                                                        |

## Quick start

```powershell
Copy-Item apps/api/.env.example apps/api/.env   # then set real passwords
pnpm install
pnpm dev        # API :4311 + web dev server :5273 + the Electron shell
```

`pnpm dev` — run from the repository root — is the whole development stack in one command. The shell
refuses to open a window until the dev server answers, so a cold start neither flashes a blank window
nor depends on winning a race against Vite. Closing the window stops all three processes. Inside
`apps/desktop`, `pnpm dev` means the shell only; that is what `pnpm dev:desktop` does from the root.

To run the API and the UI without Electron — the web app stays browser-buildable on purpose:

```powershell
pnpm dev:browser
```

Prerequisites (Node 22.12+, pnpm 11, PostgreSQL 18), database provisioning and every script are
documented in [`docs/README.md`](docs/README.md#first-time-setup).
