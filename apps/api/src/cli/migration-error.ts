import { MigrationHistoryError } from '../db/migrate.js';

export function migrationErrorMessage(error: unknown): string {
  if (error instanceof MigrationHistoryError) return error.message;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  // Only allow known codes and fixed messages: driver messages can contain secrets.
  switch (code) {
    case '28P01':
    case '28000':
      return `Migration failed [${code}]: PostgreSQL authentication failed. Check the migration role and its password in apps/api/.env (MIGRATION_DATABASE_URL); percent-encode special characters in the password.`;
    case '42501':
      return 'Migration failed [42501]: Insufficient privileges. Check that the migrator owns the migration objects and has CREATE permission on schema public in the configured database.';
    case '3D000':
      return 'Migration failed [3D000]: The configured database does not exist. Check the database name in MIGRATION_DATABASE_URL.';
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ECONNRESET':
      return `Migration failed [${code}]: Cannot connect to PostgreSQL. Check that the server is running and the migration host and port are correct.`;
  }
  if (error instanceof AggregateError) {
    for (const cause of error.errors) {
      const message = migrationErrorMessage(cause);
      if (message.includes('Migration failed [')) return message;
    }
  }
  return 'Migration failed. Check migration files and the migration database configuration.';
}
