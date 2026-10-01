import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../../api/health';
export function LocalServiceStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 5_000,
    networkMode: 'always',
    retry: false,
  });
  const checking = health.isPending;
  const ready = !checking && !health.isError && health.data?.status === 'ok';
  const label = checking
    ? 'Checking local system'
    : ready
      ? 'Local system ready'
      : 'Local payroll service unavailable';
  return (
    <div role="status" className="flex items-center justify-center gap-2 text-xs text-slate-600">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${checking ? 'bg-slate-400' : ready ? 'bg-teal-600' : 'bg-amber-600'}`}
      />
      <span>{label}</span>
    </div>
  );
}
