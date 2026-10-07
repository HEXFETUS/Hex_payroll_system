import type { Pool } from 'pg';
import { z } from 'zod';
import { nodeCredentialSchema } from './administration.js';
import { transaction } from '../foundation/repository.js';
import { tokenHash } from '../auth/service.js';

export const centralEndpointSchema = z
  .string()
  .refine((value) => !/\s/.test(value), 'URL whitespace is not allowed')
  .pipe(z.url())
  .refine((value) => {
    const u = new URL(value);
    return (
      !/\s/.test(value) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    );
  }, 'Use HTTPS or development loopback HTTP without URL credentials');

export async function importLocalNode(database: Pool, input: unknown) {
  const credential = nodeCredentialSchema.parse(input);
  await transaction(database, async (client) => {
    const setup = await client.query(
      'SELECT organization_id FROM application_setup WHERE singleton FOR UPDATE',
    );
    if (setup.rows[0]?.organization_id !== credential.organizationId)
      throw new Error('Credential organization does not match local setup');
    const existing = await client.query(
      'SELECT id,token_hash,enabled,revoked_at FROM sync_nodes WHERE organization_id=$1',
      [credential.organizationId],
    );
    const same = existing.rows.find((row) => row.id === credential.nodeId);
    if (
      same &&
      (same.token_hash !== tokenHash(credential.token) || !same.enabled || same.revoked_at)
    )
      throw new Error('Existing node identity differs or was revoked');
    if (existing.rows.some((row) => row.id !== credential.nodeId && row.enabled && !row.revoked_at))
      throw new Error('Local installation already has an active node');
    if (!same)
      await client.query(
        'INSERT INTO sync_nodes(id,organization_id,device_name,token_hash) VALUES($1,$2,$3,$4)',
        [
          credential.nodeId,
          credential.organizationId,
          credential.deviceName,
          tokenHash(credential.token),
        ],
      );
  });
  return credential;
}

export function importedNodeEnvironment(original: string, input: unknown, endpoint: string) {
  const credential = nodeCredentialSchema.parse(input);
  const url = centralEndpointSchema.parse(endpoint);
  const keys =
    /^\s*(?:export\s+)?(SYNC_MODE|SYNC_CENTRAL_URL|SYNC_NODE_ID|SYNC_NODE_TOKEN|SYNC_ADMIN_TOKEN|SYNC_DEVICE_NAME)\s*=/;
  const lines = original.split(/\r?\n/).filter((line) => !keys.test(line));
  return [
    ...lines,
    'SYNC_MODE=disabled',
    `SYNC_CENTRAL_URL=${url}`,
    `SYNC_NODE_ID=${credential.nodeId}`,
    `SYNC_NODE_TOKEN=${credential.token}`,
    '',
  ].join('\n');
}
