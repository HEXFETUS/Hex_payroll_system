# Development

How the workspace is put together, how to run it, and the conventions the code follows.
First-run setup (environment variables, database provisioning, `pnpm install`) is in the
[project README](README.md#first-time-setup) — this page does not repeat it.

## Workspace and build graph

pnpm workspaces: `apps/*` and `packages/*` (`pnpm-workspace.yaml`), five projects plus the root.

```
packages/shared ─┬────────────────────────────► apps/api
                 ├────────────────────────────► apps/web
                 └──► packages/payroll-engine ─► apps/api
                                                 apps/desktop (main + preload only)
```

`apps/*` consume `packages/*/dist`, not their sources — so **packages must be built before an
app can resolve them**. `pnpm -r build` walks the graph in topological order; the root
`pnpm typecheck` builds `shared` and `payroll-engine` first and then type-checks everything
else. A fresh clone therefore needs `pnpm build` (or `pnpm typecheck`) before an app's own
`tsc`/`vite` run will resolve `@hexpayroll/*`.

## Scripts

| Command                        | Effect                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| `pnpm dev`                     | API `:4311` + web dev server `:5273` + Electron shell (`concurrently`)   |
| `pnpm dev:browser`             | API + web dev server only, no Electron — for UI work in a normal browser |
| `pnpm dev:desktop`             | Electron shell only; expects the web dev server to be running            |
| `pnpm build`                   | `pnpm -r build` — every package and app                                  |
| `pnpm typecheck`               | builds `packages/*`, then type-checks every project                      |
| `pnpm lint`                    | ESLint 10 across the repo                                                |
| `pnpm format` / `format:check` | Prettier write / verify                                                  |
| `postinstall`                  | fetches the Electron binary via `install-electron` (idempotent)          |

Per project: `apps/api` adds `start` (`node dist/server.js`); `apps/web` adds `preview`;
`apps/desktop` adds `preview` and `package` (`electron-builder`).

`pnpm dev` is one lifecycle, not three: it runs `concurrently -k`, so closing the Electron window
(or pressing Ctrl+C) stops the API and the web dev server as well. `--success first` makes the exit
status follow whichever process stopped first, so a normal window close ends with exit code 0
instead of reporting the two processes it just killed as a failure.

The shell does not race the dev server. In development it probes `HEX_WEB_DEV_URL`
(default `http://127.0.0.1:5273`) every 250 ms _before_ creating a window, and gives up after 60 s —
which `HEX_WEB_WAIT_TIMEOUT_MS` overrides for testing the failure path, with `0` skipping the gate
entirely. Run `pnpm dev` **from the repository root**: `apps/desktop` has its own `dev` script, so
running it there starts the shell alone and the wait then reports that nothing is listening on `5273`.
`apps/desktop`'s `dev` passes `electron-vite dev --watch`, so editing `src/main` or `src/preload`
restarts Electron alone; renderer HMR keeps coming from Vite.

| Port   | Owner                         |
| ------ | ----------------------------- |
| `4311` | API (`API_PORT`)              |
| `5273` | web dev server (`strictPort`) |
| `5432` | PostgreSQL                    |

## Toolchain pins and why

| Pin                             | Reason                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| TypeScript 6.0.3                | `typescript-eslint@8` declares `typescript: ">=4.8.4 <6.1.0"`, so TS 7 is rejected by the toolchain |
| `moduleResolution`              | `NodeNext` in `packages/*` and `apps/api`; `Bundler` in `apps/web` and `apps/desktop`               |
| Tailwind 4                      | loaded as a Vite plugin (`@tailwindcss/vite`) — no PostCSS or `tailwind.config.js`                  |
| React 19 / Vite 7 / Electron 44 | see the stack table in the [README](README.md#stack)                                                |
| Prettier 3                      | `printWidth: 100`, `singleQuote`, `trailingComma: "all"`, `endOfLine: "lf"`                         |

## Conventions

- **Comments explain why, not what.** The codebase carries decision records inline
  (`app.ts`, `db/pool.ts`, `main.tsx`, `payroll-engine/src/index.ts`); keep new ones in that
  voice and keep the docs here in sync when a decision changes.
- **Module specifiers differ by resolution mode.** `NodeNext` packages (`packages/shared`,
  `packages/payroll-engine`, `apps/api`) must write `./money.js` for `src/money.ts`.
  `apps/web` (Bundler) must stay extensionless: `./App`, never `./App.tsx`.
- **`verbatimModuleSyntax` and `isolatedModules` are on**, so type-only imports need
  `import type { … }`. `noUncheckedIndexedAccess` is why array/row access is checked
  (e.g. `result.rows[0]`) rather than assumed.
- **ESLint** (flat config) runs `@typescript-eslint/consistent-type-imports` and
  `no-unused-vars` as warnings, with `^_` opting out of unused args, variables and caught
  errors; `eslint-config-prettier` is applied last so formatting stays Prettier's job.
- **Line endings:** `.gitattributes` stores text as LF (`* text=auto eol=lf`). A Windows
  checkout with `core.autocrlf=true` materialises CRLF, which makes a local
  `pnpm format:check` report every text file — a machine-specific artifact, not a repo defect.
- **pnpm blocks dependency build scripts.** A newly flagged package needs an explicit,
  reviewed entry in `allowBuilds` (`pnpm-workspace.yaml`); never use `--allow-all`.
- **`apps/web` stays Electron-agnostic.** It must keep building for a plain browser: no
  Electron import, no Electron-only API URL.

## Adding a package or dependency

1. New workspace package: create the folder under `packages/`, give it `name`, `type: "module"`,
   `main`/`types`/`exports` pointing at `dist/`, a `build` script and a `typecheck` script —
   copy an existing `package.json` and `tsconfig.json` rather than inventing a variant.
2. Dependency: `pnpm --filter @hexpayroll/<pkg> add <dep>` (workspace links use
   `workspace:*`). If pnpm reports `ERR_PNPM_IGNORED_BUILDS`, decide the build-script question
   in `pnpm-workspace.yaml` deliberately.
3. Anything that changes the database goes through `database/migrations/` — never
   `drizzle-kit push` (see [`database.md`](database.md)).
