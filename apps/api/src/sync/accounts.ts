import type { Pool, PoolClient } from 'pg';
import { DomainError, transaction } from '../foundation/repository.js';

// Explicit projection: never export sessions, access tokens or login activity.
export async function enqueueAccount(client: PoolClient, userId: string) {
  const found = await client.query(
    `SELECT u.id,u.organization_id,u.username,u.email,u.display_name,u.password_hash,
      u.active,u.revision,u.created_at,u.updated_at
     FROM auth_users u JOIN application_setup s ON s.singleton AND s.organization_id=u.organization_id
     WHERE u.id=$1 FOR UPDATE OF u`,
    [userId],
  );
  const user = found.rows[0];
  if (!user)
    throw new DomainError(
      404,
      'ACCOUNT_NOT_FOUND',
      'Account must belong to this installation organization',
    );
  if (!/^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(user.password_hash))
    throw new DomainError(
      409,
      'ACCOUNT_VERIFIER_INVALID',
      'Account password verifier is unsupported',
    );
  const roles = await client.query<{ code: string }>(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id
     WHERE ur.user_id=$1 AND (r.organization_id IS NULL OR r.organization_id=$2) ORDER BY r.code`,
    [user.id, user.organization_id],
  );
  const payload = {
    id: user.id,
    organizationId: user.organization_id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    passwordHash: user.password_hash,
    active: user.active,
    revision: user.revision,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    roles: roles.rows.map((role) => role.code),
  };
  const encoded = JSON.stringify(payload);
  const existing = await client.query(
    `SELECT id,status,payload=$3::jsonb AS identical FROM sync_outbox
     WHERE entity_type='auth_users' AND entity_id=$1 AND revision=$2`,
    [user.id, user.revision, encoded],
  );
  if (existing.rows[0]) {
    if (!existing.rows[0].identical)
      throw new DomainError(
        409,
        'ACCOUNT_REVISION_CONFLICT',
        'Account changed without a new revision; existing sync event was preserved',
      );
    return { eventId: String(existing.rows[0].id), status: String(existing.rows[0].status) };
  }
  const result = await client.query(
    `INSERT INTO sync_outbox(organization_id,entity_type,entity_id,operation,revision,payload)
     VALUES($1,'auth_users',$2,$3,$4,$5) RETURNING id,status`,
    [
      user.organization_id,
      user.id,
      user.revision === 1 ? 'CREATE' : 'UPDATE',
      user.revision,
      encoded,
    ],
  );
  return { eventId: String(result.rows[0].id), status: String(result.rows[0].status) };
}

export async function queueAccountByUsername(pool: Pool, username: string) {
  return transaction(pool, async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM auth_users WHERE lower(username)=lower($1)',
      [username.trim()],
    );
    if (!result.rows[0]) throw new DomainError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
    return enqueueAccount(client, result.rows[0].id);
  });
}
