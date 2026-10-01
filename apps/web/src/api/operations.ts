import type { PublicUser } from '@hexpayroll/shared';

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
  present: number;
  absent: number;
  late: number;
  onLeave: number;
}
export interface ManagedUser extends PublicUser {
  role: string | null;
  active: boolean;
  lastLogin: string | null;
}
export type IntegrationResult<T> =
  { kind: 'available'; data: T } | { kind: 'unavailable'; message: string };
export async function readDashboardSummary(): Promise<IntegrationResult<DashboardSummary>> {
  return {
    kind: 'unavailable',
    message: 'Employee and attendance integration is pending. Metrics are not available yet.',
  };
}
export async function readAttendance(
  _filters: AttendanceFilters,
): Promise<IntegrationResult<AttendanceRecord[]>> {
  return {
    kind: 'unavailable',
    message: 'Attendance integration is pending. No attendance data is available yet.',
  };
}
export async function readUsers(): Promise<IntegrationResult<ManagedUser[]>> {
  return {
    kind: 'unavailable',
    message:
      'User listing and creation APIs are not connected. Accounts are currently provisioned through the local administrative CLI.',
  };
}
