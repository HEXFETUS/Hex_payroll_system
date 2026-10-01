import { Router } from 'express';
import type { HealthStatus } from '@hexpayroll/shared';
import { probeDatabase, type DatabaseProbe } from '../db/pool.js';

export function createHealthRouter(probe: () => Promise<DatabaseProbe> = probeDatabase): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await probe();
      const body: HealthStatus = {
        status: 'ok',
        database: 'reachable',
        databaseVersion: result.version,
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(body);
    } catch {
      const body: HealthStatus = {
        status: 'error',
        database: 'unreachable',
        timestamp: new Date().toISOString(),
        error: 'Database readiness check failed',
      };
      res.status(503).json(body);
    }
  });
  return router;
}
export const healthRouter = createHealthRouter();
