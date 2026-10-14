import type { PoolClient } from 'pg';

/** Changes future publication only; event origins already stored are retained. */
export async function selectLocalOrigin(
  client: PoolClient,
  organizationId: string,
  nodeId: string,
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7341))', [organizationId]);
  await client.query(
    'INSERT INTO sync_local_identity(organization_id,node_id) VALUES($1,$2) ON CONFLICT(organization_id) DO UPDATE SET node_id=EXCLUDED.node_id',
    [organizationId, nodeId],
  );
}

/** Caller must use the business mutation's transaction client. SQL assigns the
 * stable origin and commit-ordered publication sequence even before enrollment. */
export async function enqueueOutbox(
  client: PoolClient,
  event: {
    organizationId: string;
    entityType: string;
    entityId: string;
    operation: string;
    revision: number;
    baseRevision?: number;
    payload: unknown;
  },
) {
  await client.query(
    `INSERT INTO sync_outbox(organization_id,entity_type,entity_id,operation,revision,base_revision,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      event.organizationId,
      event.entityType,
      event.entityId,
      event.operation,
      event.revision,
      event.baseRevision ?? (event.operation === 'CREATE' ? 0 : event.revision - 1),
      JSON.stringify(event.payload),
    ],
  );
}
