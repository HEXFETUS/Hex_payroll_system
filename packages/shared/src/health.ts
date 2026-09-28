/**
 * The health contract, shared by the API (which produces it) and the web /
 * desktop clients (which consume it). In Phase 0 this is the single end-to-end
 * proof that `packages/shared` is wired into every layer.
 */
export interface HealthStatus {
  status: 'ok' | 'error';
  /** Whether a real query reached PostgreSQL, not merely that the process is alive. */
  database: 'reachable' | 'unreachable';
  /** Which PostgreSQL server actually answered — useful once central sync exists. */
  databaseVersion?: string;
  timestamp: string;
  error?: string;
}

export const HEALTH_PATH = '/api/health';
