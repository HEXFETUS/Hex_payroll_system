import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { organizationInputSchema, organizationSetupSchema } from '@hexpayroll/shared';
import { databaseFixture, databaseTestsEnabled } from './database-fixture.js';
import { migrate } from '../src/db/migrate.js';
import { tokenHash } from '../src/auth/service.js';
import { createFoundationRouter } from '../src/foundation/router.js';

const canonicalId = '01a10b0c-6aae-7913-90b9-479f8e0a3bca';

test('only the dedicated setup schema accepts an organization identity', () => {
  const company = { legalName: 'Bootstrap test company' };
  assert.equal(organizationSetupSchema.safeParse(company).success, true);
  assert.equal(organizationSetupSchema.parse({ ...company, id: canonicalId }).id, canonicalId);
  assert.equal(organizationSetupSchema.safeParse({ ...company, id: 'invalid' }).success, false);
  assert.equal(organizationSetupSchema.safeParse({ ...company, extra: true }).success, false);
  assert.equal(organizationInputSchema.safeParse({ ...company, id: canonicalId }).success, false);
  assert.deepEqual(organizationSetupSchema.parse(company), organizationInputSchema.parse(company));
});

test(
  'organization setup preserves identity only in central mode and retains authorization and atomicity',
  { skip: !databaseTestsEnabled },
  async (t) => {
    for (const scenario of [
      { name: 'ordinary local setup generates UUIDv7', mode: 'disabled', explicit: false },
      { name: 'local transport mode rejects explicit identity', mode: 'local', explicit: true },
      { name: 'disabled sync mode rejects explicit identity', mode: 'disabled', explicit: true },
      { name: 'central bootstrap preserves the canonical UUID', mode: 'central', explicit: true },
      { name: 'central setup without identity generates UUIDv7', mode: 'central', explicit: false },
    ]) {
      await t.test(scenario.name, async () => {
        const fixture = await databaseFixture();
        let closeServer: (() => Promise<void>) | undefined;
        try {
          await migrate(fixture.migrator, fixture.migrations);
          // Seed sessions for HTTP authorization; no production organization is seeded.
          const identities: { id: string; token: string }[] = [];
          for (const username of ['bootstrap', 'otheradmin', 'viewer', 'unassigned']) {
            const r = await fixture.runtime.query<{ id: string }>(
              'INSERT INTO auth_users(username,display_name,password_hash) VALUES($1,$1,$2) RETURNING id',
              [username, 'unused-test-hash'],
            );
            const id = r.rows[0]!.id,
              token = randomBytes(32).toString('base64url');
            await fixture.runtime.query(
              "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
              [tokenHash(token), id],
            );
            if (username === 'bootstrap' || username === 'otheradmin')
              await fixture.runtime.query(
                "INSERT INTO user_roles SELECT $1,id FROM roles WHERE code='administrator'",
                [id],
              );
            if (username === 'viewer')
              await fixture.runtime.query(
                "INSERT INTO user_roles SELECT $1,id FROM roles WHERE code='viewer'",
                [id],
              );
            identities.push({ id, token });
          }
          const admin = identities[0]!;
          await fixture.runtime.query(
            'UPDATE application_setup SET administrator_id=$1 WHERE singleton',
            [admin.id],
          );
          const app = express();
          app.use(express.json());
          app.use('/api', createFoundationRouter(fixture.runtime, { mode: scenario.mode }));
          const server = app.listen(0, '127.0.0.1');
          await once(server, 'listening');
          closeServer = () =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
              server.closeAllConnections();
            });
          const address = server.address();
          assert.ok(address && typeof address !== 'string');
          const request = async (
            body: unknown,
            token: string | null = admin.token,
            method = 'POST',
          ) => {
            const response = await fetch(
              `http://127.0.0.1:${address.port}/api/organization${method === 'POST' ? '/setup' : ''}`,
              {
                method,
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify(body),
              },
            );
            return {
              status: response.status,
              data: (await response.json()) as Record<string, unknown>,
            };
          };
          const company = { legalName: 'Bootstrap test company' };
          assert.equal((await request(company, null)).status, 401);
          assert.equal((await request(company, identities[2]!.token)).status, 403);
          assert.equal((await request(company, identities[1]!.token)).status, 403);
          const assertUnconfigured = async () => {
            assert.equal(
              (await fixture.runtime.query('SELECT count(*)::integer count FROM organizations'))
                .rows[0].count,
              0,
            );
            assert.equal(
              (
                await fixture.runtime.query(
                  'SELECT organization_id FROM application_setup WHERE singleton',
                )
              ).rows[0].organization_id,
              null,
            );
            assert.equal(
              (
                await fixture.runtime.query(
                  'SELECT count(*)::integer count FROM auth_users WHERE organization_id IS NOT NULL',
                )
              ).rows[0].count,
              0,
            );
            assert.equal(
              (await fixture.runtime.query('SELECT count(*)::integer count FROM audit_events'))
                .rows[0].count,
              0,
            );
            assert.equal(
              (await fixture.runtime.query('SELECT count(*)::integer count FROM sync_outbox'))
                .rows[0].count,
              0,
            );
          };
          await assertUnconfigured();
          assert.equal((await request({ ...company, id: 'invalid' })).status, 400);
          let body: Record<string, unknown> = {
            ...company,
            ...(scenario.explicit ? { id: canonicalId } : {}),
          };
          if (scenario.explicit && scenario.mode !== 'central') {
            const rejected = await request(body);
            assert.equal(rejected.status, 400);
            assert.equal(
              (rejected.data.error as { message: string }).message,
              'Explicit organization ID is only allowed during central setup',
            );
            await assertUnconfigured();
            body = company;
          }
          // Prove that an outbox failure rolls back organization, users, setup, audit and roles.
          await fixture.migrator.query(
            'ALTER TABLE sync_outbox ADD CONSTRAINT test_setup_outbox_failure CHECK(false)',
          );
          assert.equal((await request(body)).status, 400);
          await assertUnconfigured();
          assert.equal(
            (
              await fixture.runtime.query(
                'SELECT count(*)::integer count FROM user_roles WHERE user_id=$1',
                [identities[3]!.id],
              )
            ).rows[0].count,
            0,
          );
          await fixture.migrator.query(
            'ALTER TABLE sync_outbox DROP CONSTRAINT test_setup_outbox_failure',
          );
          // The setup row lock serializes competing initial requests.
          const attempts = await Promise.all([request(body), request(body)]);
          assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
          const created = attempts.find((result) => result.status === 201)!.data;
          const id = String(created.id);
          if (scenario.explicit && scenario.mode === 'central') assert.equal(id, canonicalId);
          else {
            assert.notEqual(id, canonicalId);
            assert.match(
              id,
              /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
            );
          }
          assert.equal(
            (
              await fixture.runtime.query(
                'SELECT organization_id FROM application_setup WHERE singleton',
              )
            ).rows[0].organization_id,
            id,
          );
          assert.equal(
            (
              await fixture.runtime.query(
                'SELECT count(*)::integer count FROM auth_users WHERE organization_id=$1',
                [id],
              )
            ).rows[0].count,
            4,
          );
          assert.equal(
            (
              await fixture.runtime.query(
                "SELECT count(*)::integer count FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND r.code='viewer'",
                [identities[3]!.id],
              )
            ).rows[0].count,
            1,
          );
          const audit = (
            await fixture.runtime.query(
              'SELECT organization_id,user_id,entity_id,metadata FROM audit_events',
            )
          ).rows;
          assert.equal(audit.length, 1);
          assert.equal(audit[0].organization_id, id);
          assert.equal(audit[0].user_id, admin.id);
          assert.equal(audit[0].entity_id, id);
          assert.ok(audit[0].metadata.changedFields.includes('legalName'));
          assert.ok(!audit[0].metadata.changedFields.includes('id'));
          const events = (
            await fixture.runtime.query(
              'SELECT organization_id,entity_id,operation,payload FROM sync_outbox',
            )
          ).rows;
          assert.equal(events.length, 1);
          assert.equal(events[0].organization_id, id);
          assert.equal(events[0].entity_id, id);
          assert.equal(events[0].operation, 'CREATE');
          assert.equal(events[0].payload.id, id);
          assert.equal(
            (
              await request(
                { ...company, expectedRevision: 1, id: canonicalId },
                admin.token,
                'PUT',
              )
            ).status,
            400,
          );
          assert.equal(
            (await fixture.runtime.query('SELECT revision FROM organizations WHERE id=$1', [id]))
              .rows[0].revision,
            1,
          );
          assert.equal(
            (await fixture.runtime.query('SELECT count(*)::integer count FROM sync_outbox')).rows[0]
              .count,
            1,
          );
        } finally {
          await closeServer?.();
          await fixture.close();
        }
      });
    }
  },
);
