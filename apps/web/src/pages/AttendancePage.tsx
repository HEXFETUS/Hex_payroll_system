import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceStatuses, readAttendance, type AttendanceFilters } from '../api/operations';
import { philippineDate } from '../utils/dates';
import { DataState } from '../components/DataState';
import { AttendanceTable } from '../components/attendance/AttendanceTable';
export function AttendancePage() {
  const id = useId();
  const [filters, setFilters] = useState<AttendanceFilters>({
    date: philippineDate(),
    employee: '',
    status: '',
  });
  const query = useQuery({
    queryKey: ['operations', 'attendance', filters.date, filters.employee, filters.status],
    queryFn: () => readAttendance(filters),
    networkMode: 'always',
    enabled: filters.date !== '',
  });
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">
        Review employee attendance. Biometric and manual attendance integration is pending.
      </p>
      <div className="panel grid gap-4 p-5 sm:grid-cols-3">
        <label className="field-label">
          Date (Philippine time)
          <input
            className="credential-input mt-2"
            type="date"
            required
            value={filters.date}
            onChange={(e) => setFilters({ ...filters, date: e.target.value })}
          />
        </label>
        <label className="field-label">
          Search employee
          <input
            className="credential-input mt-2"
            type="search"
            placeholder="Name or employee ID"
            value={filters.employee}
            onChange={(e) => setFilters({ ...filters, employee: e.target.value })}
          />
        </label>
        <div>
          <label className="field-label" htmlFor={`${id}-status`}>
            Attendance status
          </label>
          <select
            id={`${id}-status`}
            className="credential-input mt-2"
            value={filters.status}
            onChange={(e) =>
              setFilters({ ...filters, status: e.target.value as AttendanceFilters['status'] })
            }
          >
            <option value="">All statuses</option>
            {attendanceStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </div>
      </div>
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <h2 className="font-semibold">Attendance Records</h2>
          <p className="mt-1 text-xs text-slate-500">
            Time in and out are shown in Philippine time. Hours worked will be supplied by the
            backend.
          </p>
        </div>
        {!filters.date ? (
          <p className="empty-state">Select a date to review attendance.</p>
        ) : (
          <DataState
            pending={query.isPending}
            error={query.isError}
            result={query.data}
            retry={() => void query.refetch()}
          >
            {(records) => <AttendanceTable records={records} />}
          </DataState>
        )}
        {filters.date && !query.isError && query.data?.kind === 'unavailable' && (
          <AttendanceTable
            records={[]}
            emptyMessage="Attendance records unavailable — integration pending."
          />
        )}
      </section>
    </div>
  );
}
