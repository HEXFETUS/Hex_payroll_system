export function MetricCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-medium text-slate-600">{label}</h2>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value ?? '—'}</p>
      <p className="mt-2 text-xs text-slate-500">
        {value === undefined ? 'Awaiting integration' : 'Current operational summary'}
      </p>
    </section>
  );
}
