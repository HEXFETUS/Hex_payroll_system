import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Pool } from 'pg';
import { tokenHash } from '../src/auth/service.js';
import { pushNextBatch } from '../src/sync/delivery.js';

/** Leave an actual business event queued after a real unreachable HTTP request.
 * The rest of each domain workflow must remain usable with this backlog. */
export async function disconnectTransport(pool: Pool, organizationId: string) {
  const nodeId = randomUUID(),
    token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sync_nodes(id,organization_id,device_name,token_hash) VALUES($1,$2,$3,$4)',
    [nodeId, organizationId, 'Offline workflow test', tokenHash(token)],
  );
  // Use a valid HTTP port known to be unavailable, not a forbidden fetch port.
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  await assert.rejects(
    pushNextBatch(
      pool,
      { url: `http://127.0.0.1:${address.port}`, nodeId, token },
      { batchSize: 1, timeoutMs: 100 },
    ),
  );
  const queued = await pool.query(
    'SELECT status,attempt_count FROM sync_outbox WHERE organization_id=$1 ORDER BY publication_sequence LIMIT 1',
    [organizationId],
  );
  assert.equal(queued.rows[0].status, 'pending');
  assert.equal(queued.rows[0].attempt_count, 1);
}
