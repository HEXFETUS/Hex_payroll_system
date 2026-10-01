import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { migrate, readMigrations } from '../db/migrate.js';
import { migrationErrorMessage } from './migration-error.js';
async function main() {
  if (!env.MIGRATION_DATABASE_URL) {
    console.error('MIGRATION_DATABASE_URL is required in apps/api/.env.');
    process.exitCode = 1;
    return;
  }
  const database = new pg.Pool({
    connectionString: env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    const applied = await migrate(
      database,
      await readMigrations(
        fileURLToPath(new URL('../../../../database/migrations/', import.meta.url)),
      ),
    );
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'All migrations are current.');
  } finally {
    await database.end();
  }
}
main().catch((error: unknown) => {
  console.error(migrationErrorMessage(error));
  process.exitCode = 1;
});
