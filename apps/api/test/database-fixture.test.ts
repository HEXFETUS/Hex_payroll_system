import test from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { databaseFixture } from './database-fixture.js';

test('fixture setup and cleanup failures use only the designated schema', async (t) => {
  const previous = {
    migration: process.env.TEST_MIGRATION_DATABASE_URL,
    runtime: process.env.TEST_DATABASE_URL,
  };
  process.env.TEST_MIGRATION_DATABASE_URL =
    'postgres://hexpayroll_migrator@localhost:5432/hexpayroll_test';
  process.env.TEST_DATABASE_URL = 'postgres://hexpayroll_app@localhost:5432/hexpayroll_test';
  t.after(() => {
    for (const [key, value] of [
      ['TEST_MIGRATION_DATABASE_URL', previous.migration],
      ['TEST_DATABASE_URL', previous.runtime],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  });
  function mocks(
    options: { setup?: string; end?: boolean; drop?: boolean; poolCreationFails?: boolean } = {},
  ) {
    const calls: string[] = [];
    const original = new Error('original setup failure');
    let count = 0;
    return {
      calls,
      original,
      dependencies: {
        createPool: (_config: pg.PoolConfig) => {
          const index = count++;
          if (options.poolCreationFails && index === 2) throw original;
          return {
            async query(sql: string) {
              calls.push(sql);
              if (options.setup && sql.includes(options.setup)) throw original;
              if (options.drop && sql.startsWith('DROP')) throw new Error('drop failed');
              return { rows: [{ current_user: 'hexpayroll_app' }] };
            },
            async end() {
              calls.push(`end:${index}`);
              if (options.end) throw new Error('end failed');
            },
          } as unknown as pg.Pool;
        },
        readMigrations: async () => [],
      },
    };
  }
  await t.test('setup failures retain the original error despite cleanup failures', async () => {
    for (const setup of ['CREATE SCHEMA', 'SELECT current_user', 'GRANT USAGE', 'ALTER DEFAULT']) {
      const fixture = mocks({ setup, end: true, drop: true });
      await assert.rejects(
        databaseFixture(fixture.dependencies),
        (error) => error === fixture.original,
      );
      assert(fixture.calls.includes('end:0'));
      const drops = fixture.calls.filter((call) => call.startsWith('DROP'));
      assert.equal(drops.length, setup === 'CREATE SCHEMA' ? 0 : 1);
      for (const drop of drops)
        assert.match(drop, /^DROP SCHEMA hexpayroll_phase1_test_[a-f0-9]{16} CASCADE$/);
    }
  });
  await t.test('partial pool initialization is cleaned up', async () => {
    const fixture = mocks({ poolCreationFails: true });
    await assert.rejects(
      databaseFixture(fixture.dependencies),
      (error) => error === fixture.original,
    );
    assert(fixture.calls.includes('end:1'));
    assert(fixture.calls.includes('end:0'));
    assert(fixture.calls.some((call) => call.startsWith('DROP SCHEMA')));
  });
  await t.test('close attempts every cleanup operation and is idempotent', async () => {
    const fixture = mocks({ end: true, drop: true });
    const db = await databaseFixture(fixture.dependencies);
    await assert.rejects(db.close(), AggregateError);
    await assert.rejects(db.close(), AggregateError);
    for (const index of [0, 1, 2])
      assert.equal(fixture.calls.filter((call) => call === `end:${index}`).length, 1);
    assert.equal(fixture.calls.filter((call) => call.startsWith('DROP SCHEMA')).length, 1);
  });
  await t.test('normal cleanup succeeds', async () => {
    const fixture = mocks();
    const db = await databaseFixture(fixture.dependencies);
    await db.close();
    assert.equal(fixture.calls.filter((call) => call.startsWith('DROP SCHEMA')).length, 1);
  });
  await t.test('unsafe and missing test URLs are rejected before pool creation', async () => {
    const fixture = mocks();
    process.env.TEST_DATABASE_URL = 'postgres://hexpayroll_app@localhost:5432/payroll_sys';
    await assert.rejects(databaseFixture(fixture.dependencies), /dedicated hexpayroll_test/);
    delete process.env.TEST_DATABASE_URL;
    await assert.rejects(databaseFixture(fixture.dependencies), /Explicit test/);
    assert.deepEqual(fixture.calls, []);
  });
});
