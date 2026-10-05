import type { ReactNode } from 'react';
import type { IntegrationResult } from '../api/operations';

export function DataState<T>({
  pending,
  error,
  result,
  retry,
  children,
}: {
  pending: boolean;
  error: boolean;
  result: IntegrationResult<T> | undefined;
  retry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (pending)
    return (
      <p role="status" className="empty-state">
        Loading…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="empty-state">
        Unable to load this information.{' '}
        <button className="text-action" onClick={retry}>
          Retry
        </button>
      </div>
    );
  if (!result) return <p className="empty-state">Information is unavailable.</p>;
  if (result.kind === 'unavailable')
    return (
      <div className="empty-state">
        <p className="mb-2 font-medium text-slate-700">Integration pending</p>
        <p>{result.message}</p>
      </div>
    );
  return children(result.data);
}
