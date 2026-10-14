import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { syncSummarySchema } from '@hexpayroll/shared';
import { retryDelayMs } from '../src/sync/delivery.js';
import { abortable, requestSignal } from '../src/sync/transport.js';
import { SyncWorkerStatus } from '../src/sync/status.js';
import { startWorker } from '../src/sync/worker.js';

test('equal jitter stays within its exponential bound and five-minute cap', () => {
  assert.equal(
    retryDelayMs(1, () => 0),
    1000,
  );
  assert.equal(
    retryDelayMs(2, () => 0.5),
    3000,
  );
  assert.equal(
    retryDelayMs(20, () => 0),
    150000,
  );
  assert.ok(retryDelayMs(20, () => 0.99999) < 300000);
});

test('transport deadline and cancellation bound an unresponsive adapter', async () => {
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(
      abortable(() => new Promise(() => {}), requestSignal({ timeoutMs: 10 })),
      { name: 'TimeoutError' },
    );
    const controller = new AbortController();
    const work = abortable(() => new Promise(() => {}), controller.signal);
    controller.abort(new Error('Shutdown'));
    await assert.rejects(work, /Shutdown/);
    await assert.rejects(
      abortable(() => Promise.resolve(), controller.signal),
      /Shutdown/,
    );
  } finally {
    clearInterval(keepAlive);
  }
});

test('availability requires verification, expires, and cannot leak across organizations', () => {
  let now = 100000;
  const status = new SyncWorkerStatus(() => now);
  status.organizationId = 'organization-a';
  assert.equal(status.snapshot('local', 'organization-a', 15000).transportAvailability, 'unknown');
  status.recordTransport(true);
  assert.equal(
    status.snapshot('local', 'organization-a', 15000).transportAvailability,
    'available',
  );
  assert.equal(status.snapshot('local', 'organization-b', 15000).lastTransportVerification, null);
  now += 30000;
  assert.equal(status.snapshot('local', 'organization-a', 15000).transportAvailability, 'unknown');
  status.recordTransport(false);
  assert.equal(
    status.snapshot('local', 'organization-a', 15000).transportAvailability,
    'unavailable',
  );
  assert.equal(
    status.snapshot('disabled', 'organization-a', 15000).transportAvailability,
    'unconfigured',
  );
});

test('worker does not overlap, pulls after push failure, aborts immediately, and restarts', async () => {
  const status = new SyncWorkerStatus();
  let tick = () => {};
  let cancelled = 0,
    pushes = 0,
    pulls = 0,
    applied = 0,
    errors = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = startWorker(
    {
      prepare: async () => {},
      push: async () => {
        pushes++;
        await pending;
        throw new Error('Offline');
      },
      pull: async () => {
        pulls++;
      },
      apply: async () => {
        applied++;
      },
    },
    {
      interval: 15000,
      status,
      onError: () => {
        errors++;
      },
      schedule: (callback) => {
        tick = callback;
        return () => {
          cancelled++;
        };
      },
    },
  );
  await nextTurn();
  tick();
  tick();
  assert.equal(pushes, 1);
  release();
  await nextTurn();
  assert.equal(pulls, 1);
  assert.equal(applied, 1);
  assert.equal(errors, 1);
  assert.equal(status.state, 'idle');
  await stop();
  await stop();
  tick();
  assert.equal(cancelled, 1);
  assert.equal(pushes, 1);
  assert.equal(status.state, 'stopped');

  let aborted = false;
  const stopAgain = startWorker(
    {
      prepare: async () => {},
      push: async (signal) => {
        await abortable(() => new Promise(() => {}), signal).catch(() => {
          aborted = true;
        });
      },
      pull: async () => {
        pulls++;
      },
      apply: async () => {
        applied++;
      },
    },
    {
      interval: 15000,
      status,
      onError: () => {
        errors++;
      },
    },
  );
  await nextTurn();
  await stopAgain();
  assert.equal(aborted, true);
  assert.equal(pulls, 1);
  assert.equal(errors, 1);
});

test('worker reports a blocked push while independent pull continues', async () => {
  const status = new SyncWorkerStatus();
  let pulled = false;
  const stop = startWorker(
    {
      prepare: async () => {},
      push: async () => {
        status.state = 'blocked';
      },
      pull: async () => {
        pulled = true;
      },
      apply: async () => {},
    },
    { interval: 15000, status, onError: () => {} },
  );
  await nextTurn();
  assert.equal(status.state, 'blocked');
  assert.equal(pulled, true);
  await stop();
});

test('summary contract accepts configured and disabled modes with full diagnostics', () => {
  for (const mode of ['local', 'central', 'disabled'] as const) {
    assert.equal(
      syncSummarySchema.safeParse({
        mode,
        configured: mode !== 'disabled',
        nodeProvisioned: mode === 'local',
        pending: 1,
        processing: 0,
        synced: 2,
        failed: 0,
        conflicts: 0,
        awaitingApplication: 0,
        lastSuccessfulPush: null,
        workerState: 'idle',
        transportAvailability: 'unknown',
        lastTransportVerification: null,
      }).success,
      true,
    );
  }
});
