import { useSystemHealth } from '../system/useSystemHealth';
export function LocalServiceStatus() {
  const health = useSystemHealth();
  const checking = health.isPending && !health.isError;
  const ready = !checking && !health.isError && health.data?.status === 'ok';
  const label = checking
    ? 'Checking local system'
    : ready
      ? 'Local system ready'
      : !health.isError && health.data?.database === 'unreachable'
        ? 'Local service running; database unavailable'
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
