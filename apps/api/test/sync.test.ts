import assert from 'node:assert/strict';
import test from 'node:test';
import { syncEventSchema, syncSequenceSchema } from '@hexpayroll/shared';
import { randomUUID } from 'node:crypto';

test('transport cursors preserve bigint precision and reject invalid bounds', () => {
  assert.equal(syncSequenceSchema.parse('9007199254740993'), '9007199254740993');
  for (const value of ['-1', '01', '1.1', '9223372036854775808'])
    assert.equal(syncSequenceSchema.safeParse(value).success, false);
});
test('transport events reject unknown versions, operations and oversized UTF-8 payloads', () => {
  const event = {
    eventId: randomUUID(),
    entityType: 'departments',
    entityId: randomUUID(),
    operation: 'CREATE',
    revision: 1,
    payloadVersion: 1,
    payload: { name: '給与' },
  };
  assert.equal(syncEventSchema.safeParse(event).success, true);
  assert.equal(syncEventSchema.safeParse({ ...event, payloadVersion: 2 }).success, false);
  assert.equal(syncEventSchema.safeParse({ ...event, operation: 'DELETE' }).success, false);
  assert.equal(
    syncEventSchema.safeParse({ ...event, payload: { name: '給'.repeat(90000) } }).success,
    false,
  );
});
