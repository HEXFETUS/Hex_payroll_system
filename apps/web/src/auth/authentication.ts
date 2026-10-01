import {
  AUTH_PATHS,
  authErrorSchema,
  loginResponseSchema,
  sessionResponseSchema,
  type LoginResponse,
  type SessionResponse,
} from '@hexpayroll/shared';
import { API_BASE_URL } from '../api/health';
export interface SignInInput {
  identifier: string;
  password: string;
  rememberMe: boolean;
}
export const authenticationMessages = {
  'invalid-credentials': 'The username or password is incorrect. Please try again.',
  'authentication-failed': 'Unable to sign in. Please try again.',
  'service-unavailable': 'The local payroll service is unavailable. Please try again shortly.',
  unexpected: 'Something went wrong. Please try again.',
  'rate-limited': 'Too many sign-in attempts. Please wait a minute and try again.',
  'invalid-request': 'Check your username and password and try again.',
};
export type AuthenticationErrorCode = keyof typeof authenticationMessages;
export type SignInResult =
  { ok: true; session: LoginResponse } | { ok: false; error: AuthenticationErrorCode };
export type SignInAdapter = (input: SignInInput) => Promise<SignInResult>;
export class SessionInvalidError extends Error {}
export async function authRequest(
  path: string,
  method: 'GET' | 'POST',
  token?: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
    credentials: 'omit',
  });
}
export const signIn: SignInAdapter = async ({ identifier, password }) => {
  let response: Response;
  try {
    response = await authRequest(AUTH_PATHS.login, 'POST', undefined, { identifier, password });
  } catch {
    return { ok: false, error: 'service-unavailable' };
  }
  try {
    const payload: unknown = await response.json();
    if (response.ok) {
      const parsed = loginResponseSchema.safeParse(payload);
      if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
        return { ok: false, error: 'unexpected' };
      return { ok: true, session: parsed.data };
    }
    const parsed = authErrorSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'unexpected' };
    const mapping = {
      INVALID_REQUEST: 'invalid-request',
      INVALID_CREDENTIALS: 'invalid-credentials',
      SESSION_INVALID: 'authentication-failed',
      RATE_LIMITED: 'rate-limited',
      SERVICE_UNAVAILABLE: 'service-unavailable',
      AUTHENTICATION_FAILED: 'authentication-failed',
    } as const;
    return { ok: false, error: mapping[parsed.data.error.code] };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
};
export async function readSession(token: string): Promise<SessionResponse> {
  const response = await authRequest(AUTH_PATHS.session, 'GET', token);
  if (response.status === 401) throw new SessionInvalidError('Session invalid');
  if (!response.ok) throw new Error('Session verification unavailable');
  return sessionResponseSchema.parse(await response.json());
}
export async function revokeSession(token: string): Promise<void> {
  const response = await authRequest(AUTH_PATHS.logout, 'POST', token);
  if (response.status !== 204) throw new Error('Session revocation unavailable');
}
