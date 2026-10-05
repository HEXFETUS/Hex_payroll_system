import {
  useState,
  useId,
  isValidElement,
  cloneElement,
  type ReactNode,
  type FormEvent,
} from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import {
  scheduleInputSchema,
  manualTimeRecordSchema,
  leaveInputSchema,
  leaveTypeInputSchema,
  assignmentInputSchema,
  processingSummarySchema,
  type FoundationRecord,
  type ScheduleDay,
} from '@hexpayroll/shared';
import { useAuth } from '../auth/AuthProvider';
const usePermission = (permission: string) =>
  useAuth().session?.user.permissions?.some((p) => p === permission) === true;
import { foundationRequest, readPage, readRecord } from '../api/foundation';
import { dateInTimezone, formatTime, minutesLabel } from '../utils/dates';

export function useOrganizationTime() {
  const { session } = useAuth();
  const q = useQuery({
    queryKey: ['timekeeping', 'context', session?.accessToken],
    queryFn: () => readRecord('timekeeping/context', session!.accessToken),
    networkMode: 'always',
  });
  const timezone = typeof q.data?.timezone === 'string' ? q.data.timezone : null;
  return {
    timezone,
    date: timezone ? dateInTimezone(timezone) : '',
    pending: q.isPending,
    error: q.error,
  };
}
function useRows(path: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['timekeeping', path, session?.accessToken],
    queryFn: async () => {
      const first = await readPage(path, session!.accessToken);
      if (path.includes('pageSize=100')) {
        for (let page = 2; first.items.length < first.total; page++) {
          const more = await readPage(path + '&page=' + page, session!.accessToken);
          if (!more.items.length) break;
          first.items.push(...more.items);
        }
      }
      return first;
    },
    networkMode: 'always',
    refetchInterval: 10000,
  });
}
function useWrite() {
  const { session } = useAuth(),
    client = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({
      path,
      body,
      method = 'POST',
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) => foundationRequest(path, session!.accessToken, method, body),
    onSuccess: () => client.invalidateQueries(),
  });
}
const label = (s: unknown) => String(s ?? '—').replaceAll('_', ' ');
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <p className="notice" role="alert">
      {error instanceof Error ? error.message : 'Local service request failed'}
    </p>
  ) : null;
}
function Field({ label: caption, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {caption}
      </label>
      {isValidElement<{ id?: string }>(children) ? cloneElement(children, { id }) : children}
    </div>
  );
}
function Text({
  label: caption,
  name,
  value,
  type = 'text',
  required = false,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <Field label={caption}>
      <input
        className="credential-input mt-2"
        name={name}
        type={type}
        defaultValue={value}
        required={required}
      />
    </Field>
  );
}
function Select({
  label: caption,
  name,
  items,
  value,
  required = false,
}: {
  label: string;
  name: string;
  items: { id: string; name: string }[];
  value?: string;
  required?: boolean;
}) {
  return (
    <Field label={caption}>
      <select
        className="credential-input mt-2"
        name={name}
        defaultValue={value ?? ''}
        required={required}
      >
        <option value="">Select {caption.toLowerCase()}</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Form({
  children,
  onSave,
  pending,
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<unknown>;
  pending?: boolean;
}) {
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="panel space-y-4 p-5"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        setSaved(false);
        void onSave(data)
          .then(() => setSaved(true))
          .catch(setError);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
      <ErrorNotice error={error} />
      {saved && (
        <p role="status" className="text-sm text-teal-700">
          Saved.
        </p>
      )}
      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
const text = (f: FormData, k: string) => String(f.get(k) ?? '');
const choices = (rows: FoundationRecord[] | undefined) =>
  rows?.map((r) => ({
    id: r.id,
    name: String(r.name ?? `${r.employeeNumber} · ${r.firstName} ${r.lastName}`),
  })) ?? [];
function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-4 p-4">
      <button className="secondary-button" disabled={page === 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} · {total} records
      </span>
      <button
        className="secondary-button"
        disabled={page * 25 >= total}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
function ResultTable({
  query,
  columns,
  onRow,
  empty,
}: {
  query: ReturnType<typeof useRows>;
  columns: { title: string; render: (r: FoundationRecord) => ReactNode }[];
  onRow?: (r: FoundationRecord) => void;
  empty: string;
}) {
  return (
    <section className="panel overflow-x-auto">
      {query.isPending ? (
        <p className="empty-state">Loading…</p>
      ) : query.isError ? (
        <div className="p-4">
          <ErrorNotice error={query.error} />
          <button className="secondary-button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.title}>{c.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!query.data?.items.length && (
              <tr>
                <td colSpan={columns.length}>{empty}</td>
              </tr>
            )}
            {query.data?.items.map((r) => (
              <tr key={r.id}>
                {columns.map((c, i) => (
                  <td key={c.title}>
                    {i === 0 && onRow ? (
                      <button className="text-action" onClick={() => onRow(r)}>
                        {c.render(r)}
                      </button>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
function Inspector({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <section className="panel space-y-4 p-5">
      <div className="flex justify-between">
        <h2 className="font-semibold">{title}</h2>
        <button className="secondary-button" onClick={onClose}>
          Close details
        </button>
      </div>
      {children}
    </section>
  );
}
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const initialDays: ScheduleDay[] = weekdays.map((_, dayOfWeek) => ({
  dayOfWeek,
  isWorkDay: false,
  startTime: null,
  endTime: null,
  endDayOffset: 0,
  breakStart: null,
  breakEnd: null,
  breakStartDayOffset: 0,
  breakEndDayOffset: 0,
  graceMinutes: 0,
}));

export function SchedulesPage() {
  const org = useOrganizationTime(),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<FoundationRecord | null>(null),
    [editing, setEditing] = useState(false),
    [days, setDays] = useState<ScheduleDay[]>(initialDays),
    write = useWrite();
  const query = useRows(
    `schedules?page=${page}&search=${encodeURIComponent(search)}${status ? '&status=' + status : ''}`,
  );
  const { session } = useAuth();
  const detail = useQuery({
    queryKey: ['timekeeping', 'schedule', selected?.id, session?.accessToken],
    queryFn: () => readRecord('schedules/' + selected!.id, session!.accessToken),
    enabled: !!selected,
    networkMode: 'always',
  });
  const create = usePermission('schedules.create'),
    edit = usePermission('schedules.update');
  const versions = (detail.data?.versions ?? []) as FoundationRecord[];
  const patchDay = (index: number, patch: Partial<ScheduleDay>) =>
    setDays((ds) => ds.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-5">
      <p>
        Reusable schedules with dated versions. Times use{' '}
        {org.timezone ?? 'the organization timezone'}.
      </p>
      <ErrorNotice error={org.error} />
      <div className="panel flex flex-wrap gap-4 p-4">
        <input
          aria-label="Search schedules"
          className="credential-input"
          placeholder="Search schedules"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Schedule status"
          className="credential-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option>active</option>
          <option>inactive</option>
        </select>
        {create && (
          <button
            className="primary-button"
            onClick={() => {
              setSelected(null);
              setDays(initialDays);
              setEditing(true);
            }}
          >
            Create schedule
          </button>
        )}
      </div>
      <ResultTable
        query={query}
        empty="No schedules configured."
        onRow={(r) => {
          setSelected(r);
          setEditing(false);
        }}
        columns={[
          { title: 'Code', render: (r) => String(r.code) },
          { title: 'Schedule', render: (r) => String(r.name) },
          {
            title: 'Work days',
            render: (r) =>
              ((r.days ?? []) as ScheduleDay[])
                .filter((d) => d.isWorkDay)
                .map((d) => weekdays[d.dayOfWeek])
                .join(', ') || 'Rest days',
          },
          {
            title: 'Typical hours',
            render: (r) =>
              [
                ...new Set(
                  ((r.days ?? []) as ScheduleDay[])
                    .filter((d) => d.isWorkDay)
                    .map(
                      (d) =>
                        `${d.startTime?.slice(0, 5)} – ${d.endTime?.slice(0, 5)}${d.endDayOffset ? ' next day' : ''}`,
                    ),
                ),
              ].join(', ') || '—',
          },
          { title: 'Status', render: (r) => label(r.status) },
          { title: 'Employees assigned', render: (r) => String(r.assignedEmployees) },
        ]}
      />
      <Pager page={page} total={query.data?.total ?? 0} onChange={setPage} />
      {selected && !editing && (
        <Inspector title={String(selected.name)} onClose={() => setSelected(null)}>
          <ErrorNotice error={detail.error} />
          {detail.isPending ? (
            <p>Loading details…</p>
          ) : (
            versions.map((v) => (
              <div key={v.id}>
                <h3 className="font-medium">
                  Effective {String(v.effectiveFrom)} · {String(v.timezone)}
                </h3>
                <p className="text-sm">{String(v.reason ?? '')}</p>
                <ul>
                  {(v.days as ScheduleDay[]).map((d) => (
                    <li key={d.dayOfWeek}>
                      {weekdays[d.dayOfWeek]}:{' '}
                      {d.isWorkDay
                        ? `${d.startTime} → ${d.endTime}${d.endDayOffset ? ' next day' : ''}, grace ${d.graceMinutes}m${d.breakStart ? `, break ${d.breakStart} → ${d.breakEnd}` : ''}`
                        : 'Rest day'}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {edit && detail.data && (
            <div className="flex gap-3">
              <button
                className="secondary-button"
                onClick={() => {
                  setDays((versions[0]?.days as ScheduleDay[]) ?? initialDays);
                  setSelected(detail.data!);
                  setEditing(true);
                }}
              >
                Add dated version
              </button>
              <button
                disabled={write.isPending}
                className="secondary-button"
                onClick={() =>
                  void write
                    .mutateAsync({
                      path: `schedules/${selected.id}/status`,
                      body: {
                        expectedRevision: detail.data!.revision,
                        status: detail.data!.status === 'active' ? 'inactive' : 'active',
                      },
                    })
                    .then(() => setSelected(null))
                    .catch(() => undefined)
                }
              >
                {detail.data.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          )}
          <ErrorNotice error={write.error} />
        </Inspector>
      )}
      {editing && (
        <div>
          <h2 className="mb-3 font-semibold">
            {selected ? 'New schedule version' : 'Create schedule'}
          </h2>
          <Form
            key={selected?.id ?? 'new'}
            pending={write.isPending}
            onSave={async (f) => {
              const input = scheduleInputSchema.parse({
                code: text(f, 'code'),
                name: text(f, 'name'),
                description: text(f, 'description') || null,
                status: selected?.status ?? 'active',
                effectiveFrom: text(f, 'effectiveFrom'),
                reason: text(f, 'reason') || null,
                days,
              });
              await write.mutateAsync({
                path: selected ? 'schedules/' + selected.id : 'schedules',
                method: selected ? 'PUT' : 'POST',
                body: { ...input, ...(selected ? { expectedRevision: selected.revision } : {}) },
              });
              setEditing(false);
              setSelected(null);
            }}
          >
            <Text label="Code" name="code" value={String(selected?.code ?? '')} required />
            <Text label="Schedule name" name="name" value={String(selected?.name ?? '')} required />
            <Text
              label="Description"
              name="description"
              value={String(selected?.description ?? '')}
            />
            <Text
              label="Effective date"
              name="effectiveFrom"
              type="date"
              value={org.date}
              required
            />
            <Text label="Reason (required for backdating)" name="reason" />
            <div className="col-span-full overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Day / Work day</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>End next day</th>
                    <th>Break start / next day</th>
                    <th>Break end / next day</th>
                    <th>Grace minutes</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={d.dayOfWeek}>
                      <td>
                        <label>
                          <input
                            type="checkbox"
                            checked={d.isWorkDay}
                            onChange={(e) =>
                              patchDay(
                                i,
                                e.target.checked
                                  ? { isWorkDay: true, startTime: '08:00', endTime: '17:00' }
                                  : { ...initialDays[i]! },
                              )
                            }
                          />
                          {weekdays[d.dayOfWeek]}
                        </label>
                      </td>
                      {(['startTime', 'endTime'] as const).map((k) => (
                        <td key={k}>
                          <input
                            aria-label={`${weekdays[d.dayOfWeek]} ${k}`}
                            type="time"
                            disabled={!d.isWorkDay}
                            value={d[k] ?? ''}
                            onChange={(e) => patchDay(i, { [k]: e.target.value || null })}
                          />
                        </td>
                      ))}
                      <td>
                        <input
                          aria-label={`${weekdays[d.dayOfWeek]} end next day`}
                          type="checkbox"
                          disabled={!d.isWorkDay}
                          checked={d.endDayOffset === 1}
                          onChange={(e) => patchDay(i, { endDayOffset: e.target.checked ? 1 : 0 })}
                        />
                      </td>
                      {(['breakStart', 'breakEnd'] as const).map((k) => (
                        <td key={k}>
                          <input
                            aria-label={`${weekdays[d.dayOfWeek]} ${k}`}
                            type="time"
                            disabled={!d.isWorkDay}
                            value={d[k] ?? ''}
                            onChange={(e) => patchDay(i, { [k]: e.target.value || null })}
                          />
                          <input
                            aria-label={`${weekdays[d.dayOfWeek]} ${k} next day`}
                            type="checkbox"
                            disabled={!d.isWorkDay}
                            checked={
                              d[
                                k === 'breakStart' ? 'breakStartDayOffset' : 'breakEndDayOffset'
                              ] === 1
                            }
                            onChange={(e) =>
                              patchDay(i, {
                                [k === 'breakStart' ? 'breakStartDayOffset' : 'breakEndDayOffset']:
                                  e.target.checked ? 1 : 0,
                              })
                            }
                          />
                        </td>
                      ))}
                      <td>
                        <input
                          aria-label={`${weekdays[d.dayOfWeek]} grace`}
                          type="number"
                          min="0"
                          max="240"
                          disabled={!d.isWorkDay}
                          value={d.graceMinutes}
                          onChange={(e) => patchDay(i, { graceMinutes: Number(e.target.value) })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Form>
          <button className="secondary-button mt-3" onClick={() => setEditing(false)}>
            Cancel editing
          </button>
        </div>
      )}
    </div>
  );
}

export function EmployeeSchedule({ employee }: { employee: FoundationRecord }) {
  const [correcting, setCorrecting] = useState<FoundationRecord | null>(null);
  const org = useOrganizationTime(),
    { session } = useAuth(),
    write = useWrite(),
    allowed = usePermission('schedules.assign'),
    canView = usePermission('schedules.view');
  const query = useQuery({
    queryKey: ['timekeeping', 'employee-schedules', employee.id, session?.accessToken],
    queryFn: () =>
      foundationRequest(`employees/${employee.id}/schedules`, session!.accessToken).then((v) =>
        z.array(z.object({ id: z.uuid() }).catchall(z.unknown())).parse(v),
      ),
    networkMode: 'always',
    enabled: canView,
  });
  const schedules = useRows('schedules?pageSize=100&status=active');
  if (!canView) return null;
  const current = query.data?.find(
    (a) =>
      String(a.effectiveFrom) <= org.date &&
      (a.effectiveTo === null || String(a.effectiveTo) > org.date),
  );
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Schedule</h2>
      <ErrorNotice error={query.error} />
      <p>
        Current schedule: {String(current?.scheduleName ?? 'Unassigned')}{' '}
        {current ? `· effective ${current.effectiveFrom}` : ''}
      </p>
      {current && (
        <p>
          Work days and hours:{' '}
          {((current.days ?? []) as ScheduleDay[])
            .filter((d) => d.isWorkDay)
            .map(
              (d) =>
                `${weekdays[d.dayOfWeek]} ${d.startTime} – ${d.endTime}${d.endDayOffset ? ' next day' : ''}`,
            )
            .join(', ')}
        </p>
      )}
      {query.data?.map((a) => (
        <p key={a.id}>
          {String(a.scheduleName)} · {String(a.effectiveFrom)} →{' '}
          {String(a.effectiveTo ?? 'ongoing')}
          {allowed && (
            <button className="text-action ml-3" onClick={() => setCorrecting(a)}>
              Correct assignment
            </button>
          )}
        </p>
      ))}
      {allowed && (
        <Form
          key={correcting?.id ?? 'new'}
          pending={write.isPending}
          onSave={async (f) => {
            const input = assignmentInputSchema.parse({
              scheduleId: text(f, 'scheduleId'),
              effectiveFrom: text(f, 'effectiveFrom'),
              effectiveTo: text(f, 'effectiveTo') || null,
              expectedRevision: correcting?.revision ?? employee.revision,
              reason: text(f, 'reason') || null,
            });
            await write.mutateAsync({
              path: correcting
                ? `schedule-assignments/${correcting.id}`
                : `employees/${employee.id}/schedules`,
              method: correcting ? 'PUT' : 'POST',
              body: input,
            });
            setCorrecting(null);
          }}
        >
          <Select
            label="Schedule"
            name="scheduleId"
            items={choices(schedules.data?.items)}
            value={correcting ? String(correcting.scheduleId) : undefined}
            required
          />
          <Text
            label="Effective from"
            name="effectiveFrom"
            type="date"
            value={correcting ? String(correcting.effectiveFrom) : org.date}
            required
          />
          <Text
            label="Effective to (exclusive, optional)"
            name="effectiveTo"
            type="date"
            value={String(correcting?.effectiveTo ?? '')}
          />
          <Text label="Reason" name="reason" required={!!correcting} />
        </Form>
      )}
      {correcting && (
        <button className="secondary-button" onClick={() => setCorrecting(null)}>
          Cancel correction
        </button>
      )}
    </section>
  );
}

export function TimeRecordsPage() {
  const org = useOrganizationTime(),
    [date, setDate] = useState(''),
    [employee, setEmployee] = useState(''),
    [department, setDepartment] = useState(''),
    [source, setSource] = useState(''),
    [type, setType] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<FoundationRecord | null>(null),
    [creating, setCreating] = useState(false),
    write = useWrite(),
    { session } = useAuth();
  const employees = useRows('employees?pageSize=100'),
    departments = useRows('departments?pageSize=100');
  const query = useRows(
    `time-records?page=${page}${date ? '&date=' + date : ''}${employee ? '&employeeId=' + employee : ''}${department ? '&departmentId=' + department : ''}${source ? '&source=' + source : ''}${type ? '&recordType=' + type : ''}`,
  );
  const detail = useQuery({
    queryKey: ['timekeeping', 'record', selected?.id, session?.accessToken],
    queryFn: () => readRecord('time-records/' + selected!.id, session!.accessToken),
    enabled: !!selected,
    networkMode: 'always',
  });
  const create = usePermission('time_records.create_manual'),
    correct = usePermission('time_records.correct');
  return (
    <div className="space-y-5">
      <p>Raw punch evidence and auditable corrections · {org.timezone ?? 'organization time'}.</p>
      <div className="panel grid gap-3 p-4 md:grid-cols-3">
        <Field label="Date">
          <input
            className="credential-input"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Employee">
          <select
            className="credential-input"
            value={employee}
            onChange={(e) => {
              setEmployee(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All employees</option>
            {choices(employees.data?.items).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select
            className="credential-input"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All departments</option>
            {choices(departments.data?.items).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select
            className="credential-input"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All sources</option>
            {['biometric', 'manual', 'import', 'system'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Record type">
          <select
            className="credential-input"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {['in', 'out', 'break_out', 'break_in', 'unknown'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        {create && (
          <button className="primary-button" onClick={() => setCreating(!creating)}>
            Add manual punch
          </button>
        )}
      </div>
      <ResultTable
        query={query}
        empty="No time records found."
        onRow={setSelected}
        columns={[
          { title: 'Employee', render: (r) => String(r.employeeName) },
          {
            title: 'Date / time',
            render: (r) =>
              org.timezone
                ? new Intl.DateTimeFormat('en-PH', {
                    timeZone: org.timezone,
                    dateStyle: 'medium',
                    timeStyle: 'medium',
                  }).format(new Date(String(r.effectiveRecordedAt ?? r.recordedAt)))
                : '…',
          },
          { title: 'Type', render: (r) => label(r.effectiveRecordType) },
          {
            title: 'Source',
            render: (r) => <span className="font-semibold">{String(r.source).toUpperCase()}</span>,
          },
          { title: 'Device', render: (r) => String(r.deviceName ?? '—') },
          {
            title: 'Status',
            render: (r) =>
              r.operation === 'void'
                ? 'Voided'
                : Number(r.correctionRevision) > 0
                  ? 'Corrected'
                  : 'Original',
          },
        ]}
      />
      <Pager page={page} total={query.data?.total ?? 0} onChange={setPage} />
      {creating && (
        <Form
          pending={write.isPending}
          onSave={async (f) => {
            const input = manualTimeRecordSchema.parse({
              employeeId: text(f, 'employeeId'),
              recordedAt: text(f, 'recordedAt'),
              recordType: text(f, 'recordType'),
              reason: text(f, 'reason'),
            });
            await write.mutateAsync({ path: 'time-records/manual', body: input });
            setCreating(false);
          }}
        >
          <Select
            label="Employee"
            name="employeeId"
            items={choices(employees.data?.items)}
            required
          />
          <Text
            label="Timestamp with offset (e.g. 2026-10-02T08:00:00+08:00)"
            name="recordedAt"
            required
          />
          <Select
            label="Record type"
            name="recordType"
            items={['in', 'out', 'break_out', 'break_in'].map((id) => ({ id, name: label(id) }))}
            required
          />
          <Text label="Reason" name="reason" required />
        </Form>
      )}
      {selected && (
        <Inspector title="Punch evidence" onClose={() => setSelected(null)}>
          <ErrorNotice error={detail.error} />
          {detail.data && (
            <>
              <p>
                Original: {String(detail.data.recordedAt)} · {label(detail.data.recordType)} ·{' '}
                {label(detail.data.source)}
              </p>
              <p>
                Created by {String(detail.data.createdBy)} · {String(detail.data.createdAt)}
              </p>
              <p>Reason: {String(detail.data.reason ?? '—')}</p>
              {((detail.data.corrections ?? []) as FoundationRecord[]).map((c) => (
                <p key={c.id}>
                  Correction {String(c.revision)}: {label(c.operation)} {String(c.recordedAt ?? '')}{' '}
                  {label(c.recordType)} · {String(c.reason)} · {String(c.createdBy)} ·{' '}
                  {String(c.createdAt)}
                </p>
              ))}
              {correct && (
                <Form
                  pending={write.isPending}
                  onSave={async (f) => {
                    const corrections = detail.data!.corrections as FoundationRecord[];
                    await write.mutateAsync({
                      path: `time-records/${selected.id}/corrections`,
                      body: {
                        operation: text(f, 'operation'),
                        recordedAt: text(f, 'recordedAt') || null,
                        recordType: text(f, 'recordType') || null,
                        reason: text(f, 'reason'),
                        expectedRevision: Number(corrections[0]?.revision ?? 0),
                      },
                    });
                  }}
                >
                  <Select
                    label="Operation"
                    name="operation"
                    items={[
                      { id: 'replace', name: 'Replace effective punch' },
                      { id: 'void', name: 'Void punch' },
                    ]}
                    required
                  />
                  <Text label="Replacement timestamp with offset" name="recordedAt" />
                  <Select
                    label="Replacement type"
                    name="recordType"
                    items={['in', 'out', 'break_out', 'break_in', 'unknown'].map((id) => ({
                      id,
                      name: label(id),
                    }))}
                  />
                  <Text label="Correction reason" name="reason" required />
                </Form>
              )}
            </>
          )}
        </Inspector>
      )}
    </div>
  );
}

export function LeavePage() {
  const org = useOrganizationTime(),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [employee, setEmployee] = useState(''),
    [leaveType, setLeaveType] = useState(''),
    [date, setDate] = useState(''),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [configure, setConfigure] = useState(false),
    [selectedType, setSelectedType] = useState<FoundationRecord | null>(null),
    write = useWrite();
  const employees = useRows('employees?pageSize=100'),
    types = useRows('leave-types?pageSize=100');
  const query = useRows(
    `leave?page=${page}&search=${encodeURIComponent(search)}${status ? '&status=' + status : ''}${employee ? '&employeeId=' + employee : ''}${leaveType ? '&leaveTypeId=' + leaveType : ''}${date ? '&date=' + date : ''}`,
  );
  const create = usePermission('leave.create'),
    config = usePermission('leave.configure'),
    approve = usePermission('leave.approve'),
    reject = usePermission('leave.reject'),
    cancel = usePermission('leave.cancel'),
    [selected, setSelected] = useState<FoundationRecord | null>(null);
  const row = selected ? (query.data?.items.find((r) => r.id === selected.id) ?? selected) : null;
  return (
    <div className="space-y-5">
      <p>Leave requests and approval workflows.</p>
      <div className="panel grid gap-3 p-4 md:grid-cols-3">
        <input
          aria-label="Search leave"
          className="credential-input"
          placeholder="Search employee"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Leave status"
          className="credential-input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['pending', 'approved', 'rejected', 'cancelled'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label="Filter leave employee"
          className="credential-input"
          value={employee}
          onChange={(e) => {
            setEmployee(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All employees</option>
          {choices(employees.data?.items).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter leave type"
          className="credential-input"
          value={leaveType}
          onChange={(e) => {
            setLeaveType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All leave types</option>
          {choices(types.data?.items).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <Field label="Covering date">
          <input
            className="credential-input"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        {create && (
          <button className="primary-button" onClick={() => setCreating(!creating)}>
            Create leave request
          </button>
        )}
        {config && (
          <button className="secondary-button" onClick={() => setConfigure(!configure)}>
            Configure leave types
          </button>
        )}
      </div>
      <ErrorNotice error={write.error} />
      <ResultTable
        query={query}
        empty="No leave requests found."
        onRow={setSelected}
        columns={[
          { title: 'Employee', render: (r) => String(r.employeeName) },
          { title: 'Leave type', render: (r) => String(r.leaveTypeName) },
          { title: 'Start', render: (r) => String(r.startDate) },
          { title: 'End', render: (r) => String(r.endDate) },
          { title: 'Duration', render: (r) => label(r.durationType) },
          { title: 'Status', render: (r) => label(r.status) },
          { title: 'Requested', render: (r) => String(r.requestedAt) },
        ]}
      />
      <Pager page={page} total={query.data?.total ?? 0} onChange={setPage} />
      {row && (
        <Inspector title="Leave request" onClose={() => setSelected(null)}>
          <p>
            {String(row.employeeName)} · {String(row.reason)}
          </p>
          <p>
            Requested by {String(row.requestedBy)} · {String(row.requestedAt)}
          </p>
          {['approved', 'rejected', 'cancelled'].map((k) =>
            row[k + 'At'] ? (
              <p key={k}>
                {label(k)} by {String(row[k + 'By'])} · {String(row[k + 'At'])}
              </p>
            ) : null,
          )}
          <p>Remarks: {String(row.remarks ?? '—')}</p>
          {(row.status === 'pending' || row.status === 'approved') && (
            <Form
              pending={write.isPending}
              onSave={async (f) => {
                await write.mutateAsync({
                  path: `leave/${row.id}/${text(f, 'action')}`,
                  body: { expectedRevision: row.revision, remarks: text(f, 'remarks') || null },
                });
                setSelected(null);
              }}
            >
              <Select
                label="Action"
                name="action"
                items={[
                  ...(row.status === 'pending' && approve
                    ? [{ id: 'approve', name: 'Approve' }]
                    : []),
                  ...(row.status === 'pending' && reject ? [{ id: 'reject', name: 'Reject' }] : []),
                  ...(cancel ? [{ id: 'cancel', name: 'Cancel' }] : []),
                ]}
                required
              />
              <Text label="Remarks (required for rejection)" name="remarks" />
            </Form>
          )}
        </Inspector>
      )}
      {creating && (
        <Form
          pending={write.isPending}
          onSave={async (f) => {
            const input = leaveInputSchema.parse({
              employeeId: text(f, 'employeeId'),
              leaveTypeId: text(f, 'leaveTypeId'),
              startDate: text(f, 'startDate'),
              endDate: text(f, 'endDate'),
              durationType: text(f, 'durationType'),
              reason: text(f, 'reason'),
            });
            await write.mutateAsync({ path: 'leave', body: input });
            setCreating(false);
          }}
        >
          <Select
            label="Employee"
            name="employeeId"
            items={choices(employees.data?.items)}
            required
          />
          <Select
            label="Leave type"
            name="leaveTypeId"
            items={choices(types.data?.items.filter((r) => r.status === 'active'))}
            required
          />
          <Text label="Start date" name="startDate" type="date" value={org.date} required />
          <Text label="End date" name="endDate" type="date" value={org.date} required />
          <Select
            label="Duration"
            name="durationType"
            items={['full_day', 'first_half', 'second_half'].map((id) => ({ id, name: label(id) }))}
            value="full_day"
            required
          />
          <Text label="Reason" name="reason" required />
        </Form>
      )}
      {configure && (
        <section className="space-y-3">
          <h2 className="font-semibold">Leave types</h2>
          <ErrorNotice error={types.error} />
          {types.data?.items.map((t) => (
            <button key={t.id} className="secondary-button mr-2" onClick={() => setSelectedType(t)}>
              {String(t.name)} · {String(t.status)}
            </button>
          ))}
          <button className="secondary-button" onClick={() => setSelectedType(null)}>
            New type
          </button>
          <Form
            key={selectedType?.id ?? 'new'}
            pending={write.isPending}
            onSave={async (f) => {
              const input = leaveTypeInputSchema.parse({
                code: text(f, 'code'),
                name: text(f, 'name'),
                description: text(f, 'description') || null,
                status: text(f, 'status'),
                paid: f.has('paid'),
                requiresApproval: f.has('requiresApproval'),
              });
              await write.mutateAsync({
                path: selectedType ? 'leave-types/' + selectedType.id : 'leave-types',
                method: selectedType ? 'PUT' : 'POST',
                body: {
                  ...input,
                  ...(selectedType ? { expectedRevision: selectedType.revision } : {}),
                },
              });
              setConfigure(false);
              setSelectedType(null);
            }}
          >
            <Text label="Code" name="code" value={String(selectedType?.code ?? '')} required />
            <Text label="Name" name="name" value={String(selectedType?.name ?? '')} required />
            <Text
              label="Description"
              name="description"
              value={String(selectedType?.description ?? '')}
            />
            <Select
              label="Status"
              name="status"
              value={String(selectedType?.status ?? 'active')}
              items={['active', 'inactive'].map((id) => ({ id, name: id }))}
              required
            />
            <label>
              <input type="checkbox" name="paid" defaultChecked={selectedType?.paid === true} />{' '}
              Paid
            </label>
            <label>
              <input
                type="checkbox"
                name="requiresApproval"
                defaultChecked={selectedType?.requiresApproval !== false}
              />{' '}
              Requires approval
            </label>
          </Form>
        </section>
      )}
    </div>
  );
}

export function PersistedAttendancePage() {
  const auth = useAuth();
  const processing = useQuery({
    queryKey: ['timekeeping', 'processing-summary', auth.session?.accessToken],
    queryFn: async () =>
      processingSummarySchema.parse(
        await foundationRequest('timekeeping/processing', auth.session!.accessToken),
      ),
    networkMode: 'always',
    refetchInterval: 10000,
  });
  const org = useOrganizationTime(),
    [date, setDate] = useState(''),
    [search, setSearch] = useState(''),
    [department, setDepartment] = useState(''),
    [schedule, setSchedule] = useState(''),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<FoundationRecord | null>(null),
    [reprocessing, setReprocessing] = useState(false),
    write = useWrite(),
    { session } = useAuth();
  const actualDate = date || org.date,
    departments = useRows('departments?pageSize=100'),
    schedules = useRows('schedules?pageSize=100');
  const query = useRows(
    `attendance?page=${page}${actualDate ? '&date=' + actualDate : ''}&search=${encodeURIComponent(search)}${status ? '&status=' + status : ''}${department ? '&departmentId=' + department : ''}${schedule ? '&scheduleId=' + schedule : ''}`,
  );
  const detail = useQuery({
    queryKey: ['timekeeping', 'attendance', selected?.id, session?.accessToken],
    queryFn: () => readRecord('attendance/' + selected!.id, session!.accessToken),
    enabled: !!selected,
    networkMode: 'always',
    refetchInterval: 10000,
  });
  const manage = usePermission('attendance.manage'),
    approve = usePermission('attendance.approve'),
    adjust = usePermission('attendance.adjust');
  const r = detail.data,
    result = r?.result as Record<string, unknown> | undefined;
  return (
    <div className="space-y-5">
      <p>
        Interpreted daily attendance · {org.timezone ?? 'organization time'}. Processing updates
        automatically.
      </p>
      <ErrorNotice error={org.error} />
      <ErrorNotice error={processing.error} />
      {processing.data && (
        <p className="text-sm">
          Pending processing jobs: {processing.data.pending}.{' '}
          {processing.data.failed > 0
            ? `${processing.data.failed} failed jobs require reprocessing.`
            : ''}
        </p>
      )}
      <div className="panel grid gap-3 p-4 md:grid-cols-3">
        <Field label="Work date">
          <input
            className="credential-input"
            type="date"
            value={actualDate}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Search employee">
          <input
            className="credential-input"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Field>
        <Field label="Attendance status">
          <select
            className="credential-input"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['present', 'late', 'absent', 'on_leave', 'rest_day', 'incomplete'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select
            className="credential-input"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All departments</option>
            {choices(departments.data?.items).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Schedule">
          <select
            className="credential-input"
            value={schedule}
            onChange={(e) => {
              setSchedule(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All schedules</option>
            {choices(schedules.data?.items).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        {manage && (
          <button className="secondary-button" onClick={() => setReprocessing(!reprocessing)}>
            Reprocess attendance
          </button>
        )}
      </div>
      <ResultTable
        query={query}
        empty="No attendance records for this date."
        onRow={setSelected}
        columns={[
          { title: 'Employee', render: (r) => String(r.employeeName) },
          { title: 'Schedule', render: (r) => String(r.scheduleName ?? 'Unassigned') },
          { title: 'Time in', render: (r) => formatTime(r.firstIn as string | null, org.timezone) },
          {
            title: 'Time out',
            render: (r) => formatTime(r.lastOut as string | null, org.timezone),
          },
          { title: 'Worked', render: (r) => minutesLabel(Number(r.workedMinutes)) },
          { title: 'Late', render: (r) => minutesLabel(Number(r.lateMinutes)) },
          { title: 'Undertime', render: (r) => minutesLabel(Number(r.undertimeMinutes)) },
          { title: 'Status', render: (r) => label(r.attendanceStatus) },
          { title: 'Approval', render: (r) => label(r.approvalStatus) },
        ]}
      />
      <Pager page={page} total={query.data?.total ?? 0} onChange={setPage} />
      {reprocessing && (
        <Form
          pending={write.isPending}
          onSave={async (f) => {
            await write.mutateAsync({
              path: 'attendance/reprocess',
              body: {
                startDate: text(f, 'startDate'),
                endDate: text(f, 'endDate'),
                reason: text(f, 'reason'),
              },
            });
            setReprocessing(false);
          }}
        >
          <Text label="Start date" name="startDate" type="date" value={actualDate} required />
          <Text label="End date" name="endDate" type="date" value={actualDate} required />
          <Text label="Reason" name="reason" required />
        </Form>
      )}
      {selected && (
        <Inspector
          title={`${String(selected.employeeName)} · ${String(selected.workDate)}`}
          onClose={() => setSelected(null)}
        >
          <ErrorNotice error={detail.error} />
          <ErrorNotice error={write.error} />
          {r && result && (
            <>
              <p>
                {label(r.attendanceStatus)} · {label(r.approvalStatus)} · Worked{' '}
                {minutesLabel(Number(r.workedMinutes))}, late {minutesLabel(Number(r.lateMinutes))},
                undertime {minutesLabel(Number(r.undertimeMinutes))}
              </p>
              <p>
                Review flags:{' '}
                {Array.isArray(result.flags) && result.flags.length
                  ? result.flags.map(label).join(', ')
                  : 'None'}
              </p>
              <p>
                {result.complete
                  ? 'Shift processing window closed'
                  : 'Shift processing window is open'}
              </p>
              <h3 className="font-semibold">Underlying time records</h3>
              <ul>
                {((result.evidence ?? []) as FoundationRecord[]).map((p) => (
                  <li key={p.id}>
                    {String(p.effectiveRecordedAt ?? p.recordedAt)} · {label(p.effectiveRecordType)}{' '}
                    · {String(p.source).toUpperCase()} {p.operation ? `· ${p.operation}` : ''}
                  </li>
                ))}
              </ul>
              <h3 className="font-semibold">Approved leave</h3>
              <ul>
                {((result.leaves ?? []) as FoundationRecord[]).map((l) => (
                  <li key={l.id}>
                    {String(l.startDate)} → {String(l.endDate)} · {label(l.durationType)}
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                {approve && (
                  <button
                    className="primary-button"
                    disabled={
                      write.isPending ||
                      !result.complete ||
                      r.attendanceStatus === 'incomplete' ||
                      (Array.isArray(result.flags) && result.flags.length > 0) ||
                      r.approvalStatus === 'approved'
                    }
                    onClick={() =>
                      void write
                        .mutateAsync({
                          path: `attendance/${r.id}/approve`,
                          body: { expectedRevision: r.revision },
                        })
                        .catch(() => undefined)
                    }
                  >
                    Approve attendance
                  </button>
                )}
                {manage && r.approvalStatus === 'approved' && (
                  <button
                    className="secondary-button"
                    disabled={write.isPending}
                    onClick={() =>
                      void write
                        .mutateAsync({
                          path: `attendance/${r.id}/reopen`,
                          body: { expectedRevision: r.revision },
                        })
                        .catch(() => undefined)
                    }
                  >
                    Reopen for review
                  </button>
                )}
              </div>
              {adjust && (
                <Form
                  pending={write.isPending}
                  onSave={async (f) => {
                    const overrides: Record<string, unknown> = {};
                    for (const k of ['workedMinutes', 'lateMinutes', 'undertimeMinutes'])
                      if (text(f, k) !== '') overrides[k] = Number(text(f, k));
                    if (text(f, 'attendanceStatus'))
                      overrides.attendanceStatus = text(f, 'attendanceStatus');
                    await write.mutateAsync({
                      path: `attendance/${r.id}/adjustments`,
                      body: { expectedRevision: r.revision, reason: text(f, 'reason'), overrides },
                    });
                  }}
                >
                  <Text label="Worked minutes override" name="workedMinutes" type="number" />
                  <Text label="Late minutes override" name="lateMinutes" type="number" />
                  <Text label="Undertime minutes override" name="undertimeMinutes" type="number" />
                  <Select
                    label="Status override"
                    name="attendanceStatus"
                    items={['present', 'late', 'absent', 'on_leave', 'rest_day', 'incomplete'].map(
                      (id) => ({ id, name: label(id) }),
                    )}
                  />
                  <Text label="Adjustment reason" name="reason" required />
                </Form>
              )}
              <details>
                <summary>Calculation, schedule snapshot, and history</summary>
                <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(
                    { result, history: r.history, adjustments: r.adjustments },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </>
          )}
        </Inspector>
      )}
    </div>
  );
}
