import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  createUserSchema,
  SESSION_LIFETIME_MS,
  type CreateUserInput,
  type LoginRequest,
  type LoginResponse,
  type PublicUser,
  type SessionResponse,
} from '@hexpayroll/shared';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.js';
interface UserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  active: boolean;
}
function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    ...(row.email === null ? {} : { email: row.email }),
    displayName: row.display_name,
  };
}
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function createAuthService(database: Pool) {
  return {
    async createUser(input: CreateUserInput): Promise<PublicUser> {
      const parsed = createUserSchema.parse(input);
      const hash = await hashPassword(parsed.password);
      const result = await database.query<UserRow>(
        'INSERT INTO auth_users (id, username, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, email, display_name',
        [randomUUID(), parsed.username, parsed.email ?? null, parsed.displayName, hash],
      );
      return publicUser(result.rows[0]!);
    },
    async login(input: LoginRequest): Promise<LoginResponse | null> {
      const column = input.identifier.includes('@') ? 'email' : 'username';
      const found = await database.query<UserRow>(
        `SELECT * FROM auth_users WHERE lower(${column}) = lower($1)`,
        [input.identifier],
      );
      const row = found.rows[0];
      const valid = await verifyPassword(input.password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
      if (!row || !valid || !row.active) return null;
      const accessToken = randomBytes(32).toString('base64url');
      // Recheck activation before inserting; protected requests also check activation.
      const result = await database.query<{ expires_at: Date }>(
        "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) SELECT $1, id, now(), now() + ($3 * interval '1 millisecond') FROM auth_users WHERE id=$2 AND active RETURNING expires_at",
        [tokenHash(accessToken), row.id, SESSION_LIFETIME_MS],
      );
      if (!result.rows[0]) return null;
      return {
        user: publicUser(row),
        accessToken,
        expiresAt: result.rows[0].expires_at.toISOString(),
      };
    },
    async session(token: string): Promise<SessionResponse | null> {
      const result = await database.query<UserRow & { expires_at: Date }>(
        'SELECT u.*, s.expires_at FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active',
        [tokenHash(token)],
      );
      const row = result.rows[0];
      return row ? { user: publicUser(row), expiresAt: row.expires_at.toISOString() } : null;
    },
    async logout(token: string): Promise<void> {
      await database.query('DELETE FROM auth_sessions WHERE token_hash=$1', [tokenHash(token)]);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
