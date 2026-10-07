import { PAYROLL_ENGINE_VERSION } from '@hexpayroll/payroll-engine';
import { createApp, logger } from './app.js';
import { env } from './config/env.js';
import { pool, probeDatabase } from './db/pool.js';
import { startAttendanceWorker } from './timekeeping/worker.js';
import { startSyncWorker } from './sync/client.js';

async function main(): Promise<void> {
  // Probe before binding a port. If the database is unreachable we want a clear
  // startup failure, not an API that accepts requests it cannot serve.
  const probe = await probeDatabase();
  logger.info({ database: probe.database, connectedAs: probe.user }, 'postgres reachable');

  const app = createApp();
  const stopSync =
    env.SYNC_MODE === 'local'
      ? startSyncWorker(
          pool,
          { url: env.SYNC_CENTRAL_URL!, nodeId: env.SYNC_NODE_ID!, token: env.SYNC_NODE_TOKEN! },
          env.SYNC_INTERVAL_MS,
          () => logger.warn('Synchronization unavailable; local operations continue'),
        )
      : async () => {};
  const stopWorker = startAttendanceWorker(pool, () =>
    logger.error('Attendance worker failed; retrying'),
  );

  const server = app.listen(env.API_PORT, env.API_HOST, () => {
    logger.info(
      {
        host: env.API_HOST,
        port: env.API_PORT,
        nodeEnv: env.NODE_ENV,
        payrollEngine: PAYROLL_ENGINE_VERSION,
      },
      'Hex Payroll API listening',
    );
  });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void stopWorker()
        .then(() => stopSync())
        .then(() => pool.end())
        .then(() => {
          process.exit(0);
        });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  logger.error(
    { errorType: error instanceof Error ? error.name : 'unknown' },
    'fatal error during startup',
  );
  process.exit(1);
});
