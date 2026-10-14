import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from '../foundation/repository.js';

const accountSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    username: z.string().regex(/^[A-Za-z0-9._-]{3,64}$/),
    email: z.email().max(254).nullable(),
    displayName: z
      .string()
      .max(128)
      .refine((value) => value.trim().length > 0),
    passwordHash: z.string().regex(/^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/),
    active: z.boolean(),
    revision: z.number().int().positive().max(2147483647),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    roles: z
      .array(z.string().min(1).max(100))
      .max(100)
      .refine((values) => new Set(values).size === values.length),
  })
  .strict();

interface InboxEvent {
  organization_id: string;
  sequence: string;
  entity_id: string;
  operation: string;
  revision: number;
  payload_version: number;
  payload: unknown;
}
class ApplicationRejected extends Error {}
const reject = (message: string): never => {
  throw new ApplicationRejected(message);
};

export async function applyAccountEvent(client: PoolClient, event: InboxEvent) {
  const parsed = accountSchema.safeParse(event.payload);
  if (!parsed.success || event.payload_version !== 1) reject('Invalid account snapshot or version');
  const user = parsed.data!;
  if (
    user.id !== event.entity_id ||
    user.organizationId !== event.organization_id ||
    user.revision !== event.revision
  )
    reject('Account snapshot identity mismatch');
  if (
    !['CREATE', 'UPDATE', 'ARCHIVE'].includes(event.operation) ||
    (event.operation === 'ARCHIVE' && user.active)
  )
    reject('Invalid account operation');
  // Serialize all receivers for this identity, including the first insert.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'auth_users:' + user.id,
  ]);
  const found = await client.query('SELECT * FROM auth_users WHERE id=$1 FOR UPDATE', [user.id]);
  const current = found.rows[0];
  if (current && current.organization_id !== user.organizationId)
    reject('Account belongs to another organization');
  if (current && current.revision > user.revision) return;
  const roles = await client.query<{ id: string; code: string }>(
    'SELECT id,code FROM roles WHERE code=ANY($1::text[]) AND (organization_id IS NULL OR organization_id=$2) FOR SHARE',
    [user.roles, user.organizationId],
  );
  if (roles.rows.length !== user.roles.length) reject('Account role is unavailable locally');
  if (current && current.revision === user.revision) {
    const assigned = await client.query<{ code: string }>(
      'SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 ORDER BY r.code',
      [user.id],
    );
    if (
      current.username !== user.username ||
      current.email !== user.email ||
      current.display_name !== user.displayName ||
      current.password_hash !== user.passwordHash ||
      current.active !== user.active ||
      new Date(current.created_at).getTime() !== Date.parse(user.createdAt) ||
      new Date(current.updated_at).getTime() !== Date.parse(user.updatedAt) ||
      JSON.stringify(assigned.rows.map((role) => role.code).sort()) !==
        JSON.stringify([...user.roles].sort())
    )
      reject('Account revision conflict; local account preserved');
    return;
  }
  await client.query(
    `INSERT INTO auth_users(id,organization_id,username,email,display_name,password_hash,active,revision,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,email=EXCLUDED.email,
     display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,active=EXCLUDED.active,
     revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at`,
    [
      user.id,
      user.organizationId,
      user.username,
      user.email,
      user.displayName,
      user.passwordHash,
      user.active,
      user.revision,
      user.createdAt,
      user.updatedAt,
    ],
  );
  await client.query('DELETE FROM user_roles WHERE user_id=$1', [user.id]);
  for (const role of roles.rows)
    await client.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user.id, role.id]);
  if (current) await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [user.id]);
}

export async function applyInboxBatch(pool: Pool, organizationId: string) {
  return transaction(pool, async (client) => {
    const setup = await client.query(
      'SELECT organization_id FROM application_setup WHERE singleton',
    );
    if (setup.rows[0]?.organization_id !== organizationId)
      throw new Error('Inbox organization does not match installation');
    // Unsupported entities remain pending. Serialize batches to preserve revision order.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'sync_inbox:' + organizationId,
    ]);
    const batch = await client.query<InboxEvent>(
      `SELECT * FROM sync_inbox WHERE organization_id=$1 AND applied_at IS NULL
       AND entity_type='auth_users' ORDER BY sequence LIMIT 3 FOR UPDATE`,
      [organizationId],
    );
    let applied = 0;
    for (const event of batch.rows) {
      await client.query('SAVEPOINT apply_event');
      let error: string | null = null;
      try {
        await applyAccountEvent(client, event);
        await client.query(
          'UPDATE sync_inbox SET applied_at=now(),apply_error=NULL WHERE organization_id=$1 AND sequence=$2',
          [organizationId, event.sequence],
        );
        applied++;
      } catch (cause) {
        await client.query('ROLLBACK TO SAVEPOINT apply_event');
        error =
          cause instanceof ApplicationRejected
            ? cause.message
            : 'Account application failed; review local constraints and retry';
      }
      await client.query('RELEASE SAVEPOINT apply_event');
      await client.query(
        'UPDATE sync_inbox SET apply_attempt_count=apply_attempt_count+1,last_apply_attempt_at=now(),apply_error=$3 WHERE organization_id=$1 AND sequence=$2',
        [organizationId, event.sequence, error],
      );
      // Preserve order after failure; do not let a later snapshot hide a conflict.
      if (error) break;
    }
    return { applied, pending: batch.rows.length - applied };
  });
}
