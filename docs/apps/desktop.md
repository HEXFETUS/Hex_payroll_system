# `@hexpayroll/desktop`

The Electron shell. It owns **main + preload only**; the renderer is `apps/web`, built by
`apps/web`'s own Vite pipeline and loaded by the main process.

|               |                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Source        | `apps/desktop/src/main/`, `apps/desktop/src/preload/`                                                          |
| Module system | CommonJS (this package has no `"type": "module"`), which is why `__dirname` works in `electron.vite.config.ts` |
| Dev / build   | `electron-vite dev` / `electron-vite build` → `out/main`, `out/preload`                                        |
| Package       | `electron-builder --config electron-builder.yml` (Phase 4)                                                     |

## `electron.vite.config.ts`

`main` and `preload` are the only configured targets. The renderer is intentionally absent:
duplicating `apps/web`'s plugin configuration here would guarantee the two drift apart, and
`apps/web` must stay browser-buildable with no Electron coupling. This is why the desktop
build prints `(!) renderer config is missing` — expected, not an error.

## `src/main/index.ts`

| Behaviour        | Detail                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev URL          | `process.env.HEX_WEB_DEV_URL ?? 'http://127.0.0.1:5273'` — must match `apps/web/vite.config.ts`                                                       |
| Dev readiness    | `waitForDevServer()` probes the URL every 250 ms before `createWindow()`, up to 60 s, so no window exists until there is something to render          |
| Dev wait budget  | `HEX_WEB_WAIT_TIMEOUT_MS` overrides that 60 s and `0` skips the gate entirely, which is what makes the timeout path testable without waiting a minute |
| Dev late load    | if the dev server dies and comes back while the window is open: up to 20 `loadURL` retries, 500 ms apart, then `[desktop] failed to load the UI`      |
| Dev watch        | `electron-vite dev --watch` restarts Electron when `src/main` or `src/preload` changes (the renderer's HMR comes from Vite)                           |
| Packaged load    | `window.loadFile(join(process.resourcesPath, 'web', 'index.html'))` — electron-builder ships `apps/web/dist` as the `web` extra resource              |
| Window           | 1280×820, minimum 1024×700, `show: false` until `ready-to-show` (no white flash), background `#020617`                                                |
| `webPreferences` | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload `../preload/index.js`                                                    |
| Window opening   | `setWindowOpenHandler` denies in-app popups and hands the URL to `shell.openExternal`                                                                 |
| Single instance  | `app.requestSingleInstanceLock()`; a second launch quits, an existing window is restored and focused                                                  |
| Identity         | `app.setAppUserModelId('ph.hexpayroll.desktop')` matches electron-builder's `appId`                                                                   |
| Lifecycle        | `activate` re-creates a window on macOS; `window-all-closed` quits except on `darwin`                                                                 |

Development is one command: `pnpm dev` **from the repository root** starts the API, the web dev
server and this shell. `apps/desktop`'s own `dev` script — and therefore `pnpm dev:desktop` — starts
this shell alone, and the wait above exists so that mistake produces a message instead of an empty
window.

The single-instance guard is a **safety property, not tidiness**: once the shell owns a private
PostgreSQL data directory, two concurrent instances against one `pgdata` would corrupt it. The
guard exists before the thing it protects.

**Not implemented yet (by design):** spawning the private PostgreSQL cluster (Phase 4) and
spawning the local Express API as a child process with an ephemeral loopback port and a
per-launch bearer token (Phase 1/4). Until then the desktop expects `pnpm dev`'s API on
`127.0.0.1:4311`. That one `pnpm dev` starts all three processes, and — because it is
`concurrently -k` — closing the window stops the API and the web dev server with it.

## `src/preload/index.ts`

`contextBridge.exposeInMainWorld('hexpayroll', bridge)` publishes immutable runtime facts for
Phase 0: `platform`, and `versions.electron` / `.node` / `.chrome`. `HexPayrollBridge` is the
exported type of that surface.

Two deliberate constraints:

- The bridge is where the shell will later hand the renderer the **ephemeral API port and the
  per-launch bearer token** of the private local API — which is exactly why `apps/web` never
  hardcodes an API URL.
- `apps/web` does **not** depend on this shape. The renderer must stay buildable for a plain
  browser, where `window.hexpayroll` simply does not exist.

## `electron-builder.yml`

| Setting            | Value                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | `appId: ph.hexpayroll.desktop`, `productName: Hex Payroll`                                                                       |
| Output / resources | `directories.output: release`, `directories.buildResources: build`                                                               |
| Shipped files      | `out/**` and `package.json` — never the TypeScript sources                                                                       |
| Renderer           | `extraResources: ../web/dist → web`                                                                                              |
| Windows target     | NSIS, `oneClick: false`, `perMachine: false`, user-choosable install directory, desktop + start-menu shortcuts                   |
| Signing            | required before distributing: an unsigned installer triggers SmartScreen warnings                                                |
| Auto-update        | intentionally not configured — silently shipping changed contribution or tax tables mid-period is an incident, not a convenience |

## Gotchas

- `ELECTRON_RUN_AS_NODE` in the shell makes the Electron binary behave as plain Node
  (`require('electron')` returns a path). VS Code's integrated terminal sets it — see
  [`../troubleshooting.md`](../troubleshooting.md).
- `electron-vite build` reports "building ssr environment" twice; that is simply the `main`
  and `preload` targets.
