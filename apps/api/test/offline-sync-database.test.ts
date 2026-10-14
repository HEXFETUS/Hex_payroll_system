import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { syncSummarySchema } from '@hexpayroll/shared';
import { databaseFixture, databaseTestsEnabled } from './database-fixture.js';
import { migrate } from '../src/db/migrate.js';
import { transaction, insert, audit, outbox } from '../src/foundation/repository.js';
import { enqueueOutbox } from '../src/sync/outbox.js';
import { importLocalNode } from '../src/sync/import-node.js';
import { pushNextBatch, StaleLeaseError } from '../src/sync/delivery.js';
import { TransportError, type PushTransport } from '../src/sync/transport.js';
import { SyncWorkerStatus } from '../src/sync/status.js';
import { createSyncRouter } from '../src/sync/router.js';
import { createFoundationRouter } from '../src/foundation/router.js';
import { tokenHash } from '../src/auth/service.js';
import { startSyncWorker } from '../src/sync/client.js';

test(
  '0033 backfills a populated queue without changing delivery receipts or history',
  { skip: !databaseTestsEnabled },
  async () => {
    const db = await databaseFixture();
    try {
      await migrate(
        db.migrator,
        db.migrations.filter((migration) => migration.name < '0033'),
      );
      const org = (
        await db.runtime.query(
          "INSERT INTO organizations(legal_name) VALUES('Legacy outbox') RETURNING id",
        )
      ).rows[0].id;
      const node = (
        await db.runtime.query(
          "INSERT INTO sync_nodes(organization_id,device_name,token_hash) VALUES($1,'Existing installation',$2) RETURNING id",
          [org, tokenHash('test-token')],
        )
      ).rows[0].id;
      const late = randomUUID(),
        early = randomUUID();
      await db.runtime.query(
        "INSERT INTO sync_outbox(id,organization_id,entity_type,entity_id,operation,revision,payload,created_at,attempt_count,status,central_sequence,synced_at) VALUES($1,$2,'departments',$3,'UPDATE',2,'{}','2025-02-02T00:00:00Z',2,'synced',7,'2025-02-03T00:00:00Z'),($4,$2,'employees',$5,'CREATE',1,'{}','2025-02-01T00:00:00Z',3,'pending',NULL,NULL)",
        [late, org, randomUUID(), early, randomUUID()],
      );
      await migrate(db.migrator, db.migrations);
      const rows = (
        await db.runtime.query('SELECT * FROM sync_outbox ORDER BY publication_sequence')
      ).rows;
      assert.deepEqual(
        rows.map((row) => row.id),
        [early, late],
      );
      assert.ok(rows.every((row) => row.origin_node_id === node));
      assert.equal(rows[0].retry_cycle_attempts, 3);
      assert.equal(rows[0].base_revision, 0);
      assert.equal(rows[1].base_revision, 1);
      assert.equal(rows[1].status, 'synced');
      assert.equal(String(rows[1].central_sequence), '7');
      assert.equal(new Date(rows[1].synced_at).toISOString(), '2025-02-03T00:00:00.000Z');
    } finally {
      await db.close();
    }
  },
);

test(
  'offline outbox: atomic publication, identities, ordering, leases, retries and status',
  { skip: !databaseTestsEnabled },
  async (t) => {
    const db = await databaseFixture();
    try {
      await migrate(db.migrator, db.migrations);
      const org = (
        await db.runtime.query(
          "INSERT INTO organizations(legal_name) VALUES('Offline sync test') RETURNING id",
        )
      ).rows[0].id as string;
      await db.runtime.query('UPDATE application_setup SET organization_id=$1 WHERE singleton', [
        org,
      ]);
      const actor = { id: null, organizationId: org };
      const queue = () =>
        db.runtime.query('SELECT * FROM sync_outbox ORDER BY publication_sequence');
      const clear = () => db.migrator.query('DELETE FROM sync_outbox');
      const enqueue = async (entityType = 'departments') => {
        const id = randomUUID();
        await transaction(db.runtime, (c) =>
          enqueueOutbox(c, {
            organizationId: org,
            entityType,
            entityId: id,
            operation: 'CREATE',
            revision: 1,
            payload: { id },
          }),
        );
        return (await queue()).rows.at(-1)!;
      };
      let originalOrigin: string;
      await t.test(
        'offline creates publish audit and outbox atomically with UUIDv7 origin',
        async () => {
          await transaction(db.runtime, async (c) => {
            const row = await insert(c, 'departments', {
              organizationId: org,
              code: 'OFFLINE',
              name: 'Offline',
            });
            await audit(c, actor, 'CREATE', 'departments', row.id);
            await outbox(c, 'departments', row, 'CREATE');
          });
          const row = (await queue()).rows[0]!;
          assert.equal(row.id[14], '7');
          assert.equal(row.origin_node_id[14], '7');
          originalOrigin = row.origin_node_id;
          assert.equal(row.base_revision, 0);
          assert.equal(row.retry_cycle_attempts, 0);
          const audits = (await db.runtime.query('SELECT count(*)::int count FROM audit_events'))
            .rows[0].count;
          await assert.rejects(
            transaction(db.runtime, async (c) => {
              const saved = await insert(c, 'departments', {
                organizationId: org,
                code: 'ROLLBACK',
                name: 'Rollback',
              });
              await audit(c, actor, 'CREATE', 'departments', saved.id);
              await outbox(c, 'departments', saved, 'CREATE');
              throw new Error('Rollback requested');
            }),
            /Rollback requested/,
          );
          assert.equal((await queue()).rowCount, 1);
          assert.equal(
            (await db.runtime.query("SELECT id FROM departments WHERE code='ROLLBACK'")).rowCount,
            0,
          );
          assert.equal(
            (await db.runtime.query('SELECT count(*)::int count FROM audit_events')).rows[0].count,
            audits,
          );
        },
      );
      const credential = {
        nodeId: randomUUID(),
        organizationId: org,
        deviceName: 'Enrolled test node',
        token: randomBytes(32).toString('base64url'),
      };
      await t.test(
        'enrollment preserves queued origins and gives future events the enrolled origin',
        async () => {
          await importLocalNode(db.runtime, credential);
          assert.equal((await queue()).rows[0].origin_node_id, originalOrigin!);
          const row = await enqueue();
          assert.equal(row.origin_node_id, credential.nodeId);
          await transaction(db.runtime, (c) =>
            enqueueOutbox(c, {
              organizationId: org,
              entityType: 'departments',
              entityId: row.entity_id,
              operation: 'UPDATE',
              revision: 2,
              baseRevision: 1,
              payload: { id: row.entity_id },
            }),
          );
          assert.equal((await queue()).rows.at(-1)!.base_revision, 1);
          await assert.rejects(
            db.runtime.query(
              "INSERT INTO sync_outbox(organization_id,entity_type,entity_id,operation,revision,base_revision,payload) VALUES($1,'departments',$2,'UPDATE',2,2,'{}')",
              [org, randomUUID()],
            ),
          );
        },
      );
      const config = {
        url: 'http://127.0.0.1:1',
        nodeId: credential.nodeId,
        token: credential.token,
      };
      let sequence = 1;
      const success: PushTransport = {
        push: async (events) => ({
          receipts: events.map((e) => ({ eventId: e.eventId, sequence: String(sequence++) })),
        }),
      };
      await clear();
      await t.test(
        'publication lock prevents a later transaction from committing ahead of a predecessor',
        async () => {
          const a = await db.runtime.connect(),
            b = await db.runtime.connect();
          try {
            await a.query('BEGIN');
            await b.query('BEGIN');
            const first = randomUUID(),
              second = randomUUID();
            await enqueueOutbox(a, {
              organizationId: org,
              entityType: 'employees',
              entityId: first,
              operation: 'CREATE',
              revision: 1,
              payload: {},
            });
            let completed = false;
            const later = enqueueOutbox(b, {
              organizationId: org,
              entityType: 'employee_schedule_assignments',
              entityId: second,
              operation: 'CREATE',
              revision: 1,
              payload: { employeeId: first },
            }).then(async () => {
              await b.query('COMMIT');
              completed = true;
            });
            await delay(30);
            assert.equal(completed, false);
            assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), false);
            await a.query('COMMIT');
            await later;
            assert.deepEqual(
              (await queue()).rows.map((r) => r.entity_id),
              [first, second],
            );
          } finally {
            await a.query('ROLLBACK');
            await b.query('ROLLBACK');
            a.release();
            b.release();
          }
        },
      );
      await clear();
      await t.test(
        'duplicate workers never overtake a processing parent or reorder its child',
        async () => {
          const parent = await enqueue('employees'),
            child = await enqueue('employee_schedule_assignments');
          let entered = () => {},
            release = () => {};
          const ready = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          const seen: string[] = [];
          const first = pushNextBatch(db.runtime, config, {
            batchSize: 1,
            transport: {
              push: async (events) => {
                seen.push(events[0]!.eventId);
                entered();
                await gate;
                return success.push(events, new AbortController().signal);
              },
            },
          });
          await ready;
          try {
            assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), false);
          } finally {
            release();
          }
          await first;
          await pushNextBatch(db.runtime, config, {
            transport: {
              push: async (events, signal) => {
                seen.push(events[0]!.eventId);
                return success.push(events, signal);
              },
            },
          });
          assert.deepEqual(seen, [parent.id, child.id]);
        },
      );
      await clear();
      await t.test(
        'timeout retries stable IDs, backs off, exhausts a cycle, and blocks children',
        async () => {
          const parent = await enqueue('employees');
          await enqueue('employee_schedule_assignments');
          const unavailable: PushTransport = {
            push: async () => {
              throw new Error('Network unavailable');
            },
          };
          await assert.rejects(
            pushNextBatch(db.runtime, config, {
              batchSize: 1,
              timeoutMs: 10,
              maxAttempts: 2,
              transport: { push: () => new Promise(() => {}) },
              random: () => 0,
            }),
          );
          let row = (await queue()).rows[0]!;
          assert.equal(row.status, 'pending');
          assert.equal(row.attempt_count, 1);
          assert.ok(
            new Date(row.next_attempt_at).getTime() - new Date(row.last_attempt_at).getTime() >=
              1000,
          );
          assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), false);
          await db.runtime.query('UPDATE sync_outbox SET next_attempt_at=NULL WHERE id=$1', [
            parent.id,
          ]);
          await assert.rejects(
            pushNextBatch(db.runtime, config, {
              batchSize: 1,
              maxAttempts: 2,
              transport: unavailable,
            }),
          );
          row = (await queue()).rows[0]!;
          assert.equal(row.status, 'failed');
          assert.equal(row.attempt_count, 2);
          assert.equal((await queue()).rows[1].attempt_count, 0);
          assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), false);
        },
      );
      await clear();
      await t.test(
        'missing, duplicate, unknown and zero receipts cannot acknowledge any batch member',
        async () => {
          await enqueue();
          await enqueue();
          const responses: ((ids: string[]) => unknown)[] = [
            () => ({ receipts: [] }),
            (ids) => ({ receipts: [{ eventId: ids[0], sequence: '1' }] }),
            (ids) => ({
              receipts: [
                { eventId: ids[0], sequence: '1' },
                { eventId: ids[0], sequence: '2' },
              ],
            }),
            (ids) => ({
              receipts: [
                { eventId: ids[0], sequence: '1' },
                { eventId: randomUUID(), sequence: '2' },
              ],
            }),
            (ids) => ({
              receipts: [
                { eventId: ids[0], sequence: '0' },
                { eventId: ids[1], sequence: '2' },
              ],
            }),
            (ids) => ({
              receipts: [
                { eventId: ids[0], sequence: '1' },
                { eventId: ids[1], sequence: '1' },
              ],
            }),
          ];
          for (const response of responses) {
            await assert.rejects(
              pushNextBatch(db.runtime, config, {
                transport: { push: async (events) => response(events.map((e) => e.eventId)) },
              }),
            );
            assert.ok(
              (await queue()).rows.every((r) => r.status === 'pending' && r.synced_at === null),
            );
            await db.runtime.query('UPDATE sync_outbox SET next_attempt_at=NULL');
          }
          assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), true);
          assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), false);
        },
      );
      await clear();
      await t.test(
        'crash leases recover; late acknowledgments cannot overwrite a newer claim',
        async () => {
          const row = await enqueue();
          await db.runtime.query(
            "UPDATE sync_outbox SET status='processing',lease_token=$2,lease_expires_at=now()-interval '1 second' WHERE id=$1",
            [row.id, randomUUID()],
          );
          assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), true);
          await clear();
          await enqueue();
          await enqueue();
          await assert.rejects(
            pushNextBatch(db.runtime, config, {
              transport: {
                push: async (events) => {
                  await db.runtime.query(
                    "UPDATE sync_outbox SET lease_token=$1,lease_expires_at=now()+interval '30 seconds' WHERE id=$2",
                    [randomUUID(), events.at(-1)!.eventId],
                  );
                  return success.push(events, new AbortController().signal);
                },
              },
            }),
            StaleLeaseError,
          );
          const afterStale = (await queue()).rows;
          assert.deepEqual(
            afterStale.map((event) => event.status),
            ['pending', 'processing'],
          );
          assert.ok(afterStale.every((event) => event.central_sequence === null));
          await db.runtime.query(
            "UPDATE sync_outbox SET lease_expires_at=now()-interval '1 second',next_attempt_at=NULL",
          );
          assert.equal(await pushNextBatch(db.runtime, config, { transport: success }), true);
        },
      );
      await clear();
      await t.test(
        'startup adopts the configured local node without rewriting queued origins',
        async () => {
          await db.runtime.query(
            'UPDATE sync_local_identity SET node_id=$2 WHERE organization_id=$1',
            [org, originalOrigin!],
          );
          const historical = await enqueue();
          assert.equal(historical.origin_node_id, originalOrigin!);
          let entered = () => {};
          const ready = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const stop = startSyncWorker(db.runtime, config, 15000, () => {}, {
            transport: {
              push: () => {
                entered();
                return new Promise(() => {});
              },
            },
            status: new SyncWorkerStatus(),
          });
          try {
            await ready;
            const future = await enqueue();
            assert.equal(future.origin_node_id, credential.nodeId);
            assert.equal((await queue()).rows[0].origin_node_id, originalOrigin!);
          } finally {
            await stop();
          }
        },
      );
      await clear();
      await t.test(
        'shutdown releases an owned claim and a fresh worker can redeliver',
        async () => {
          const row = await enqueue();
          const controller = new AbortController();
          let entered = () => {};
          const ready = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const active = pushNextBatch(db.runtime, config, {
            signal: controller.signal,
            transport: {
              push: () => {
                entered();
                return new Promise(() => {});
              },
            },
          });
          await ready;
          const rejection = assert.rejects(active, /Shutdown/);
          controller.abort(new Error('Shutdown'));
          await rejection;
          const released = (await queue()).rows[0];
          assert.equal(released.status, 'pending');
          assert.equal(released.lease_token, null);
          assert.equal(released.attempt_count, 1);
          await db.runtime.query('UPDATE sync_outbox SET next_attempt_at=NULL WHERE id=$1', [
            row.id,
          ]);
          await pushNextBatch(db.runtime, config, { transport: success });
          assert.equal((await queue()).rows[0].status, 'synced');
        },
      );
      await clear();
      await t.test(
        'an expired lease at its retry limit fails without sending a child',
        async () => {
          const row = await enqueue('employees');
          await enqueue('employee_schedule_assignments');
          await db.runtime.query(
            "UPDATE sync_outbox SET status='processing',lease_token=$2,lease_expires_at=now()-interval '1 second',retry_cycle_attempts=10,attempt_count=10 WHERE id=$1",
            [row.id, randomUUID()],
          );
          let calls = 0;
          assert.equal(
            await pushNextBatch(db.runtime, config, {
              transport: {
                push: async () => {
                  calls++;
                  return {};
                },
              },
            }),
            false,
          );
          assert.equal(calls, 0);
          assert.equal((await queue()).rows[0].status, 'failed');
          assert.equal((await queue()).rows[1].attempt_count, 0);
        },
      );
      await clear();
      await t.test(
        'permanent rejection, authenticated retry and tenant-scoped status',
        async () => {
          await enqueue();
          await assert.rejects(
            pushNextBatch(db.runtime, config, {
              transport: {
                push: async () => {
                  throw new TransportError(422);
                },
              },
            }),
          );
          assert.equal((await queue()).rows[0].status, 'failed');
          const admin = (
            await db.runtime.query(
              "INSERT INTO auth_users(organization_id,username,display_name,password_hash) VALUES($1,'offline-admin','Admin','test-only') RETURNING id",
              [org],
            )
          ).rows[0].id;
          await db.runtime.query(
            "INSERT INTO user_roles SELECT $1,id FROM roles WHERE code='administrator'",
            [admin],
          );
          const token = randomBytes(32).toString('base64url');
          await db.runtime.query(
            "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
            [tokenHash(token), admin],
          );
          const status = new SyncWorkerStatus();
          status.organizationId = org;
          status.state = 'blocked';
          const app = express();
          app.use(express.json());
          app.use('/api', createSyncRouter(db.runtime, false));
          app.use(
            '/api',
            createFoundationRouter(db.runtime, {
              mode: 'local',
              nodeId: credential.nodeId,
              status,
            }),
          );
          const server = app.listen(0, '127.0.0.1');
          await once(server, 'listening');
          try {
            const address = server.address();
            assert.ok(address && typeof address !== 'string');
            const base = `http://127.0.0.1:${address.port}/api/sync/`;
            const headers = { Authorization: `Bearer ${token}` };
            assert.equal((await fetch(base + 'summary')).status, 401);
            let summary = syncSummarySchema.parse(
              await (await fetch(base + 'summary', { headers })).json(),
            );
            assert.equal(summary.failed, 1);
            assert.equal(summary.transportAvailability, 'unknown');
            assert.equal(
              (await fetch(base + 'outbox/retry', { method: 'POST', headers })).status,
              200,
            );
            const row = (await queue()).rows[0];
            assert.equal(row.attempt_count, 1);
            assert.equal(row.retry_cycle_attempts, 0);
            await pushNextBatch(db.runtime, config, { transport: success, status });
            summary = syncSummarySchema.parse(
              await (await fetch(base + 'summary', { headers })).json(),
            );
            assert.equal(summary.synced, 1);
            assert.ok(summary.lastSuccessfulPush);
            assert.equal(summary.transportAvailability, 'available');
            const otherOrg = (
              await db.runtime.query(
                "INSERT INTO organizations(legal_name) VALUES('Other org') RETURNING id",
              )
            ).rows[0].id;
            await db.runtime.query('UPDATE auth_users SET organization_id=$1 WHERE id=$2', [
              otherOrg,
              admin,
            ]);
            summary = syncSummarySchema.parse(
              await (await fetch(base + 'summary', { headers })).json(),
            );
            assert.equal(summary.synced, 0);
            assert.equal(summary.lastSuccessfulPush, null);
            assert.equal(summary.lastTransportVerification, null);
          } finally {
            await new Promise<void>((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections();
            });
          }
        },
      );
    } finally {
      await db.close();
    }
  },
);
