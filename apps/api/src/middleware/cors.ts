import type { RequestHandler } from 'express';

/**
 * Cross-origin access for the loopback renderer.
 *
 * The UI is served from a different origin than the API — in development
 * `http://127.0.0.1:5273` (Vite) calls `http://127.0.0.1:4311` — and a browser
 * will not hand the response to the page unless the API opts in with
 * `Access-Control-Allow-Origin`. Without this middleware `fetch()` rejects with
 * `TypeError: Failed to fetch` and the dashboard renders OFFLINE, even though
 * the request reached the server and PostgreSQL answered it.
 *
 * This is an allowlist, never `*`. `Access-Control-Allow-Credentials` is
 * deliberately never set: the desktop's per-launch credential will be a bearer
 * token, and reflecting credentials to arbitrary origins is the exact mistake
 * that rule exists to prevent.
 *
 * NOT covered on purpose: the packaged shell loads the UI over `file://`, which
 * sends `Origin: null`. Allowing that is a Phase 4 decision (a custom protocol
 * vs. permitting `null`), so the boundary stays closed here rather than being
 * widened just to make development work.
 */
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

/**
 * `authorization` is listed ahead of need: the desktop's bearer token will
 * travel in that header once the shell spawns its private local API (Phase 1/4),
 * and a preflight that omits it would fail before the request is ever sent.
 */
const ALLOWED_HEADERS = 'accept, content-type, authorization';

export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;

  if (typeof origin === 'string' && LOOPBACK_ORIGIN.test(origin)) {
    // Reflect the caller's own origin. `Vary` is not optional: without it a
    // shared cache could return one origin's response to another.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  }

  // Preflights carry no body and must not fall through to the routes. A
  // disallowed origin still gets 204 — it simply arrives without the headers
  // above, which is precisely what makes the browser fail the check.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
};
