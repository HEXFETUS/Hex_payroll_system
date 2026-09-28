import pg from 'pg';
import { env } from '../config/env.js';

/**
 * The application connection pool.
 *
 * This pool connects as `hexpayroll_app`, which has DML privileges but no right
 * to alter the schema. Schema changes are the exclusive job of the migration
 * runner (Phase 1), which connects separately as `hexpayroll_migrator`. A
 * payroll process that cannot silently alter its own schema is a meaningful
 * safety property, not just tidiness.
 *
 * NOTE: `pg` is CommonJS, so under ESM/NodeNext we take the default export and
 * destructure — the standard interop pattern for this driver.
 */
const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export interface DatabaseProbe {
  /** Full `SELECT version()` string — identifies which server answered. */
  version: string;
  database: string;
  user: string;
}

/**
 * Runs a real query against PostgreSQL.
 *
 * Deliberately not a `SELECT 1`: the health endpoint should prove the
 * connection is authenticated, on the expected database, as the expected role.
 */
export async function probeDatabase(): Promise<DatabaseProbe> {
  const result = await pool.query<DatabaseProbe>(
    'SELECT version() AS version, current_database() AS database, current_user AS "user"',
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('database probe returned no rows');
  }

  return row;
}
