import type { ReactNode } from 'react';
import { LocalServiceStatus } from '../components/auth/LocalServiceStatus';
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-slate-100 px-4 py-10 text-slate-900 sm:px-6">
      <div className="w-full max-w-[440px]">
        <header className="mb-7 flex items-center justify-center gap-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 48 48"
            className="h-12 w-12 text-teal-700"
            fill="none"
          >
            <path d="M24 3 43 14v20L24 45 5 34V14Z" fill="currentColor" />
            <path d="M17 15v18m14-18v18M17 24h14" stroke="white" strokeWidth="3" />
          </svg>
          <div>
            <p className="text-lg font-bold tracking-[0.12em]">HEX PAYROLL</p>
            <p className="mt-0.5 text-sm text-slate-600">Payroll Management System</p>
          </div>
        </header>
        <section
          aria-labelledby="login-title"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          {children}
        </section>
        <footer className="mt-6">
          <LocalServiceStatus />
        </footer>
      </div>
    </main>
  );
}
