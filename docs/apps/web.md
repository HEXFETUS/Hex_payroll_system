# `@hexpayroll/web`

The React UI. Deliberately **Electron-agnostic**: it must stay buildable for a plain browser,
so it never imports Electron and never hardcodes an API URL that only the desktop knows.

|            |                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Source     | `apps/web/src/`                                                                                                                   |
| Dev server | `pnpm --filter @hexpayroll/web dev` → `http://127.0.0.1:5273` (`strictPort`); started for the desktop flow by the root `pnpm dev` |
| Build      | `tsc -p tsconfig.json --noEmit && vite build` → `dist/`                                                                           |
| Stack      | React 19 · Vite 7 · Tailwind 4 · React Router 7 · TanStack Query 5                                                                |

## `vite.config.ts`

| Setting            | Reason                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `base: './'`       | relative asset paths so the production build works when Electron loads it over `file://`           |
| `server.host/port` | `127.0.0.1:5273`, `strictPort: true` — the desktop shell expects exactly this                      |
| `plugins`          | `@vitejs/plugin-react` + `@tailwindcss/vite` (Tailwind 4 runs as a Vite plugin; no PostCSS config) |
| `build`            | `outDir: 'dist'`, `emptyOutDir: true`, `sourcemap: true`                                           |

## `index.html`

Declares the renderer's Content Security Policy:

```
default-src 'self'; style-src 'self' 'unsafe-inline';
connect-src 'self' http://127.0.0.1:* http://localhost:*
```

`connect-src` allows loopback on any port on purpose: in the packaged desktop the API binds
an **ephemeral** port. `style-src 'unsafe-inline'` is required by Tailwind's injected styles.
The page is `<div id="root">` plus `<script type="module" src="/src/main.tsx">`.

## `src/main.tsx` — the entry point

| Step            | Detail                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `#root` lookup  | missing root element throws a named error instead of rendering nothing                                                                 |
| `QueryClient`   | defaults: `retry: false`, `refetchOnWindowFocus: false` — a payroll client should not silently retry or re-poll behind the user's back |
| `HashRouter`    | hash routing works identically under `file://` and `http://`, so one build serves the desktop today and a browser later                |
| `StrictMode`    | double-invokes effects in development to surface unsafe lifecycles                                                                     |
| Relative import | `./App` is extensionless because this app resolves modules with `moduleResolution: "Bundler"` — adding `.tsx` would itself be an error |

## `src/App.tsx` — the Phase 0 verification dashboard

- `API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4311'`. The env
  variable is the desktop shell's hook: it will inject the ephemeral port its private API
  bound to, which is why the URL is read at runtime rather than baked in.
- `fetchHealth()` requests `${API_BASE_URL}${HEALTH_PATH}` (`/api/health`) with
  `accept: application/json`, parses the body, and throws `payload.error ?? 'API responded
with status N'` when the response is not ok.
- A **rejected** `fetch` — nothing listening, or the API's CORS policy refusing this origin — is
  rethrown as `cannot reach <url>` with the original error kept as `cause`. Chromium's own message
  is a bare `Failed to fetch`, which names neither the cause nor the address. The API admits
  loopback origins only; see [`api.md`](api.md).
- `useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 5_000 })` — the
  status pill therefore re-checks the stack every five seconds.
- Rendering: `StatusPill` (CHECKING / ONLINE / OFFLINE), and `CheckRow` rows for the API base
  URL, API health, database reachability, database name, connected role, a `formatPeso`
  round-trip from `@hexpayroll/shared`, and the PostgreSQL version string. The Database row
  distinguishes **unknown** (no payload ever arrived) from **unreachable** (a `503` whose body says
  so), because rendering the first as the second blames PostgreSQL for a client-side failure.

The expected response shape and its 200/503 semantics are documented in [`api.md`](api.md),
including the loopback-only CORS rule the API must satisfy before this dashboard can read a
response at all.

## `src/vite-env.d.ts`

Types the Vite environment for this app and declares `ImportMetaEnv.VITE_API_BASE_URL?:
string`. It is a `.d.ts` ambient file (no imports/exports), which is what makes the
`interface ImportMeta` augmentation global.
