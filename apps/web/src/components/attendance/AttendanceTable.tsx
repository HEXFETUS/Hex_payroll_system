import type { AttendanceRecord, AttendanceStatus } from '../../api/operations';
import { StatusIndicator, type StatusTone } from '../system/StatusIndicator';
import { formatTime } from '../../utils/dates';
const tones: Record<AttendanceStatus, StatusTone> = {
  Present: 'healthy',
  Late: 'warning',
  Absent: 'error',
  'On Leave': 'offline',
};
export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  return <StatusIndicator tone={tones[status]}>{status}</StatusIndicator>;
}
export function AttendanceTable({
  records,
  compact = false,
  emptyMessage = 'No attendance records for this date.',
}: {
  records: AttendanceRecord[];
  compact?: boolean;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <caption className="sr-only">Employee attendance records</caption>
        <thead>
          <tr>
            {!compact && <th scope="col">Employee ID</th>}
            <th scope="col">Employee</th>
            <th scope="col">Time In</th>
            <th scope="col">Time Out</th>
            {!compact && <th scope="col">Hours Worked</th>}
            <th scope="col">Status</th>
            {!compact && <th scope="col">Source</th>}
          </tr>
        </thead>
        <tbody>
          {!records.length && (
            <tr>
              <td colSpan={compact ? 4 : 7} className="text-center">
                {emptyMessage}
              </td>
            </tr>
          )}
          {records.map((row) => (
            <tr key={row.id}>
              {!compact && <td>{row.employeeId}</td>}
              <td className="font-medium text-slate-900">{row.employeeName}</td>
              <td>{formatTime(row.timeIn)}</td>
              <td>{formatTime(row.timeOut)}</td>
              {!compact && <td>{row.hoursWorked ?? '—'}</td>}
              <td>
                <AttendanceStatusBadge status={row.status} />
              </td>
              {!compact && <td>{row.source}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
