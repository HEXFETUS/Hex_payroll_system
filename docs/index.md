# Hex Payroll — documentation

Two layers, deliberately separated:

| Layer             | File                     | Answers                                                                                                              |
| ----------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Project & process | [`README.md`](README.md) | what Hex Payroll is, the stack, the decision record, first-time setup, scripts, roadmap, environment troubleshooting |
| Code reference    | this folder (below)      | how each app and package actually behaves, its contracts, and the traps in it                                        |

## Reference map

| Document                                                   | Covers                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md`](architecture.md)                       | offline-first topology, one `createApp()` on two hosts, process model and ports, request flow, security boundaries, module boundaries |
| [`apps/api.md`](apps/api.md)                               | boot sequence, middleware order, environment contract, `pg` pool and probe, health 200/503 contract, loopback-only CORS access        |
| [`apps/web.md`](apps/web.md)                               | Vite/Tailwind setup, login, protected dashboard and application shell, local health, and future-integration interfaces                |
| [`authentication.md`](authentication.md)                   | local authentication contracts, migrations, account creation, sessions, and tests                                                     |
| [`apps/desktop.md`](apps/desktop.md)                       | Electron main + preload surface, dev-vs-packaged UI loading, single-instance guard, electron-builder config                           |
| [`packages/shared.md`](packages/shared.md)                 | money as integer centavos, allocation without drift, Zod primitives, `HealthStatus` and `HEALTH_PATH`, NodeNext entry-point rules     |
| [`packages/payroll-engine.md`](packages/payroll-engine.md) | the pure-library contract, exported types, the `netPay` invariants Phase 2 must test                                                  |
| [`database.md`](database.md)                               | the two-role privilege model, provisioning SQL + `provision.ps1`, migration rules, generated schema policy                            |
| [`development.md`](development.md)                         | workspace build graph, scripts and ports, toolchain pins, conventions, how to add a package                                           |
| [`troubleshooting.md`](troubleshooting.md)                 | code-level failures you will actually hit                                                                                             |

## Start here

| I want to…                         | Read                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| run the stack for the first time   | [`README.md` § First-time setup](README.md#first-time-setup)              |
| understand the shape of the system | [`architecture.md`](architecture.md)                                      |
| touch the API or its contracts     | [`apps/api.md`](apps/api.md) → [`packages/shared.md`](packages/shared.md) |
| work on the UI                     | [`apps/web.md`](apps/web.md) → [`apps/desktop.md`](apps/desktop.md)       |
| change the schema or roles         | [`database.md`](database.md)                                              |
| fix something that is broken       | [`troubleshooting.md`](troubleshooting.md)                                |
| know what is built vs planned      | [`README.md` § Roadmap](README.md#roadmap)                                |

## Repository at a glance

```
apps/api        Express + pg + Zod. One createApp(), two hosts.   → docs/apps/api.md
apps/web        React UI. Electron-agnostic, browser-buildable.   → docs/apps/web.md
apps/desktop    Electron main + preload only (renderer is web).   → docs/apps/desktop.md
packages/shared        Contracts, Zod primitives, money helpers.  → docs/packages/shared.md
packages/payroll-engine Pure computation core. Types only so far. → docs/packages/payroll-engine.md
database/       Provisioning + authoritative migration history.   → docs/database.md
```

## Keeping these docs honest

- Source comments remain the first place a decision is recorded; a document here explains the
  **resulting contract** and links to the file that owns it.
- Documentation asserts behaviour that can be checked (`tsc`, a request/response, a build
  warning). When a contract changes, change the doc in the same commit.
- No claim here should require running a generated tool: the whole set is hand-written and
  dependency-free on purpose.
