import { Router, json, type Request, type Response, type ErrorRequestHandler } from 'express';
import { loginRequestSchema, type AuthErrorCode } from '@hexpayroll/shared';
import type { AuthService } from '../auth/service.js';
import { createLoginLimiter } from '../auth/rate-limit.js';
function fail(res: Response, status: number, code: AuthErrorCode) {
  res.status(status).json({ error: { code } });
}
function bearer(req: Request): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? '');
  return match?.[1];
}
function unavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return (
    /^(08|53|57P)/.test(code) ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', '42P01'].includes(code) ||
    /connection.*(terminated|timeout)|timeout.*connect/i.test(error.message)
  );
}
export function createAuthRouter(service: AuthService, limiter = createLoginLimiter()) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post(
    '/login',
    (req, res, next) => {
      const retryAfter = limiter(req.ip ?? req.socket.remoteAddress ?? 'unknown');
      if (retryAfter) {
        res.setHeader('Retry-After', retryAfter);
        fail(res, 429, 'RATE_LIMITED');
        return;
      }
      next();
    },
    json({ limit: '8kb' }),
    async (req, res) => {
      const input = loginRequestSchema.safeParse(req.body);
      if (!input.success) {
        fail(res, 400, 'INVALID_REQUEST');
        return;
      }
      try {
        const result = await service.login(input.data);
        if (!result) {
          fail(res, 401, 'INVALID_CREDENTIALS');
          return;
        }
        res.json(result);
      } catch (error) {
        fail(
          res,
          unavailable(error) ? 503 : 500,
          unavailable(error) ? 'SERVICE_UNAVAILABLE' : 'AUTHENTICATION_FAILED',
        );
      }
    },
  );
  router.get('/session', async (req, res) => {
    const token = bearer(req);
    if (!token) {
      fail(res, 401, 'SESSION_INVALID');
      return;
    }
    try {
      const session = await service.session(token);
      if (!session) {
        fail(res, 401, 'SESSION_INVALID');
        return;
      }
      res.json(session);
    } catch (error) {
      fail(
        res,
        unavailable(error) ? 503 : 500,
        unavailable(error) ? 'SERVICE_UNAVAILABLE' : 'AUTHENTICATION_FAILED',
      );
    }
  });
  router.post('/logout', async (req, res) => {
    const token = bearer(req);
    if (!token) {
      fail(res, 401, 'SESSION_INVALID');
      return;
    }
    try {
      await service.logout(token);
      res.status(204).end();
    } catch (error) {
      fail(
        res,
        unavailable(error) ? 503 : 500,
        unavailable(error) ? 'SERVICE_UNAVAILABLE' : 'AUTHENTICATION_FAILED',
      );
    }
  });
  const errors: ErrorRequestHandler = (_error, _req, res, _next) => {
    fail(res, 400, 'INVALID_REQUEST');
  };
  router.use(errors);
  return router;
}
