import { dashboardSummarySchema } from '@hexpayroll/shared';
import { foundationRequest } from './foundation';

export const attendanceStatuses = ['Present', 'Late', 'Absent', 'On Leave'] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  timeIn: string | null;
  timeOut: string | null;
  hoursWorked: number | null;
  status: AttendanceStatus;
  source: 'Biometric' | 'Manual';
}
export interface AttendanceFilters {
  date: string;
  employee: string;
  status: AttendanceStatus | '';
}
export interface DashboardSummary {
  totalEmployees: number;
  activeEmployees: number;
  departments: number;
  present: number;
  absent: number;
  late: number;
  onLeave: number;
}
export type IntegrationResult<T> =
  { kind: 'available'; data: T } | { kind: 'unavailable'; message: string };
export async function readDashboardSummary(
  token: string,
): Promise<IntegrationResult<DashboardSummary>> {
  const data = dashboardSummarySchema.parse(await foundationRequest('dashboard/summary', token));
  return { kind: 'available', data: { ...data, present: 0, absent: 0, late: 0, onLeave: 0 } };
}
export async function readAttendance(
  _filters: AttendanceFilters,
): Promise<IntegrationResult<AttendanceRecord[]>> {
  return {
    kind: 'unavailable',
    message: 'Attendance integration is pending. No attendance data is available yet.',
  };
}
