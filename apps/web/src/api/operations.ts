import {
  dashboardSummarySchema,
  attendanceRecordSchema,
  type AttendanceRecord,
  type AttendanceStatus,
} from '@hexpayroll/shared';
import { foundationRequest } from './foundation';
import { z } from 'zod';
export type { AttendanceRecord, AttendanceStatus };
export type IntegrationResult<T> =
  { kind: 'available'; data: T } | { kind: 'unavailable'; message: string };
export async function readDashboardSummary(token: string) {
  return {
    kind: 'available' as const,
    data: dashboardSummarySchema.parse(await foundationRequest('dashboard/summary', token)),
  };
}
export async function readAttendance(
  filters: { date: string; employee: string; status: AttendanceStatus | '' },
  token: string,
): Promise<IntegrationResult<AttendanceRecord[]>> {
  const response = z
    .object({ items: z.array(attendanceRecordSchema) })
    .parse(
      await foundationRequest(
        'attendance?date=' +
          filters.date +
          '&search=' +
          encodeURIComponent(filters.employee) +
          (filters.status ? '&status=' + filters.status : ''),
        token,
      ),
    );
  return { kind: 'available', data: response.items };
}
