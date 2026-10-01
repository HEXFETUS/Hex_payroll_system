import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { readSession, SessionInvalidError } from '../auth/authentication';
import { useAuth } from '../auth/AuthProvider';
import { LocalServiceStatus } from '../components/auth/LocalServiceStatus';
export function AuthenticatedPage() {
  const { session, clearSession, signOut } = useAuth();
  const verification = useQuery({
    queryKey: ['auth-session', session?.accessToken],
    queryFn: () => readSession(session!.accessToken),
    enabled: session !== null,
    networkMode: 'always',
    retry: false,
    refetchInterval: 60000,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (
      verification.error instanceof SessionInvalidError ||
      (verification.data && Date.parse(verification.data.expiresAt) <= Date.now())
    )
      clearSession('Your session has expired or is no longer valid. Please sign in again.');
  }, [verification.error, verification.data, clearSession]);
  if (!session) return <Navigate to="/login" replace />;
  const confirmed = verification.data && !verification.isError;
  return (
    <main className="flex min-h-full items-center justify-center bg-slate-100 p-6 text-slate-900">
      <section
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
        aria-labelledby="app-title"
      >
        <p className="mb-4 text-sm font-bold tracking-widest text-teal-700">HEX PAYROLL</p>
        <h1 id="app-title" className="text-2xl font-semibold">
          {confirmed ? `Welcome, ${verification.data.user.displayName}` : 'Verifying your session'}
        </h1>
        {confirmed && (
          <p className="mt-3 text-sm text-slate-600">
            You are signed in. Payroll modules will be available in a future update.
          </p>
        )}
        {verification.isError && !(verification.error instanceof SessionInvalidError) && (
          <div
            role="alert"
            className="mt-4 space-y-3 rounded-md bg-amber-50 p-4 text-sm text-amber-900"
          >
            <p>
              Session verification is unavailable. Please check the local payroll service and retry.
            </p>
            <button
              type="button"
              className="text-action"
              disabled={verification.isFetching}
              onClick={() => void verification.refetch()}
            >
              Retry verification
            </button>
          </div>
        )}
        <button type="button" className="text-action mt-6" onClick={() => void signOut()}>
          Sign Out
        </button>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <LocalServiceStatus />
        </div>
      </section>
    </main>
  );
}
