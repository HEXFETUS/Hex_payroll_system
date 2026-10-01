import { useId, useRef, useState, type FormEvent } from 'react';
import { authenticationMessages, signIn, type SignInAdapter } from '../../auth/authentication';
import { PasswordInput } from './PasswordInput';
import type { LoginResponse } from '@hexpayroll/shared';
export function LoginForm({
  authenticate = signIn,
  onSuccess,
}: {
  authenticate?: SignInAdapter;
  onSuccess?: (session: LoginResponse) => void;
}) {
  const id = useId();
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});
  const [feedback, setFeedback] = useState<string>();
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setFeedback(undefined);
    const nextErrors = {
      identifier: identifier.trim() ? undefined : 'Enter your username or email.',
      password: password.length ? undefined : 'Enter your password.',
    };
    setErrors(nextErrors);
    if (nextErrors.identifier || nextErrors.password) {
      (nextErrors.identifier ? identifierRef : passwordRef).current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const result = await authenticate({
        identifier: identifier.trim(),
        password,
        rememberMe: false,
      });
      if (!result.ok) setFeedback(authenticationMessages[result.error]);
      else {
        setPassword('');
        onSuccess?.(result.session);
      }
    } catch {
      setFeedback(authenticationMessages.unexpected);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={pending} className="space-y-5">
      <div>
        <label htmlFor={`${id}-identifier`} className="mb-2 block text-sm font-medium">
          Username or Email
        </label>
        <input
          id={`${id}-identifier`}
          ref={identifierRef}
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          disabled={pending}
          className="credential-input"
          value={identifier}
          onChange={(event) => {
            setIdentifier(event.target.value);
            setFeedback(undefined);
            setErrors((current) => ({ ...current, identifier: undefined }));
          }}
          aria-invalid={Boolean(errors.identifier)}
          aria-describedby={errors.identifier ? `${id}-identifier-error` : undefined}
        />
        {errors.identifier && (
          <p id={`${id}-identifier-error`} className="mt-2 text-xs text-red-700">
            {errors.identifier}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-password`} className="mb-2 block text-sm font-medium">
          Password
        </label>
        <PasswordInput
          id={`${id}-password`}
          ref={passwordRef}
          name="password"
          autoComplete="current-password"
          required
          disabled={pending}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setFeedback(undefined);
            setErrors((current) => ({ ...current, password: undefined }));
          }}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? `${id}-password-error` : undefined}
        />
        {errors.password && (
          <p id={`${id}-password-error`} className="mt-2 text-xs text-red-700">
            {errors.password}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            checked={false}
            disabled
            aria-describedby={`${id}-persistence`}
            className="h-4 w-4 accent-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          />
          Remember me
        </label>
        <button
          type="button"
          className="text-action"
          onClick={() => setRecoveryVisible(!recoveryVisible)}
          aria-expanded={recoveryVisible}
          aria-controls={recoveryVisible ? `${id}-recovery` : undefined}
        >
          Forgot password?
        </button>
      </div>
      <p id={`${id}-persistence`} className="text-xs text-slate-500">
        Persistent sign-in is unavailable. Sign in again after restarting.
      </p>
      {recoveryVisible && (
        <p
          id={`${id}-recovery`}
          role="status"
          className="rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-600"
        >
          Password recovery is not available yet. Please contact your administrator.
        </p>
      )}
      {feedback && (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-900"
        >
          {feedback}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-wait disabled:bg-teal-700/60"
      >
        {pending && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
          />
        )}
        {pending ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
