import { useQuery } from '@tanstack/react-query';
import { HEALTH_PATH, formatPeso, type HealthStatus } from '@hexpayroll/shared';

/** The loopback API. In the packaged desktop this becomes the shell's ephemeral port. */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4311';

interface HealthPayload extends HealthStatus {
  databaseName?: string;
  connectedAs?: string;
}

async function fetchHealth(): Promise<HealthPayload> {
  const response = await fetch(`${API_BASE_URL}${HEALTH_PATH}`, {
    headers: { accept: 'application/json' },
  });

  const payload = (await response.json()) as HealthPayload;

  if (!response.ok) {
    throw new Error(payload.error ?? `API responded with status ${response.status}`);
  }

  return payload;
}

function StatusPill({ online, pending }: { online: boolean; pending: boolean }) {
  const [label, classes] = pending
    ? ['● CHECKING', 'bg-amber-500/15 text-amber-300 ring-amber-500/30']
    : online
      ? ['● ONLINE', 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30']
      : ['● OFFLINE', 'bg-rose-500/15 text-rose-300 ring-rose-500/30'];

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide ring-1 ring-inset ${classes}`}
    >
      {label}
    </span>
  );
}

function CheckRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-slate-800 py-2.5 last:border-b-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span
        className={`max-w-[60%] truncate text-right font-mono text-sm ${
          ok === undefined ? 'text-slate-200' : ok ? 'text-emerald-300' : 'text-rose-300'
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export default function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5_000,
  });

  const online = health.data?.status === 'ok';
  const pending = health.isLoading;
  const failure = health.error instanceof Error ? health.error.message : undefined;

  return (
    <div className="min-h-full bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Hex Payroll</h1>
            <p className="mt-1 text-sm text-slate-400">
              Phase 0 — desktop foundation verification
            </p>
          </div>
          <StatusPill online={online} pending={pending} />
        </header>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-300 uppercase">
            Foundation checks
          </h2>

          <CheckRow label="API base URL" value={API_BASE_URL} />
          <CheckRow
            label="API health"
            value={pending ? 'checking…' : online ? 'ok' : (failure ?? 'unreachable')}
            ok={pending ? undefined : online}
          />
          <CheckRow
            label="Database"
            value={health.data?.database ?? (pending ? 'checking…' : 'unreachable')}
            ok={pending ? undefined : health.data?.database === 'reachable'}
          />
          <CheckRow label="Database name" value={health.data?.databaseName ?? '—'} />
          <CheckRow label="Connected as" value={health.data?.connectedAs ?? '—'} />
          <CheckRow
            label="Shared money helper"
            value={`formatPeso(123456) = ${formatPeso(123456)}`}
            ok
          />
          <CheckRow
            label="PostgreSQL"
            value={health.data?.databaseVersion?.split(' ').slice(0, 2).join(' ') ?? '—'}
          />
        </section>

        <p className="mt-5 text-xs leading-relaxed text-slate-500">
          Phase 0 verifies infrastructure only: PostgreSQL, the Express API, the shared packages and
          this React client. No payroll tables, contribution rates or synchronisation logic exist
          yet — those begin in Phase 1. The status indicator above will flip to OFFLINE whenever the
          local API cannot be reached, which is the behaviour the offline-first design depends on.
        </p>
      </div>
    </div>
  );
}
