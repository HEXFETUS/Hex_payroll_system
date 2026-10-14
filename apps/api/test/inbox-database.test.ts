import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { databaseFixture, databaseTestsEnabled } from './database-fixture.js';
import { migrate } from '../src/db/migrate.js';
import { applyInboxBatch } from '../src/sync/inbox.js';
import { DUMMY_PASSWORD_HASH } from '../src/auth/password.js';

test(
  'inbox applies existing account events atomically, preserves conflicts and retries',
  { skip: !databaseTestsEnabled },
  async () => {
    const db = await databaseFixture();
    try {
      await migrate(db.migrator, db.migrations);
      const org = randomUUID(),
        id = randomUUID();
      await db.runtime.query("INSERT INTO organizations(id,legal_name) VALUES($1,'Inbox test')", [
        org,
      ]);
      await db.runtime.query('UPDATE application_setup SET organization_id=$1', [org]);
      const payload = {
        id,
        organizationId: org,
        username: 'stef',
        email: null,
        displayName: 'Stef',
        passwordHash: DUMMY_PASSWORD_HASH,
        active: true,
        revision: 1,
        createdAt: '2026-10-08T00:00:00.000Z',
        updatedAt: '2026-10-08T00:00:00.000Z',
        roles: ['viewer'],
      };
      async function queue(sequence: number, snapshot: typeof payload, entityType = 'auth_users') {
        await db.runtime.query(
          `INSERT INTO sync_inbox(organization_id,sequence,change_id,source_node_id,source_event_id,entity_type,entity_id,operation,revision,payload_version,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,'UPDATE',$8,1,$9)`,
          [
            org,
            sequence,
            randomUUID(),
            randomUUID(),
            randomUUID(),
            entityType,
            id,
            snapshot.revision,
            JSON.stringify(snapshot),
          ],
        );
      }
      await queue(10, payload);
      assert.equal((await applyInboxBatch(db.runtime, org)).applied, 1);
      assert.equal(
        (await db.runtime.query('SELECT username FROM auth_users WHERE id=$1', [id])).rows[0]
          .username,
        'stef',
      );
      assert.equal((await applyInboxBatch(db.runtime, org)).applied, 0);
      await queue(11, payload);
      assert.equal((await applyInboxBatch(db.runtime, org)).applied, 1);
      await queue(12, { ...payload, displayName: 'Conflicting' });
      assert.equal((await applyInboxBatch(db.runtime, org)).pending, 1);
      assert.equal(
        (await db.runtime.query('SELECT display_name FROM auth_users WHERE id=$1', [id])).rows[0]
          .display_name,
        'Stef',
      );
      await db.runtime.query('UPDATE sync_inbox SET payload=$1 WHERE sequence=12', [
        JSON.stringify(payload),
      ]);
      assert.equal((await applyInboxBatch(db.runtime, org)).applied, 1);
      await queue(13, { ...payload, revision: 2, active: false, roles: ['payroll_clerk'] });
      assert.equal((await applyInboxBatch(db.runtime, org)).applied, 1);
      assert.equal(
        (await db.runtime.query('SELECT active,revision FROM auth_users WHERE id=$1', [id])).rows[0]
          .active,
        false,
      );
      await queue(14, payload);
      assert.equal((await applyInboxBatch(db.runtime, org)).applied, 1);
      await queue(15, {
        ...payload,
        revision: 3,
        displayName: 'Rollback',
        roles: ['missing_role'],
      });
      assert.equal((await applyInboxBatch(db.runtime, org)).pending, 1);
      assert.equal(
        (await db.runtime.query('SELECT revision FROM auth_users WHERE id=$1', [id])).rows[0]
          .revision,
        2,
      );
      const failed = (
        await db.runtime.query('SELECT applied_at,apply_error FROM sync_inbox WHERE sequence=15')
      ).rows[0];
      assert.equal(failed.applied_at, null);
      assert.equal(failed.apply_error, 'Account role is unavailable locally');
      await queue(16, payload, 'employees');
      await assert.rejects(applyInboxBatch(db.runtime, randomUUID()), /installation/);
      assert.equal(
        (await db.runtime.query('SELECT count(*)::int count FROM sync_outbox')).rows[0].count,
        0,
      );
    } finally {
      await db.close();
    }
  },
);
