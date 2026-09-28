import { Router } from 'express';
import type { HealthStatus } from '@hexpayroll/shared';
import { probeDatabase } from '../db/pool.js';

export const healthRouter: Router = Router();

/**
 * GET /api/health
 *
 * Returns 200 only when PostgreSQL has actually answered a query as the
 * expected runtime role. Returns 503 when the database is unreachable, so this
 * endpoint is usable as a real readiness probe rather than a liveness no-op.
 */
healthRouter.get('/health', async (_req, res) => {
  const timestamp = new Date().toISOString();

  try {
    const probe = await probeDatabase();
    const body: HealthStatus = {
      status: 'ok',
      database: 'reachable',
      databaseVersion: probe.version,
      timestamp,
    };

    res.status(200).json({
      ...body,
      databaseName: probe.database,
      connectedAs: probe.user,
    });
  } catch (error) {
    const body: HealthStatus = {
      status: 'error',
      database: 'unreachable',
      timestamp,
      error: error instanceof Error ? error.message : 'unknown error',
    };

    res.status(503).json(body);
  }
});
