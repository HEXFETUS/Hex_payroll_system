import type { SyncEvent } from '@hexpayroll/shared';

export interface SyncClientConfig {
  url: string;
  nodeId: string;
  token: string;
}
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export type OutgoingEvent = SyncEvent & {
  organizationId: string;
  originNodeId: string;
  baseRevision: number;
  createdAt: string;
};
export interface PushTransport {
  push(events: readonly OutgoingEvent[], signal: AbortSignal): Promise<unknown>;
}
export class TransportError extends Error {
  constructor(public status: number) {
    super(`Synchronization HTTP ${status}`);
  }
}
export function requestSignal(options: RequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10000);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

/** Bound even a custom transport that does not settle when aborted. */
export async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([work(), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function syncRequest(
  config: SyncClientConfig,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
) {
  const response = await fetch(config.url.replace(/\/$/, '') + '/api/sync/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: requestSignal(options),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new TransportError(response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty synchronization response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1048576) throw new Error('Synchronization response exceeds limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function httpPushTransport(config: SyncClientConfig, timeoutMs: number): PushTransport {
  return {
    push: (events, signal) =>
      syncRequest(
        config,
        'push',
        {
          // Keep the existing central wire contract; retain metadata locally for a
          // future versioned adapter rather than modifying business snapshots.
          events: events.map(
            ({ eventId, entityType, entityId, operation, revision, payloadVersion, payload }) => ({
              eventId,
              entityType,
              entityId,
              operation,
              revision,
              payloadVersion,
              payload,
            }),
          ),
        },
        { signal, timeoutMs },
      ),
  };
}
