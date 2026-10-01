import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}
export class MigrationHistoryError extends Error {}
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}
export async function readMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const migrations = await Promise.all(
    names.map(async (name) => {
      const sql = await readFile(`${directory}/${name}`, 'utf8');
      return { name, sql, checksum: migrationChecksum(sql) };
    }),
  );
  if (new Set(names.map((name) => name.split('_')[0])).size !== names.length)
    throw new MigrationHistoryError('Duplicate migration number');
  return migrations;
}
export async function migrate(database: Pool, migrations: Migration[]): Promise<string[]> {
  const client = await database.connect();
  const applied: string[] = [];
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(684297103)');
    locked = true;
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const existing = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );
    for (const row of existing.rows) {
      const source = migrations.find((migration) => migration.name === row.name);
      if (!source || source.checksum !== row.checksum)
        throw new MigrationHistoryError(`Applied migration changed or missing: ${row.name}`);
    }
    for (const migration of migrations) {
      if (existing.rows.some((row) => row.name === migration.name)) continue;
      if (existing.rows.some((row) => row.name > migration.name))
        throw new MigrationHistoryError(`Out-of-order migration: ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name,checksum) VALUES ($1,$2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        applied.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(684297103)').catch(() => undefined);
    client.release();
  }
}
