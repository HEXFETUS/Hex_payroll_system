import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { syncPushSchema, type SyncEvent } from '@hexpayroll/shared';
import { tokenHash } from '../auth/service.js';
import { DomainError, transaction } from '../foundation/repository.js';

export interface SyncNode {
  id: string;
  organization_id: string;
}
export async function authenticateNode(c: Pool | PoolClient, token: string): Promise<SyncNode> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new DomainError(401, 'NODE_INVALID', 'Installation credential invalid');
  const result = await c.query<SyncNode>(
    'SELECT id,organization_id FROM sync_nodes WHERE token_hash=$1 AND enabled AND revoked_at IS NULL',
    [tokenHash(token)],
  );
  if (!result.rows[0])
    throw new DomainError(401, 'NODE_INVALID', 'Installation credential invalid');
  return result.rows[0];
}
async function lockedNode(c: PoolClient, token: string) {
  const node = await authenticateNode(c, token);
  const r = await c.query(
    'SELECT id FROM sync_nodes WHERE id=$1 AND enabled AND revoked_at IS NULL FOR UPDATE',
    [node.id],
  );
  if (!r.rowCount) throw new DomainError(401, 'NODE_INVALID', 'Installation credential invalid');
  await c.query('UPDATE sync_nodes SET last_seen_at=now() WHERE id=$1', [node.id]);
  return node;
}
export async function registerNode(
  pool: Pool | PoolClient,
  organizationId: string,
  deviceName: string,
) {
  const token = randomBytes(32).toString('base64url');
  const result = await pool.query<{ id: string }>(
    'INSERT INTO sync_nodes(organization_id,device_name,token_hash) VALUES($1,$2,$3) RETURNING id',
    [organizationId, deviceName, tokenHash(token)],
  );
  return { nodeId: result.rows[0]!.id, organizationId, token };
}
class IdentityConflict extends Error {
  constructor(
    public node: SyncNode,
    public event: SyncEvent,
    public current: Record<string, unknown>,
  ) {
    super('Event identity reused');
  }
}
export async function pushEvents(pool: Pool, token: string, input: unknown) {
  const { events } = syncPushSchema.parse(input);
  try {
    return await transaction(pool, async (c) => {
      const node = await lockedNode(c, token);
      const receipts: { eventId: string; sequence: string }[] = [];
      for (const e of events) {
        const existing = await c.query(
          `SELECT *,payload=$3::jsonb AS payload_equal FROM sync_changes WHERE source_node_id=$1 AND source_event_id=$2`,
          [node.id, e.eventId, JSON.stringify(e.payload)],
        );
        const old = existing.rows[0];
        if (old) {
          if (
            !old.payload_equal ||
            old.entity_type !== e.entityType ||
            old.entity_id !== e.entityId ||
            old.operation !== e.operation ||
            old.revision !== e.revision ||
            old.payload_version !== e.payloadVersion
          )
            throw new IdentityConflict(node, e, old);
          receipts.push({ eventId: e.eventId, sequence: String(old.sequence) });
          continue;
        }
        const r = await c.query(
          `INSERT INTO sync_changes(organization_id,source_node_id,source_event_id,entity_type,entity_id,operation,revision,payload_version,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING sequence::text`,
          [
            node.organization_id,
            node.id,
            e.eventId,
            e.entityType,
            e.entityId,
            e.operation,
            e.revision,
            e.payloadVersion,
            JSON.stringify(e.payload),
          ],
        );
        receipts.push({ eventId: e.eventId, sequence: r.rows[0]!.sequence });
      }
      return { receipts };
    });
  } catch (error) {
    if (!(error instanceof IdentityConflict)) throw error;
    await transaction(pool, async (c) => {
      const node = await lockedNode(c, token);
      const e = error.event;
      await c.query(
        `INSERT INTO sync_conflicts(organization_id,node_id,source_event_id,entity_type,entity_id,incoming_revision,current_revision,incoming_payload,current_payload,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Event ID reused with different contents') ON CONFLICT(node_id,source_event_id) DO NOTHING`,
        [
          node.organization_id,
          node.id,
          e.eventId,
          e.entityType,
          e.entityId,
          e.revision,
          error.current.revision,
          JSON.stringify(e.payload),
          JSON.stringify(error.current.payload),
        ],
      );
    });
    throw new DomainError(
      409,
      'SYNC_EVENT_CONFLICT',
      'Event ID already accepted with different contents',
    );
  }
}
export async function pullChanges(pool: Pool, token: string, after: string) {
  return transaction(pool, async (c) => {
    const node = await lockedNode(c, token);
    const result = await c.query(
      `SELECT sequence::text,"id" AS "changeId",organization_id AS "organizationId",source_node_id AS "sourceNodeId",source_event_id AS "eventId",entity_type AS "entityType",entity_id AS "entityId",operation,revision,payload_version AS "payloadVersion",payload FROM sync_changes WHERE organization_id=$1 AND sequence>$2 ORDER BY sync_changes.sequence LIMIT 3`,
      [node.organization_id, after],
    );
    // Include the originating node's events so one cursor traverses the whole stream.
    return { changes: result.rows, nextSequence: result.rows.at(-1)?.sequence ?? after };
  });
}
