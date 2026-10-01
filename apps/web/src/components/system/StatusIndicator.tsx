import type { ReactNode } from 'react';
export type StatusTone =
  'healthy' | 'warning' | 'offline' | 'error' | 'checking' | 'not-configured';
const styles: Record<StatusTone, string> = {
  healthy: 'bg-teal-50 text-teal-800',
  warning: 'bg-amber-50 text-amber-900',
  offline: 'bg-slate-100 text-slate-600',
  error: 'bg-red-50 text-red-800',
  checking: 'bg-slate-100 text-slate-600',
  'not-configured': 'bg-slate-100 text-slate-600',
};
export function StatusIndicator({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${styles[tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
