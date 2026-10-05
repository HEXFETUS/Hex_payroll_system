import type { AttendanceRecord } from '@hexpayroll/shared';
import { formatTime, minutesLabel } from '../../utils/dates';
export function AttendanceTable({
  records,
  compact = false,
  timezone,
  emptyMessage = 'No attendance records for this date.',
}: {
  records: AttendanceRecord[];
  compact?: boolean;
  timezone: string | null;
  emptyMessage?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Time in</th>
            <th>Time out</th>
            {!compact && <th>Worked</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {!records.length && (
            <tr>
              <td colSpan={compact ? 4 : 5}>{emptyMessage}</td>
            </tr>
          )}
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.employeeName}</td>
              <td>{formatTime(r.firstIn, timezone)}</td>
              <td>{formatTime(r.lastOut, timezone)}</td>
              {!compact && <td>{minutesLabel(r.workedMinutes)}</td>}
              <td>{r.attendanceStatus.replaceAll('_', ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
