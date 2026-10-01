import { AuthLayout } from '../layouts/AuthLayout';
import { LoginForm } from '../components/auth/LoginForm';
import { useAuth } from '../auth/AuthProvider';
export function LoginPage() {
  const { acceptSession, notice } = useAuth();
  return (
    <AuthLayout>
      <h1 id="login-title" className="text-2xl font-semibold tracking-tight">
        Sign in
      </h1>
      <p className="mt-2 mb-7 text-sm text-slate-600">
        Enter your credentials to access Hex Payroll.
      </p>
      {notice && (
        <p role="status" className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          {notice}
        </p>
      )}
      <LoginForm onSuccess={acceptSession} />
    </AuthLayout>
  );
}
