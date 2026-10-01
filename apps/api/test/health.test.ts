import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { parseHealthResponse } from '@hexpayroll/shared';
import { createHealthRouter } from '../src/routes/health.js';

test('health contract validates readiness, failures, timestamps and HTTP status', () => {
  const timestamp = new Date().toISOString();
  assert.equal(
    parseHealthResponse(200, { status: 'ok', database: 'reachable', timestamp }).status,
    'ok',
  );
  assert.equal(
    parseHealthResponse(503, { status: 'error', database: 'unreachable', timestamp }).status,
    'error',
  );
  for (const [status, body] of [
    [200, { status: 'ok', database: 'unreachable', timestamp }],
    [200, { status: 'ok', database: 'reachable', timestamp: 'bad' }],
    [503, { status: 'ok', database: 'reachable', timestamp }],
    [500, { status: 'error', database: 'unreachable', timestamp }],
    [
      503,
      { status: 'error', database: 'unreachable', timestamp, error: 'private connection string' },
    ],
    [200, null],
  ] as const)
    assert.throws(() => parseHealthResponse(status, body));
});

test('health endpoint preserves readiness semantics and never exposes probe errors', async () => {
  let down = false;
  const app = express();
  app.use(
    '/api',
    createHealthRouter(async () => {
      if (down) throw new Error('postgresql://private:secret@host/db');
      return { version: 'PostgreSQL 18', database: 'private_database', user: 'private_role' };
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  try {
    const url = `http://127.0.0.1:${address.port}/api/health`;
    let response = await fetch(url);
    assert.equal(response.status, 200);
    const ready: unknown = await response.json();
    assert.equal(parseHealthResponse(response.status, ready).status, 'ok');
    assert(!JSON.stringify(ready).includes('private'));
    down = true;
    response = await fetch(url);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const failed: unknown = await response.json();
    assert.equal(parseHealthResponse(response.status, failed).status, 'error');
    assert(!JSON.stringify(failed).includes('secret'));
    assert(!JSON.stringify(failed).includes('postgresql://'));
    down = false;
    response = await fetch(url);
    assert.equal(response.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
