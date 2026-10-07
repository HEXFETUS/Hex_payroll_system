export function startLocalAttendanceWorker(
  mode: 'central' | 'local' | 'disabled',
  start: () => () => Promise<void>,
): () => Promise<void> {
  return mode === 'central' ? async () => {} : start();
}
