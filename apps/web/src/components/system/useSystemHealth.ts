import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../../api/health';

function useHealthQuery() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 5_000,
    staleTime: 4_000,
    networkMode: 'always',
    retry: false,
  });
}
const HealthContext = createContext<ReturnType<typeof useHealthQuery> | null>(null);
export function useSystemHealth() {
  const value = useContext(HealthContext);
  if (!value) throw new Error('SystemHealthProvider is required');
  return value;
}
export function SystemHealthProvider({ children }: { children: ReactNode }) {
  const health = useHealthQuery();
  return createElement(HealthContext.Provider, { value: health }, children);
}
export function useNetworkConnection() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
