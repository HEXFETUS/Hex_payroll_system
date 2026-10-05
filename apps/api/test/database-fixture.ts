import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readMigrations } from '../src/db/migrate.js';
export const databaseTestsEnabled = Boolean(
  (process.env.TEST_DATABASE_URL && process.env.TEST_MIGRATION_DATABASE_URL) ||
  process.env.PHASE1_TEST_LOCAL === '1',
);
export async function databaseFixture() {
  const migrationUrl =
    process.env.TEST_MIGRATION_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
  const runtimeUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!migrationUrl || !runtimeUrl) throw new Error('Test database connections required');
  if (process.env.PHASE1_TEST_LOCAL !== '1')
    for (const url of [migrationUrl, runtimeUrl])
      if (!/^hexpayroll_auth_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1)))
        throw new Error('Use a dedicated test database');
  const name = 'hexpayroll_phase1_test_' + randomBytes(8).toString('hex');
  const owner = new pg.Pool({ connectionString: migrationUrl });
  try {
    await owner.query(`CREATE SCHEMA ${name}`);
  } catch (error) {
    await owner.end();
    throw error;
  }
  const options = `-c search_path=${name}`;
  const migrator = new pg.Pool({ connectionString: migrationUrl, options });
  const runtime = new pg.Pool({ connectionString: runtimeUrl, options });
  const role = (await runtime.query<{ current_user: string }>('SELECT current_user')).rows[0]!
    .current_user;
  if (role !== 'hexpayroll_app') throw new Error('Tests require the DML-only hexpayroll_app role');
  await owner.query(`GRANT USAGE ON SCHEMA ${name} TO hexpayroll_app`);
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE hexpayroll_migrator IN SCHEMA ${name} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO hexpayroll_app`,
  );
  const migrations = await readMigrations(
    fileURLToPath(new URL('../../../database/migrations/', import.meta.url)),
  );
  return {
    migrator,
    runtime,
    migrations,
    async close() {
      await runtime.end();
      await migrator.end();
      await owner.query(`DROP SCHEMA ${name} CASCADE`);
      await owner.end();
    },
  };
}
