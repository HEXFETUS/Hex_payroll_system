import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { syncEventSchema, syncPushResponseSchema } from '@hexpayroll/shared';
import { transaction } from '../foundation/repository.js';
import { tokenHash } from '../auth/service.js';
import {
  TransportError,
  httpPushTransport,
  requestSignal,
  abortable,
  type PushTransport,
  type RequestOptions,
  type SyncClientConfig,
} from './transport.js';
import type { SyncWorkerStatus } from './status.js';

export async function ensureNode(pool: Pool, config: SyncClientConfig) {
  const result = await pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM sync_nodes WHERE id=$1 AND token_hash=$2 AND enabled AND revoked_at IS NULL',
    [config.nodeId, tokenHash(config.token)],
  );
  if (!result.rows[0]) throw new Error('Local installation not enrolled');
  return result.rows[0].organization_id;
}
export interface PushOptions extends RequestOptions {
  batchSize?: number;
  leaseMs?: number;
  maxAttempts?: number;
  random?: () => number;
  transport?: PushTransport;
  status?: SyncWorkerStatus;
}
export function retryDelayMs(attempt: number, random: () => number = Math.random) {
  const ceiling = Math.min(300000, 2000 * 2 ** Math.min(Math.max(0, attempt - 1), 20));
  return Math.floor(ceiling / 2 + (random() * ceiling) / 2);
}
export class StaleLeaseError extends Error {}

export async function pushNextBatch(
  pool: Pool,
  config: SyncClientConfig,
  options: PushOptions = {},
) {
  const org = await ensureNode(pool, config),
    lease = randomUUID();
  const batchSize = options.batchSize ?? 3,
    maxAttempts = options.maxAttempts ?? 10;
  const timeoutMs = options.timeoutMs ?? 10000,
    leaseMs = options.leaseMs ?? 30000;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 3 ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    timeoutMs <= 0 ||
    leaseMs <= timeoutMs
  )
    throw new Error('Invalid synchronization delivery configuration');
  options.signal?.throwIfAborted();
  const rows = await transaction(pool, async (c) => {
    // Claims are serialized, and never skip a failed/deferred/leased predecessor.
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7342))', [org]);
    const result = await c.query(
      `SELECT *, (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) AS due,
         (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS expired
       FROM sync_outbox WHERE organization_id=$1 AND status<>'synced'
       ORDER BY publication_sequence LIMIT $2 FOR UPDATE`,
      [org, batchSize],
    );
    const claimed = [];
    for (const row of result.rows) {
      if (row.status === 'failed' || (row.status === 'processing' ? !row.expired : !row.due)) break;
      if (row.retry_cycle_attempts >= maxAttempts) {
        await c.query(
          "UPDATE sync_outbox SET status='failed',error='Automatic retry limit reached; review and retry required',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL WHERE id=$1",
          [row.id],
        );
        break;
      }
      const updated = await c.query(
        `UPDATE sync_outbox SET status='processing',lease_token=$2,
          lease_expires_at=clock_timestamp()+($3::double precision * interval '1 millisecond'),
          attempt_count=attempt_count+1,retry_cycle_attempts=retry_cycle_attempts+1,last_attempt_at=clock_timestamp(),error=NULL
         WHERE id=$1 RETURNING *`,
        [row.id, lease, leaseMs],
      );
      claimed.push(updated.rows[0]!);
    }
    return claimed;
  });
  if (!rows.length) {
    if (options.status) {
      const head = await pool.query(
        "SELECT status FROM sync_outbox WHERE organization_id=$1 AND status<>'synced' ORDER BY publication_sequence LIMIT 1",
        [org],
      );
      if (head.rows[0]?.status === 'failed') options.status.state = 'blocked';
    }
    return false;
  }
  let transportAttempted = false;
  let transportVerified = false;
  try {
    const events = rows.map((r) => ({
      ...syncEventSchema.parse({
        eventId: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        operation: r.operation,
        revision: r.revision,
        payloadVersion: r.payload_version,
        payload: r.payload,
      }),
      organizationId: r.organization_id,
      originNodeId: r.origin_node_id,
      baseRevision: r.base_revision,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    const signal = requestSignal({ ...options, timeoutMs });
    const transport = options.transport ?? httpPushTransport(config, timeoutMs);
    transportAttempted = true;
    const response = syncPushResponseSchema.parse(
      await abortable(() => transport.push(events, signal), signal),
    );
    if (
      response.receipts.length !== rows.length ||
      new Set(response.receipts.map((r) => r.eventId)).size !== rows.length ||
      response.receipts.some(
        (r) => !rows.some((row) => row.id === r.eventId) || r.sequence === '0',
      ) ||
      new Set(response.receipts.map((r) => r.sequence)).size !== rows.length
    )
      throw new Error('Invalid delivery acknowledgment');
    transportVerified = true;
    options.status?.recordTransport(true);
    await transaction(pool, async (c) => {
      for (const receipt of response.receipts) {
        const result = await c.query(
          "UPDATE sync_outbox SET status='synced',central_sequence=$3,synced_at=now(),lease_token=NULL,lease_expires_at=NULL,next_attempt_at=NULL,error=NULL WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_expires_at>clock_timestamp()",
          [receipt.eventId, lease, receipt.sequence],
        );
        if (result.rowCount !== 1) throw new StaleLeaseError('Delivery lease no longer owned');
      }
    });
  } catch (error) {
    if (transportAttempted && !transportVerified && !options.signal?.aborted)
      options.status?.recordTransport(false);
    const permanent =
      error instanceof TransportError && [400, 401, 403, 409, 413, 422].includes(error.status);
    await transaction(pool, async (c) => {
      for (const row of rows) {
        const failed = permanent || row.retry_cycle_attempts >= maxAttempts;
        const message = permanent
          ? `Transport rejected batch (${error.status}); review and retry required`
          : failed
            ? 'Automatic retry limit reached; review and retry required'
            : 'Transport unavailable or acknowledgment invalid; retry scheduled';
        await c.query(
          `UPDATE sync_outbox SET status=$3,error=$4,lease_token=NULL,lease_expires_at=NULL,
           next_attempt_at=CASE WHEN $3='failed' THEN NULL ELSE now()+($5::double precision * interval '1 millisecond') END
           WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_expires_at>clock_timestamp()`,
          [
            row.id,
            lease,
            failed ? 'failed' : 'pending',
            message,
            retryDelayMs(row.retry_cycle_attempts, options.random),
          ],
        );
        if (failed && options.status) options.status.state = 'blocked';
      }
    });
    throw error;
  }
  return true;
}
