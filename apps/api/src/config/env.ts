import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * `dotenv` resolves `.env` relative to the process working directory. pnpm runs
 * package scripts with the working directory set to the package folder, so this
 * reads `apps/api/.env`, which is gitignored. `apps/api/.env.example` is the
 * committed template.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Loopback by default: the desktop API must not be reachable from the network. */
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4311),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Runtime role: DML only, no DDL privileges. */
  DATABASE_URL: z.string().min(1),

  /**
   * Migration role: owns the schema and applies `database/migrations/*.sql`.
   * Optional because the running API never needs it — only the Phase 1 runner does.
   */
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Report every problem at once. An API that boots half-configured and fails
    // later, mid-payroll, is far worse than one that refuses to start.
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    process.stderr.write(`Invalid environment configuration:\n${details}\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();
