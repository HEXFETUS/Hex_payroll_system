import { z } from 'zod';
export const AUTH_PATHS = {
  login: '/api/auth/login',
  session: '/api/auth/session',
  logout: '/api/auth/logout',
} as const;
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const usernameSchema = z.string().regex(/^[A-Za-z0-9._-]{3,64}$/);
export const newPasswordSchema = z.string().refine((value) => {
  const length = Array.from(value).length;
  return length >= 15 && length <= 128;
}, 'Password must contain 15–128 characters.');
export const createUserSchema = z
  .object({
    username: usernameSchema,
    email: z.email().max(254).optional(),
    displayName: z.string().trim().min(1).max(128),
    password: newPasswordSchema,
  })
  .strict();
export const loginRequestSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => Array.from(value).length <= 128),
  })
  .strict();
export const publicUserSchema = z
  .object({
    id: z.uuid(),
    username: usernameSchema,
    email: z.email().optional(),
    displayName: z.string().min(1).max(128),
  })
  .strict();
export const sessionResponseSchema = z
  .object({ user: publicUserSchema, expiresAt: z.iso.datetime() })
  .strict();
export const loginResponseSchema = sessionResponseSchema.extend({
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const authErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'INVALID_CREDENTIALS',
  'SESSION_INVALID',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'AUTHENTICATION_FAILED',
]);
export const authErrorSchema = z
  .object({ error: z.object({ code: authErrorCodeSchema }).strict() })
  .strict();
export type PublicUser = z.infer<typeof publicUserSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
