import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
// `./App` is the sibling `App.tsx`, resolved through `moduleResolution: "Bundler"`
// (apps/web/tsconfig.json). The specifier stays extensionless on purpose: adding
// `.tsx` or a path alias here would itself be an error, not a fix.
import App from './App';
import './index.css';

/*
 * HashRouter (not BrowserRouter) is intentional.
 *
 * In production the Electron desktop shell loads this build over file://, where
 * path-based routing has no server to resolve deep links. Hash routing works
 * identically under file:// and http://, so the same build serves the desktop
 * today and a browser deployment later.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root was not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
