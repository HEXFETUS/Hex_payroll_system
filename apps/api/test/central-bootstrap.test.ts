import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { bootstrapCentral, centralBootstrapSchema } from '../src/bootstrap/central.js';
import { verifyPassword } from '../src/auth/password.js';
import { databaseFixture, databaseTestsEnabled } from './database-fixture.js';
import { migrate } from '../src/db/migrate.js';

const input = {
  administrator: {
    username: 'centraladmin',
    displayName: 'Central administrator',
    password: 'disposable-test-password-123',
  },
  organization: { id: '01a10b0c-6aae-7913-90b9-479f8e0a3bca', legalName: 'Central bootstrap test' },
};
test('central bootstrap requires a canonical UUID and validates administrator credentials', () => {
  assert.equal(centralBootstrapSchema.safeParse(input).success, true);
  assert.equal(
    centralBootstrapSchema.safeParse({ ...input, organization: { legalName: 'Company' } }).success,
    false,
  );
  assert.equal(
    centralBootstrapSchema.safeParse({
      ...input,
      administrator: { ...input.administrator, password: 'short' },
    }).success,
    false,
  );
});

test(
  'central bootstrap is atomic, preserves identity, rejects runtime role and repeated/concurrent setup',
  { skip: !databaseTestsEnabled },
  async () => {
    const fixture = await databaseFixture();
    let bootstrapPool: pg.Pool | undefined;
    try {
      await migrate(fixture.migrator, fixture.migrations);
      if (process.env.TEST_BOOTSTRAP_DATABASE_URL) {
        const url = new URL(process.env.TEST_BOOTSTRAP_DATABASE_URL);
        assert.match(url.pathname.slice(1), /^hexpayroll_auth_test_[a-z0-9_]+$/);
        assert.equal(url.username, 'hexpayroll_bootstrap');
        const schema = (await fixture.migrator.query('SELECT current_schema() AS name')).rows[0]
          .name;
        assert.match(schema, /^hexpayroll_phase1_test_[a-f0-9]+$/);
        await fixture.migrator.query(`GRANT USAGE ON SCHEMA ${schema} TO hexpayroll_bootstrap`);
        for (const grant of [
          'SELECT, UPDATE ON application_setup',
          'SELECT, INSERT, UPDATE ON auth_users',
          'SELECT, INSERT ON organizations',
          'SELECT ON roles',
          'INSERT ON user_roles, audit_events, sync_outbox',
        ])
          await fixture.migrator.query(`GRANT ${grant} TO hexpayroll_bootstrap`);
        bootstrapPool = new pg.Pool({
          connectionString: url.toString(),
          options: `-c search_path=${schema}`,
        });
        const rights = (
          await bootstrapPool.query(
            "SELECT has_table_privilege(current_user,'auth_sessions','INSERT') AS sessions, has_table_privilege(current_user,'organizations','DELETE') AS deletes",
          )
        ).rows[0];
        assert.equal(rights.sessions, false);
        assert.equal(rights.deletes, false);
      }
      const bootstrapDatabase = bootstrapPool ?? fixture.migrator;
      await assert.rejects(bootstrapCentral(fixture.runtime, input), /separate bootstrap/);
      await fixture.migrator.query(
        "INSERT INTO auth_users(username,display_name,password_hash) VALUES('existing','Existing user','test-only')",
      );
      await assert.rejects(bootstrapCentral(bootstrapDatabase, input), /empty installation/);
      await fixture.migrator.query("DELETE FROM auth_users WHERE username='existing'");
      await fixture.migrator.query(
        'ALTER TABLE sync_outbox ADD CONSTRAINT bootstrap_failure CHECK(false)',
      );
      await assert.rejects(bootstrapCentral(bootstrapDatabase, input));
      for (const table of [
        'auth_users',
        'user_roles',
        'organizations',
        'audit_events',
        'sync_outbox',
      ]) {
        assert.equal(
          (await fixture.migrator.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0]
            .count,
          0,
        );
      }
      const untouched = (
        await fixture.migrator.query(
          'SELECT administrator_id,organization_id FROM application_setup',
        )
      ).rows[0];
      assert.equal(untouched.administrator_id, null);
      assert.equal(untouched.organization_id, null);
      await fixture.migrator.query('ALTER TABLE sync_outbox DROP CONSTRAINT bootstrap_failure');
      const results = await Promise.allSettled([
        bootstrapCentral(bootstrapDatabase, input),
        bootstrapCentral(bootstrapDatabase, input),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
      const row = (await fixture.migrator.query('SELECT * FROM auth_users')).rows[0];
      assert.equal(row.organization_id, input.organization.id);
      assert.notEqual(row.password_hash, input.administrator.password);
      assert.equal(await verifyPassword(input.administrator.password, row.password_hash), true);
      assert.equal(
        (
          await fixture.migrator.query(
            'SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1',
            [row.id],
          )
        ).rows[0].code,
        'administrator',
      );
      assert.equal(
        (await fixture.migrator.query('SELECT count(*)::int AS count FROM audit_events')).rows[0]
          .count,
        3,
      );
      assert.equal(
        (await fixture.migrator.query('SELECT organization_id FROM sync_outbox')).rows[0]
          .organization_id,
        input.organization.id,
      );
      await assert.rejects(bootstrapCentral(bootstrapDatabase, input), /already initialized/);
    } finally {
      await bootstrapPool?.end();
      await fixture.close();
    }
  },
);
