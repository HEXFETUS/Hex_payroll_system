import { Link } from 'react-router-dom';
import { useNetworkConnection, useSystemHealth } from './useSystemHealth';
import { StatusIndicator, type StatusTone } from './StatusIndicator';
import { formatTime } from '../../utils/dates';
import { useQuery } from '@tanstack/react-query';
import { syncSummarySchema } from '@hexpayroll/shared';
import { useAuth } from '../../auth/AuthProvider';
import { foundationRequest } from '../../api/foundation';

export function useHealthItems() {
  const { session } = useAuth();
  const sync = useQuery({
    queryKey: ['operations', 'sync'],
    queryFn: async () =>
      syncSummarySchema.parse(await foundationRequest('sync/summary', session!.accessToken)),
    enabled: Boolean(
      session?.user.organizationId && session.user.permissions?.includes('sync.view'),
    ),
    networkMode: 'always',
    refetchInterval: 15000,
  });
  const health = useSystemHealth();
  const online = useNetworkConnection();
  const data = health.isError ? undefined : health.data;
  const pending = health.isPending && !health.isError;
  const items: { name: string; label: string; tone: StatusTone; detail: string }[] = [
    {
      name: 'Local API',
      label: pending ? 'Checking' : data ? 'Running' : 'Unavailable',
      tone: pending ? 'checking' : data ? 'healthy' : 'error',
      detail: 'Local payroll service',
    },
    {
      name: 'Local Database',
      label: pending
        ? 'Checking'
        : !data
          ? 'Unknown'
          : data.database === 'reachable'
            ? 'Connected'
            : 'Disconnected',
      tone: pending
        ? 'checking'
        : !data
          ? 'warning'
          : data.database === 'reachable'
            ? 'healthy'
            : 'error',
      detail:
        data?.status === 'ok' && data.databaseVersion
          ? data.databaseVersion
          : 'Database readiness is checked by the local API.',
    },
    {
      name: 'Biometric Device',
      label: 'Not configured',
      tone: 'not-configured',
      detail: 'Device integration is not available yet.',
    },
    {
      name: 'Network / Internet',
      label: online ? 'Network available' : 'Offline',
      tone: online ? 'healthy' : 'offline',
      detail:
        'Browser-reported connectivity; Internet reachability is not verified. Local operations do not require Internet access.',
    },
    {
      name: 'Synchronization',
      label: sync.data ? `${sync.data.pending} pending` : 'Not configured',
      tone: 'not-configured',
      detail: 'Local changes are tracked in a durable outbox. The sync engine is not configured.',
    },
  ];
  return { health, items, data };
}
export function HealthCard({
  name,
  label,
  tone,
  detail,
}: ReturnType<typeof useHealthItems>['items'][number]) {
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{name}</h2>
        <StatusIndicator tone={tone}>{label}</StatusIndicator>
      </div>
      <p className="break-words text-sm leading-6 text-slate-600">{detail}</p>
    </section>
  );
}
export function SystemHealthWidget() {
  const { items, data } = useHealthItems();
  return (
    <section className="panel p-5">
      <h2 className="mb-4 font-semibold">System Health</h2>
      <dl className="space-y-3">
        {items.map((item) => (
          <div key={item.name} className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-sm text-slate-600">{item.name}</dt>
            <dd>
              <StatusIndicator tone={item.tone}>{item.label}</StatusIndicator>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-slate-500">
        {data?.status === 'ok' ? 'Local system operational' : 'Check local service readiness'}
      </p>
      <Link to="/system-health" className="text-action mt-4 inline-block text-sm">
        View System Health →
      </Link>
    </section>
  );
}
export function SystemHealthPage() {
  const { health, items, data } = useHealthItems();
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Local infrastructure and connectivity are monitored separately.
        </p>
        <button
          className="secondary-button"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
        >
          {health.isFetching ? 'Checking…' : 'Refresh status'}
        </button>
      </div>
      <p className="text-xs text-slate-500" role="status">
        {data
          ? `Last checked: ${formatTime(data.timestamp)} (Philippine time)`
          : 'No current verified health response.'}
      </p>
      {health.isError && (
        <p role="alert" className="notice">
          Unable to verify the local API. Database status is unknown. Check the local service and
          refresh.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {items.map((item) => (
          <HealthCard key={item.name} {...item} />
        ))}
      </div>
    </div>
  );
}
