import express from 'express';
import type { ErrorRequestHandler, Express, RequestHandler } from 'express';
import pino from 'pino';
import { env } from './config/env.js';
import { corsMiddleware } from './middleware/cors.js';
import { healthRouter } from './routes/health.js';

export const logger = pino({ level: env.LOG_LEVEL });

const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      'request handled',
    );
  });

  next();
};

const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ status: 'error', message: 'Not found' });
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  logger.error({ err: error }, 'unhandled error');
  res.status(500).json({ status: 'error', message: 'Internal server error' });
};

/**
 * Builds the Express application.
 *
 * This factory is the whole point of the deployment shape: the SAME app is
 * mounted by `local.ts` (spawned as a child process by the Electron desktop
 * shell, bound to loopback) and by `server.ts` (the central server). There is no
 * "desktop API" and "cloud API" to keep in sync — only one application with two
 * entrypoints.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  // Before the body parser: a preflight carries no body, and a rejected origin
  // must not be able to make the server parse anything.
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // Mounted under `/api`, which is where every consumer expects health
  // (`HEALTH_PATH` in @hexpayroll/shared) and where resource routes will live.
  app.use('/api', healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
