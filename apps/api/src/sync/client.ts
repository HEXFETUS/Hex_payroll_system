import type { Pool } from 'pg';
import { syncPullResponseSchema } from '@hexpayroll/shared';
import { transaction } from '../foundation/repository.js';
import { applyInboxBatch } from './inbox.js';
import { ensureNode, pushNextBatch, type PushOptions } from './delivery.js';
import { syncRequest, type SyncClientConfig, type RequestOptions } from './transport.js';
import { syncWorkerStatus, type SyncWorkerStatus } from './status.js';
import { startWorker } from './worker.js';
import { selectLocalOrigin } from './outbox.js';
export { pushNextBatch } from './delivery.js';
export { TransportError, syncRequest, type SyncClientConfig } from './transport.js';

export async function pullNextBatch(
  pool: Pool,
  config: SyncClientConfig,
  options: RequestOptions & { status?: SyncWorkerStatus } = {},
) {
  const org = await ensureNode(pool, config);
  const r = await pool.query('SELECT last_pull_sequence::text FROM sync_nodes WHERE id=$1', [
    config.nodeId,
  ]);
  const after: string = r.rows[0]!.last_pull_sequence;
  const response = await (async () => {
    try {
      const response = syncPullResponseSchema.parse(
        await syncRequest(config, 'pull?after=' + after, undefined, options),
      );
      let previous = BigInt(after);
      for (const change of response.changes) {
        if (change.organizationId !== org || BigInt(change.sequence) <= previous)
          throw new Error('Invalid change stream');
        previous = BigInt(change.sequence);
      }
      if (BigInt(response.nextSequence) !== previous) throw new Error('Invalid pull cursor');
      options.status?.recordTransport(true);
      return response;
    } catch (error) {
      if (!options.signal?.aborted) options.status?.recordTransport(false);
      throw error;
    }
  })();
  await transaction(pool, async (c) => {
    const node = await c.query(
      'SELECT last_pull_sequence::text FROM sync_nodes WHERE id=$1 AND enabled FOR UPDATE',
      [config.nodeId],
    );
    if (node.rows[0]?.last_pull_sequence !== after) return; // Another worker already progressed.
    for (const e of response.changes)
      await c.query(
        `INSERT INTO sync_inbox(organization_id,sequence,change_id,source_node_id,source_event_id,entity_type,entity_id,operation,revision,payload_version,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          org,
          e.sequence,
          e.changeId,
          e.sourceNodeId,
          e.eventId,
          e.entityType,
          e.entityId,
          e.operation,
          e.revision,
          e.payloadVersion,
          JSON.stringify(e.payload),
        ],
      );
    await c.query('UPDATE sync_nodes SET last_pull_sequence=$2,last_seen_at=now() WHERE id=$1', [
      config.nodeId,
      response.nextSequence,
    ]);
  });
  return response.changes.length > 0;
}

export function startSyncWorker(
  pool: Pool,
  config: SyncClientConfig,
  interval: number,
  onError: () => void,
  options: PushOptions = {},
) {
  const status = options.status ?? syncWorkerStatus;
  let identityEstablished = false;
  return startWorker(
    {
      prepare: async () => {
        status.organizationId = await ensureNode(pool, config);
        if (!identityEstablished) {
          await transaction(pool, (client) =>
            selectLocalOrigin(client, status.organizationId!, config.nodeId),
          );
          identityEstablished = true;
        }
      },
      push: (signal) => pushNextBatch(pool, config, { ...options, signal, status }),
      pull: (signal) => pullNextBatch(pool, config, { ...options, signal, status }),
      apply: async () => {
        const result = await applyInboxBatch(pool, status.organizationId!);
        if (result.pending) onError();
      },
    },
    { interval, status, onError },
  );
}
