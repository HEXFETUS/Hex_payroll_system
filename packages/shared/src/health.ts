import { z } from 'zod';

export const healthStatusSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    database: z.literal('reachable'),
    databaseVersion: z.string().min(1).optional(),
    timestamp: z.iso.datetime(),
  }),
  z.object({
    status: z.literal('error'),
    database: z.literal('unreachable'),
    timestamp: z.iso.datetime(),
    error: z.literal('Database readiness check failed').optional(),
  }),
]);
export type HealthStatus = z.infer<typeof healthStatusSchema>;
export const HEALTH_PATH = '/api/health';
export function parseHealthResponse(status: number, payload: unknown): HealthStatus {
  const result = healthStatusSchema.parse(payload);
  if ((status === 200 && result.status === 'ok') || (status === 503 && result.status === 'error'))
    return result;
  throw new Error('Invalid local service readiness response');
}
