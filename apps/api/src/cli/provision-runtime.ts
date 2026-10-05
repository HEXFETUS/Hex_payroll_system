import 'dotenv/config';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const database = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const info = await database.query<{ current_user: string; rolsuper: boolean }>(
    'SELECT current_user,rolsuper FROM pg_roles WHERE rolname=current_user',
  );
  if (!info.rows[0]?.rolsuper)
    throw new Error('Run provisioning using the current superuser connection');
  const exists = await database.query("SELECT 1 FROM pg_roles WHERE rolname='hexpayroll_app'");
  if (exists.rowCount)
    throw new Error('Runtime role already exists; use the documented provisioning workflow');
  const password = randomBytes(32).toString('hex');
  await database.query(
    `CREATE ROLE hexpayroll_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  await database.query('GRANT USAGE ON SCHEMA public TO hexpayroll_app');
  await database.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO hexpayroll_app',
  );
  await database.query(
    'ALTER DEFAULT PRIVILEGES FOR ROLE hexpayroll_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO hexpayroll_app',
  );
  await database.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  const url = new URL(process.env.DATABASE_URL!);
  url.username = 'hexpayroll_app';
  url.password = password;
  const content = await readFile('.env', 'utf8');
  await writeFile('.env', content.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url.toString()}`));
  console.log('DML-only runtime role provisioned and local .env updated.');
} finally {
  await database.end();
}
