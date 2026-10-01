import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LoginResponse } from '@hexpayroll/shared';
import { revokeSession } from './authentication';
interface AuthContextValue {
  session: LoginResponse | null;
  notice: string | undefined;
  acceptSession: (session: LoginResponse) => void;
  clearSession: (notice?: string) => void;
  signOut: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LoginResponse | null>(null);
  const [notice, setNotice] = useState<string>();
  const clearSession = useCallback((message?: string) => {
    setSession(null);
    setNotice(message);
  }, []);
  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (remaining <= 0) {
      clearSession('Your session has expired. Please sign in again.');
      return;
    }
    const timer = setTimeout(
      () => clearSession('Your session has expired. Please sign in again.'),
      remaining,
    );
    return () => clearTimeout(timer);
  }, [session, clearSession]);
  async function signOut() {
    if (!session) return;
    const token = session.accessToken;
    // Stop rendering protected content immediately, including during an API outage.
    clearSession();
    try {
      await revokeSession(token);
    } catch {
      setNotice(
        'Signed out on this device. Server revocation could not be confirmed; the previous session expires within eight hours.',
      );
    }
  }
  return (
    <AuthContext.Provider
      value={{
        session,
        notice,
        acceptSession: (value) => {
          setNotice(undefined);
          setSession(value);
        },
        clearSession,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
