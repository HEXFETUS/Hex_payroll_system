import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { enqueueAccount } from '../src/sync/accounts.js';
import { DUMMY_PASSWORD_HASH } from '../src/auth/password.js';

function fixture(
  options: { existing?: boolean; identical?: boolean; missing?: boolean; hash?: string } = {},
) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes('FROM auth_users'))
        return {
          rows: options.missing
            ? []
            : [
                {
                  id: 'user-id',
                  organization_id: 'org-id',
                  username: 'clerk',
                  email: null,
                  display_name: 'Clerk',
                  password_hash: options.hash ?? DUMMY_PASSWORD_HASH,
                  active: false,
                  revision: 1,
                  created_at: new Date('2026-10-08T00:00:00Z'),
                  updated_at: new Date('2026-10-08T00:00:00Z'),
                  access_token: 'must-not-export',
                  last_login_at: 'must-not-export',
                },
              ],
        };
      if (sql.includes('FROM user_roles')) return { rows: [{ code: 'viewer' }] };
      if (sql.includes('SELECT id,status'))
        return {
          rows: options.existing
            ? [
                {
                  id: 'old-event',
                  status: 'synced',
                  identical: options.identical ?? true,
                },
              ]
            : [],
        };
      if (sql.includes('INSERT INTO sync_outbox'))
        return { rows: [{ id: 'new-event', status: 'pending' }] };
      throw new Error('Unexpected query');
    },
  } as unknown as PoolClient;
  return { client, calls };
}

test('account snapshot preserves identity, verifier, disabled status and roles without session secrets', async () => {
  const { client, calls } = fixture();
  assert.deepEqual(await enqueueAccount(client, 'user-id'), {
    eventId: 'new-event',
    status: 'pending',
  });
  const insert = calls.find((call) => call.sql.includes('INSERT INTO sync_outbox'))!;
  const payload = JSON.parse(String(insert.values[4]));
  assert.deepEqual(
    Object.keys(payload).sort(),
    [
      'id',
      'organizationId',
      'username',
      'email',
      'displayName',
      'passwordHash',
      'active',
      'revision',
      'createdAt',
      'updatedAt',
      'roles',
    ].sort(),
  );
  assert.equal(payload.passwordHash, DUMMY_PASSWORD_HASH);
  assert.equal(payload.active, false);
  assert.deepEqual(payload.roles, ['viewer']);
  assert.equal(payload.id, 'user-id');
  assert.equal(payload.organizationId, 'org-id');
  assert.equal(insert.values[2], 'CREATE');
  assert(calls[0]!.sql.includes('FOR UPDATE OF u'));
});

test('requeue retains existing receipt and never overwrites delivered events', async () => {
  const { client, calls } = fixture({ existing: true });
  assert.deepEqual(await enqueueAccount(client, 'user-id'), {
    eventId: 'old-event',
    status: 'synced',
  });
  assert(!calls.some((call) => call.sql.includes('INSERT INTO sync_outbox')));
});

test('same revision with different contents is rejected without replacing its event', async () => {
  const { client, calls } = fixture({ existing: true, identical: false });
  await assert.rejects(enqueueAccount(client, 'user-id'), /changed without a new revision/);
  assert(!calls.some((call) => call.sql.includes('INSERT INTO sync_outbox')));
});

test('unscoped accounts and invalid verifiers cannot be exported', async () => {
  for (const options of [{ missing: true }, { hash: 'plaintext-password' }]) {
    const { client, calls } = fixture(options);
    await assert.rejects(enqueueAccount(client, 'user-id'));
    assert(!calls.some((call) => call.sql.includes('INSERT INTO sync_outbox')));
  }
});
