import { HEALTH_PATH, type HealthStatus } from '@hexpayroll/shared';
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4311';
export async function fetchHealth(signal?: AbortSignal): Promise<HealthStatus> {
  const timeout = AbortSignal.timeout(4_000);
  const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${HEALTH_PATH}`, {
    headers: { accept: 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error('Local payroll service unavailable');
  const payload: unknown = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('status' in payload) ||
    payload.status !== 'ok' ||
    !('database' in payload) ||
    payload.database !== 'reachable' ||
    !('timestamp' in payload) ||
    typeof payload.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(payload.timestamp))
  ) {
    throw new Error('Invalid local service readiness response');
  }
  return { status: 'ok', database: 'reachable', timestamp: payload.timestamp };
}
