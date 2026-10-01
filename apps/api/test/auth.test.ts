import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import {
  createUserSchema,
  loginRequestSchema,
  loginResponseSchema,
  authErrorSchema,
  newPasswordSchema,
} from '@hexpayroll/shared';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from '../src/auth/password.js';
import { createLoginLimiter } from '../src/auth/rate-limit.js';
import { migrationChecksum } from '../src/db/migrate.js';
import { createAuthRouter } from '../src/routes/auth.js';
import type { AuthService } from '../src/auth/service.js';

test('contracts preserve passwords and normalize only identifiers', () => {
  const password = ' 😃'.repeat(8);
  assert.equal(newPasswordSchema.parse(password), password);
  assert.equal(newPasswordSchema.safeParse('😃'.repeat(14)).success, false);
  assert.equal(newPasswordSchema.safeParse('😃'.repeat(128)).success, true);
  assert.equal(newPasswordSchema.safeParse('😃'.repeat(129)).success, false);
  assert.equal(loginRequestSchema.parse({ identifier: ' Clerk ', password }).identifier, 'Clerk');
  assert.equal(loginRequestSchema.parse({ identifier: ' Clerk ', password }).password, password);
  assert.equal(
    createUserSchema.safeParse({ username: 'name@foo', displayName: 'Clerk', password }).success,
    false,
  );
  assert.equal(
    createUserSchema.safeParse({ username: 'clerk', email: 'bad', displayName: 'Clerk', password })
      .success,
    false,
  );
  assert.equal(loginResponseSchema.safeParse({ user: { passwordHash: 'private' } }).success, false);
});
test('password hashing uses salt, preserves spaces, verifies and rejects malformed encodings', async () => {
  const password = '  a long payroll password 😃  ';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword(password, DUMMY_PASSWORD_HASH), false);
  assert.equal(await verifyPassword(password, 'scrypt$v1$2$8$1$00$00'), false);
});
test('login throttling resets, isolates clients and stays bounded', () => {
  let time = 0;
  const limit = createLoginLimiter(() => time, 2);
  for (let i = 0; i < 10; i++) assert.equal(limit('one'), 0);
  assert.equal(limit('one'), 60);
  assert.equal(limit('two'), 0);
  assert.equal(limit('three'), 60);
  time = 59000;
  assert.equal(limit('one'), 1);
  time = 60000;
  assert.equal(limit('one'), 0);
  assert.equal(limit('three'), 0);
});
test('migration checksum is stable across CRLF and detects edits', () => {
  assert.equal(migrationChecksum('SELECT 1;\r\n'), migrationChecksum('SELECT 1;\n'));
  assert.notEqual(migrationChecksum('SELECT 1;'), migrationChecksum('SELECT 2;'));
});
test('router returns safe errors, no-store, bounded payloads, and idempotent logout', async () => {
  let mode: 'invalid' | 'down' | 'unexpected' = 'invalid';
  const service: AuthService = {
    createUser: async () => {
      throw new Error('not used');
    },
    login: async () => {
      if (mode === 'down')
        throw Object.assign(new Error('private database credentials'), { code: 'ECONNREFUSED' });
      if (mode === 'unexpected') throw new Error('private password');
      return null;
    },
    session: async () => null,
    logout: async () => undefined,
  };
  const app = express();
  app.use('/api/auth', createAuthRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/auth`;
  const request = (path: string, body: string) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  try {
    let response = await request('/login', '{');
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: { code: 'INVALID_REQUEST' } });
    response = await request('/login', JSON.stringify({ identifier: 'clerk', password: 'wrong' }));
    assert.equal(response.status, 401);
    assert(authErrorSchema.safeParse(await response.json()).success);
    mode = 'down';
    response = await request('/login', JSON.stringify({ identifier: 'clerk', password: 'wrong' }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'SERVICE_UNAVAILABLE' } });
    mode = 'unexpected';
    response = await request('/login', JSON.stringify({ identifier: 'clerk', password: 'wrong' }));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'AUTHENTICATION_FAILED' } });
    response = await fetch(base + '/session');
    assert.equal(response.status, 401);
    response = await fetch(base + '/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${'a'.repeat(43)}` },
    });
    assert.equal(response.status, 204);
    response = await request(
      '/login',
      JSON.stringify({ identifier: 'clerk', password: 'x'.repeat(9000) }),
    );
    assert.equal(response.status, 400);
    for (let i = 0; i < 5; i++) await request('/login', '{}');
    response = await request('/login', '{}');
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
