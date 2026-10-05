import type { Pool } from 'pg';
import type { RequestHandler, ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { tokenHash } from '../auth/service.js';
import { DomainError, getActor, databaseErrorCode } from '../foundation/repository.js';
export const authenticate =
  (pool: Pool): RequestHandler =>
  async (req, res, next) => {
    if (res.locals.actor) {
      next();
      return;
    }
    try {
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? '')?.[1];
      if (!token) throw new DomainError(401, 'SESSION_INVALID', 'Sign in required');
      const found = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()',
        [tokenHash(token)],
      );
      if (!found.rows[0]) throw new DomainError(401, 'SESSION_INVALID', 'Session invalid');
      res.locals.actor = await getActor(pool, found.rows[0].user_id);
      res.setHeader('Cache-Control', 'no-store');
      next();
    } catch (e) {
      next(e);
    }
  };
export const domainErrors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof DomainError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
    });
    return;
  }
  const code = databaseErrorCode(error),
    status =
      code === '23505'
        ? 409
        : ['23503', '23514', '22P02'].includes(code)
          ? 400
          : /^(08|53|57P)/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)
            ? 503
            : 500;
  res.status(status).json({
    error: {
      code:
        status === 409
          ? 'DUPLICATE'
          : status === 400
            ? 'INVALID_REQUEST'
            : status === 503
              ? 'SERVICE_UNAVAILABLE'
              : 'INTERNAL_ERROR',
      message:
        status === 409
          ? 'Identifier already exists'
          : status === 400
            ? 'Invalid fields or related records'
            : status === 503
              ? 'Local database unavailable'
              : 'Operation failed',
    },
  });
};
