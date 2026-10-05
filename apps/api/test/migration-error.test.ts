import assert from 'node:assert/strict';
import test from 'node:test';
import { migrationErrorMessage } from '../src/cli/migration-error.js';
import { MigrationHistoryError } from '../src/db/migrate.js';

test('migration diagnostics provide actionable codes without driver secrets', () => {
  for (const code of [
    '28P01',
    '28000',
    '42501',
    '3D000',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ECONNRESET',
  ]) {
    const result = migrationErrorMessage({
      code,
      message: 'postgresql://role:secret@host/db',
      detail: 'secret',
    });
    assert(result.includes(`[${code}]`));
    assert(!result.includes('secret'));
    assert(!result.includes('postgresql://'));
  }
  assert(!migrationErrorMessage({ code: 'secret', message: 'secret' }).includes('secret'));
  assert(!migrationErrorMessage(new Error('secret')).includes('secret'));
  assert(
    migrationErrorMessage(new AggregateError([{ code: 'ECONNREFUSED' }])).includes(
      '[ECONNREFUSED]',
    ),
  );
});

test('migration history diagnostics retain the original message', () => {
  const message = 'Applied migration changed or missing: 0001_auth.sql';
  assert.equal(migrationErrorMessage(new MigrationHistoryError(message)), message);
});
