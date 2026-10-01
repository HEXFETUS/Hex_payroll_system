import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readAttendance, readDashboardSummary } from '../api/operations';
import { philippineDate } from '../utils/dates';
import { DataState } from '../components/DataState';
import { MetricCard } from '../components/dashboard/MetricCard';
import { AttendanceTable } from '../components/attendance/AttendanceTable';
import { SystemHealthWidget } from '../components/system/SystemHealth';

export function DashboardPage() {
  const date = philippineDate();
  const summary = useQuery({
    queryKey: ['operations', 'dashboard'],
    queryFn: readDashboardSummary,
    networkMode: 'always',
  });
  const attendance = useQuery({
    queryKey: ['operations', 'attendance', date, '', ''],
    queryFn: () => readAttendance({ date, employee: '', status: '' }),
    networkMode: 'always',
  });
  const values =
    !summary.isError && summary.data?.kind === 'available' ? summary.data.data : undefined;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-600">Your local payroll workstation at a glance.</p>
        <p className="mt-1 text-xs text-slate-500">{date} · Philippine time</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Employees" value={values?.totalEmployees} />
        <MetricCard label="Present Today" value={values?.present} />
        <MetricCard label="Absent Today" value={values?.absent} />
        <MetricCard label="Late Today" value={values?.late} />
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <section className="panel p-5">
            <h2 className="mb-4 font-semibold">Today's Attendance</h2>
            <DataState
              pending={summary.isPending}
              error={summary.isError}
              result={summary.data}
              retry={() => void summary.refetch()}
            >
              {(data) => (
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    ['Present', data.present],
                    ['Late', data.late],
                    ['Absent', data.absent],
                    ['On Leave', data.onLeave],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-sm text-slate-600">{label}</dt>
                      <dd className="mt-2 text-xl font-semibold">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </DataState>
          </section>
          <section className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
              <h2 className="font-semibold">Recent Attendance</h2>
              <Link to="/attendance" className="text-action text-sm">
                View Attendance →
              </Link>
            </div>
            <DataState
              pending={attendance.isPending}
              error={attendance.isError}
              result={attendance.data}
              retry={() => void attendance.refetch()}
            >
              {(records) => <AttendanceTable compact records={records.slice(0, 5)} />}
            </DataState>
          </section>
        </div>
        <SystemHealthWidget />
      </div>
    </div>
  );
}
