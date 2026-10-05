import { useState, useRef } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  formatPeso,
  decimalStringToCentavos,
  payrollPeriodResponseSchema,
  payrollDetailResponseSchema,
  payrollResultDetailSchema,
  type payrollTotalsSchema,
  statutoryImportSchema,
  statutoryRulesSchema,
  payrollPolicySchema,
  type PayrollIssue,
} from '@hexpayroll/shared';
import { foundationRequest } from '../api/foundation';
import { useAuth } from '../auth/AuthProvider';
import { usePermission } from './FoundationPages';

const inputClass = 'credential-input';
function Field({
  label,
  name,
  type = 'text',
  required = true,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className={inputClass}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
      />
    </label>
  );
}
function ErrorMessage({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="notice">
      {error.message}
    </p>
  ) : null;
}
function Issues({ issues }: { issues: PayrollIssue[] }) {
  return issues.length ? (
    <ul className="space-y-2 text-sm" aria-label="Payroll validation issues">
      {issues.map((i, n) => (
        <li key={n} className={i.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>
          {i.severity.toUpperCase()}: {i.message}
        </li>
      ))}
    </ul>
  ) : null;
}
function Status({ value }: { value: string }) {
  return (
    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold">
      {value.replaceAll('_', ' ').toUpperCase()}
    </span>
  );
}
function Totals({ totals }: { totals: z.infer<typeof payrollTotalsSchema> | undefined | null }) {
  return totals ? (
    <div className="grid gap-3 sm:grid-cols-4">
      <p>
        Employees
        <br />
        <strong>{totals.employees}</strong>
      </p>
      <p>
        Gross pay
        <br />
        <strong>{formatPeso(totals.grossPay)}</strong>
      </p>
      <p>
        Deductions
        <br />
        <strong>{formatPeso(totals.totalDeductions)}</strong>
      </p>
      <p>
        Net pay
        <br />
        <strong>{formatPeso(totals.netPay)}</strong>
      </p>
    </div>
  ) : (
    <p>No payroll computation yet.</p>
  );
}
function usePayrollMutation() {
  const { session } = useAuth(),
    cache = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      foundationRequest('payroll/' + path, session!.accessToken, 'POST', body, 120000),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['payroll'] }),
    networkMode: 'always',
    retry: false,
  });
}

export function PayrollPeriodsPage() {
  const { session } = useAuth(),
    create = usePermission('payroll.create_period'),
    [show, setShow] = useState(false),
    mutation = usePayrollMutation();
  const query = useQuery({
    queryKey: ['payroll', 'periods', session?.accessToken],
    queryFn: async () =>
      z
        .array(payrollPeriodResponseSchema)
        .parse(await foundationRequest('payroll/periods', session!.accessToken)),
    networkMode: 'always',
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    mutation.mutate(
      { path: 'periods', body: Object.fromEntries(form) },
      { onSuccess: () => setShow(false) },
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex justify-between">
        <h1 className="text-xl font-semibold">Payroll Periods</h1>
        {create && (
          <button className="primary-button" onClick={() => setShow(!show)}>
            Create Period
          </button>
        )}
      </div>
      {show && (
        <form onSubmit={submit} className="panel grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Period code" name="code" />
          <Field label="Period name" name="name" />
          <label>
            Pay frequency
            <select name="payFrequency" className={inputClass}>
              <option value="semi_monthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
            </select>
          </label>
          <Field label="Start date" name="periodStart" type="date" />
          <Field label="End date" name="periodEnd" type="date" />
          <Field label="Pay date" name="payDate" type="date" />
          <button className="primary-button" disabled={mutation.isPending}>
            Create period
          </button>
        </form>
      )}
      <ErrorMessage error={mutation.error ?? query.error} />
      {query.isPending ? (
        <p>Loading payroll periods…</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  'Period',
                  'Start',
                  'End',
                  'Pay Date',
                  'Employees',
                  'Gross Pay',
                  'Deductions',
                  'Net Pay',
                  'Status',
                  'Actions',
                ].map((t) => (
                  <th key={t} className="p-3">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data?.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3">
                    {p.name}
                    <br />
                    <small>{p.code}</small>
                  </td>
                  <td>{p.period_start}</td>
                  <td>{p.period_end}</td>
                  <td>{p.pay_date}</td>
                  <td>{p.totals?.employees ?? '—'}</td>
                  <td>{p.totals ? formatPeso(p.totals.grossPay) : '—'}</td>
                  <td>{p.totals ? formatPeso(p.totals.totalDeductions) : '—'}</td>
                  <td>{p.totals ? formatPeso(p.totals.netPay) : '—'}</td>
                  <td>
                    <Status value={p.status} />
                  </td>
                  <td>
                    <Link className="text-action" to={'/payroll/periods/' + p.id}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.data?.length === 0 && <p className="p-5">No payroll periods yet.</p>}
        </div>
      )}
    </div>
  );
}
export function PayrollReviewPage() {
  const { periodId, runId } = useParams(),
    { session } = useAuth(),
    mutation = usePayrollMutation(),
    [ack, setAck] = useState<string[]>([]),
    [confirm, setConfirm] = useState(false);
  const prepare = usePermission('payroll.create_period'),
    compute = usePermission('payroll.compute'),
    recompute = usePermission('payroll.recompute'),
    review = usePermission('payroll.review'),
    finalize = usePermission('payroll.finalize');
  const requestKeys = useRef<Record<string, string>>({});
  const query = useQuery({
    queryKey: ['payroll', 'period', periodId, runId, session?.accessToken],
    queryFn: async () =>
      payrollDetailResponseSchema.parse(
        await foundationRequest(
          'payroll/periods/' + periodId + (runId ? '/runs/' + runId : ''),
          session!.accessToken,
        ),
      ),
    networkMode: 'always',
    refetchInterval: 15000,
  });
  const data = query.data,
    p = data?.period,
    run = data?.runs.find((r) => r.id === (runId ?? p?.latest_run_id));
  function action(name: string) {
    if (!p) return;
    const requestIdentity = `${p.id}:${p.revision}:${name}`;
    const idempotencyKey = (requestKeys.current[requestIdentity] ??= crypto.randomUUID());
    mutation.mutate(
      {
        path: `periods/${p.id}/${name}`,
        body: {
          expectedRevision: p.revision,
          warningAcknowledgments: ack,
          ...(name === 'compute' || name === 'recompute' ? { idempotencyKey } : {}),
        },
      },
      {
        onSuccess: () => {
          setConfirm(false);
          if (name === 'compute' || name === 'recompute') setAck([]);
        },
      },
    );
  }
  const blocked = data?.stale || run?.status !== 'computed',
    closed = !!runId || p?.status === 'finalized' || p?.status === 'cancelled';
  return (
    <div className="space-y-5">
      <Link className="text-action" to="/payroll/periods">
        ← Payroll periods
      </Link>
      <ErrorMessage error={query.error ?? mutation.error} />
      {p && (
        <>
          <div className="panel space-y-4 p-5">
            <h1 className="text-xl font-semibold">{p.name}</h1>
            <p>
              {p.period_start} – {p.period_end} · Pay date {p.pay_date}
            </p>
            <Status
              value={
                runId
                  ? p.status === 'finalized' && runId === p.latest_run_id
                    ? 'finalized'
                    : (run?.status ?? 'processing')
                  : data?.stale
                    ? 'Recompute required'
                    : p.status
              }
            />
            {runId && <p className="text-sm">Historical run</p>}
            <Totals totals={run?.totals} />
            {run?.status === 'failed' && (
              <p className="notice">
                Draft figures are incomplete while calculation errors remain.
              </p>
            )}
            <p className="text-sm">
              Prepared by: {run?.prepared_by ?? '—'}
              {(!runId || runId === p.latest_run_id) && (
                <>
                  {' '}
                  · Reviewed by: {p.reviewed_by ?? '—'} · Finalized by: {p.finalized_by ?? '—'}
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-3">
              {!closed && (
                <>
                  {p.status === 'draft' && prepare && (
                    <button
                      className="primary-button"
                      disabled={mutation.isPending}
                      onClick={() => action('open')}
                    >
                      Open period
                    </button>
                  )}
                  {p.status === 'open' && !p.latest_run_id && compute && (
                    <button
                      className="primary-button"
                      disabled={mutation.isPending}
                      onClick={() => action('compute')}
                    >
                      Compute
                    </button>
                  )}
                  {p.latest_run_id && recompute && (
                    <button
                      className="primary-button"
                      disabled={mutation.isPending}
                      onClick={() => action('recompute')}
                    >
                      Recompute
                    </button>
                  )}
                  {p.status === 'review' && review && (
                    <button
                      className="primary-button"
                      disabled={mutation.isPending || blocked}
                      onClick={() => action('review')}
                    >
                      Mark reviewed
                    </button>
                  )}
                  {p.status === 'review' && finalize && (
                    <button
                      className="primary-button"
                      disabled={
                        mutation.isPending || blocked || p.reviewed_run_id !== p.latest_run_id
                      }
                      onClick={() => setConfirm(true)}
                    >
                      Finalize
                    </button>
                  )}
                  {prepare && (
                    <button
                      className="text-action"
                      disabled={mutation.isPending}
                      onClick={() => action('cancel')}
                    >
                      Cancel period
                    </button>
                  )}
                </>
              )}
            </div>
            {confirm && (
              <div role="dialog" aria-label="Finalize payroll" className="notice">
                <p>
                  Finalize this payroll? Results and calculation snapshots will become immutable.
                </p>
                <button
                  className="primary-button"
                  disabled={mutation.isPending}
                  onClick={() => action('finalize')}
                >
                  Confirm finalization
                </button>
                <button className="ml-4 text-action" onClick={() => setConfirm(false)}>
                  Keep reviewing
                </button>
              </div>
            )}
            {data?.stale && (
              <p role="alert">Payroll inputs changed. Recompute and review the latest run.</p>
            )}
            <Issues issues={run?.issues ?? []} />
            {run?.issues
              .filter((i) => i.severity === 'warning')
              .map((i, n) => (
                <label className="block" key={n}>
                  <input
                    type="checkbox"
                    checked={ack.includes(i.code)}
                    onChange={(e) =>
                      setAck(e.target.checked ? [...ack, i.code] : ack.filter((v) => v !== i.code))
                    }
                  />{' '}
                  Acknowledge: {i.message}
                </label>
              ))}
          </div>
          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    'Employee',
                    'Gross pay',
                    'Deductions',
                    'Employee contributions',
                    'Employer contributions',
                    'Tax',
                    'Net pay',
                    'Status',
                  ].map((t) => (
                    <th key={t} className="p-3">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.results.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-3">
                      <Link className="text-action" to={`/payroll/periods/${p.id}/results/${r.id}`}>
                        {r.employee_number} · {r.first_name} {r.last_name}
                      </Link>
                    </td>
                    {[
                      r.gross_pay,
                      r.total_deductions,
                      r.employee_contributions,
                      r.employer_contributions,
                      r.withholding_tax,
                      r.net_pay,
                    ].map((v, i) => (
                      <td key={i}>{formatPeso(v)}</td>
                    ))}
                    <td>
                      <Status
                        value={
                          p.status === 'finalized' && (!runId || runId === p.latest_run_id)
                            ? 'finalized'
                            : r.status
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="panel p-5">
            <h2 className="font-semibold">Computation history</h2>
            {data?.runs.map((r) => (
              <div className="mt-3" key={r.id}>
                <p>
                  {r.created_at} · {r.engine_version} · <Status value={r.status} />
                </p>
                <Totals totals={r.totals} />
                <Link className="text-action" to={`/payroll/periods/${p.id}/runs/${r.id}`}>
                  Inspect historical run
                </Link>
              </div>
            ))}
          </section>
        </>
      )}
      {query.isPending && <p>Loading payroll…</p>}
    </div>
  );
}
export function EmployeePayrollPage() {
  const { periodId, resultId } = useParams(),
    { session } = useAuth();
  const query = useQuery({
    queryKey: ['payroll', 'result', resultId, session?.accessToken],
    queryFn: async () =>
      payrollResultDetailSchema.parse(
        await foundationRequest(
          `payroll/periods/${periodId}/results/${resultId}`,
          session!.accessToken,
        ),
      ),
    networkMode: 'always',
  });
  const r = query.data;
  return (
    <div className="space-y-5">
      <Link className="text-action" to={'/payroll/periods/' + periodId}>
        ← Payroll review
      </Link>
      <ErrorMessage error={query.error} />
      {r && (
        <>
          <section className="panel space-y-3 p-5">
            <h1 className="text-xl font-semibold">Employee payroll</h1>
            <p>
              {r.employee_id} · {r.period_start} – {r.period_end} · Pay date {r.pay_date}
            </p>
            <p>Engine {r.engine_version}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <p>Basic pay: {formatPeso(r.basic_pay)}</p>
              <p>Gross pay: {formatPeso(r.gross_pay)}</p>
              <p>
                Net pay: <strong>{formatPeso(r.net_pay)}</strong>
              </p>
              <p>Total deductions: {formatPeso(r.total_deductions)}</p>
              <p>Taxable compensation: {formatPeso(r.taxable_compensation)}</p>
              <p>
                Withholding tax:{' '}
                {r.issues.some((i) => ['MISSING_BIR_RULE', 'UNSUPPORTED_TAX_RULE'].includes(i.code))
                  ? 'Awaiting configured rule'
                  : formatPeso(r.withholding_tax)}
              </p>
            </div>
            <Issues issues={r.issues} />
          </section>
          {(
            [
              ['Earnings', r.payroll_earning_lines],
              ['Deductions', r.payroll_deduction_lines],
            ] as const
          ).map(([title, lines]) => (
            <section className="panel p-5" key={title}>
              <h2 className="font-semibold">{title}</h2>
              {lines.map((line) => (
                <div key={line.id} className="border-b py-3">
                  <div className="flex justify-between">
                    <span>
                      {line.description} {title === 'Earnings' && !line.taxable && '(Non-taxable)'}
                    </span>
                    <strong>{formatPeso(line.amount)}</strong>
                  </div>
                  <details className="mt-2 text-sm">
                    <summary>Calculation details</summary>
                    <pre className="overflow-auto">{JSON.stringify(line.metadata, null, 2)}</pre>
                  </details>
                </div>
              ))}
            </section>
          ))}
          <section className="panel p-5">
            <h2 className="font-semibold">Government contributions</h2>
            {r.payroll_contribution_lines.map((line) => (
              <div key={line.id} className="border-b py-3">
                <p>
                  {line.type.toUpperCase()} · Employee: {formatPeso(line.employee_share)} ·
                  Employer: {formatPeso(line.employer_share)} · Basis:{' '}
                  {formatPeso(line.basis_amount)}
                </p>
                <details>
                  <summary>Applied rule and trace</summary>
                  <pre className="overflow-auto text-sm">
                    {JSON.stringify(line.metadata, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
          </section>
          <section className="panel p-5">
            <details>
              <summary>Withholding tax trace</summary>
              <pre className="overflow-auto text-sm">{JSON.stringify(r.tax_trace, null, 2)}</pre>
            </details>
            <details className="mt-4">
              <summary>Preserved payroll inputs</summary>
              <pre className="overflow-auto text-sm">{JSON.stringify(r.snapshot, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
      {query.isPending && <p>Loading employee payroll…</p>}
    </div>
  );
}
const typeSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(['earning', 'deduction']),
  taxable: z.boolean(),
  active: z.boolean(),
  revision: z.number(),
});
const entrySchema = z.object({
  id: z.uuid(),
  employee_number: z.string(),
  name: z.string(),
  amount: z.coerce.number(),
  reason: z.string(),
  period_id: z.uuid().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  active: z.boolean(),
  revision: z.number(),
});
const employeeChoice = z.object({
  id: z.uuid(),
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});
export function PayrollEntriesPage({ kind }: { kind: 'earning' | 'deduction' }) {
  const { session } = useAuth(),
    manage = usePermission(kind === 'earning' ? 'earnings.manage' : 'deductions.manage'),
    employeeView = usePermission('employees.view'),
    mutation = usePayrollMutation(),
    [recurring, setRecurring] = useState(false),
    [employeeSearch, setEmployeeSearch] = useState('');
  const types = useQuery({
    queryKey: ['payroll', 'types', kind, session?.accessToken],
    queryFn: async () =>
      z
        .array(typeSchema)
        .parse(await foundationRequest('payroll/types?kind=' + kind, session!.accessToken)),
    networkMode: 'always',
  });
  const entries = useQuery({
    queryKey: ['payroll', 'entries', kind, session?.accessToken],
    queryFn: async () =>
      z
        .array(entrySchema)
        .parse(await foundationRequest('payroll/entries?kind=' + kind, session!.accessToken)),
    networkMode: 'always',
  });
  const employees = useQuery({
    queryKey: ['payroll', 'employees', employeeSearch, session?.accessToken],
    queryFn: async () =>
      z
        .object({ items: z.array(employeeChoice) })
        .parse(
          await foundationRequest(
            'employees?pageSize=100&search=' + encodeURIComponent(employeeSearch),
            session!.accessToken,
          ),
        ),
    enabled: employeeView,
    networkMode: 'always',
  });
  const periods = useQuery({
    queryKey: ['payroll', 'periods', session?.accessToken],
    queryFn: async () =>
      z
        .array(payrollPeriodResponseSchema)
        .parse(await foundationRequest('payroll/periods', session!.accessToken)),
    enabled: session?.user.permissions?.includes('payroll.view'),
    networkMode: 'always',
  });
  function addType(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    mutation.mutate({
      path: 'types',
      body: { kind, code: f.get('code'), name: f.get('name'), taxable: f.get('taxable') === 'on' },
    });
  }
  function addEntry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      mutation.mutate({
        path: 'entries',
        body: {
          employeeId: f.get('employeeId'),
          typeId: f.get('typeId'),
          amount: decimalStringToCentavos(String(f.get('amount'))),
          reason: f.get('reason'),
          periodId: recurring ? null : f.get('periodId'),
          startDate: recurring ? f.get('startDate') : null,
          endDate: recurring ? f.get('endDate') || null : null,
        },
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Invalid amount');
    }
  }
  const [localError, setLocalError] = useState('');
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{kind === 'earning' ? 'Earnings' : 'Deductions'}</h1>
      <ErrorMessage error={mutation.error ?? types.error ?? entries.error} />
      {localError && <p role="alert">{localError}</p>}
      {manage && (
        <div className="grid gap-5 lg:grid-cols-2">
          <form onSubmit={addType} className="panel space-y-3 p-5">
            <h2 className="font-semibold">Create {kind} type</h2>
            <Field label="Code" name="code" />
            <Field label="Name" name="name" />
            {kind === 'earning' && (
              <label>
                <input name="taxable" type="checkbox" defaultChecked /> Taxable earning
              </label>
            )}
            <button className="primary-button" disabled={mutation.isPending}>
              Save type
            </button>
          </form>
          <form onSubmit={addEntry} className="panel space-y-3 p-5">
            <h2 className="font-semibold">Assign {kind}</h2>
            {employeeView && (
              <label className="block">
                Search employees
                <input
                  className={inputClass}
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="Employee number or name"
                />
              </label>
            )}
            {employeeView ? (
              <label>
                Employee
                <select className={inputClass} name="employeeId" required>
                  <option value="">Select employee</option>
                  {employees.data?.items.map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.employeeNumber} · {e.firstName} {e.lastName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <Field label="Employee ID" name="employeeId" />
            )}
            <label>
              Type
              <select className={inputClass} name="typeId" required>
                <option value="">Select type</option>
                {types.data
                  ?.filter((t) => t.active)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field label="Amount (PHP)" name="amount" />
            <Field label="Reason" name="reason" />
            <label>
              <input
                type="checkbox"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
              />{' '}
              Recurring each eligible payroll period
            </label>
            {recurring ? (
              <>
                <Field label="Start date" name="startDate" type="date" />
                <Field label="Optional end date" name="endDate" type="date" required={false} />
              </>
            ) : (
              <label>
                Payroll period
                <select className={inputClass} name="periodId" required>
                  <option value="">Select period</option>
                  {periods.data
                    ?.filter((p) => !['finalized', 'cancelled'].includes(p.status))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button className="primary-button" disabled={mutation.isPending}>
              Save assignment
            </button>
          </form>
        </div>
      )}
      <section className="panel p-5">
        <h2 className="font-semibold">Types</h2>
        {types.data?.map((t) => (
          <p key={t.id}>
            {t.code} · {t.name} {kind === 'earning' && (t.taxable ? '· Taxable' : '· Non-taxable')}
            {!t.active && ' · Inactive'}
            {manage && (
              <button
                className="ml-3 text-action"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    path: `types/${t.id}/status`,
                    body: { active: !t.active, expectedRevision: t.revision },
                  })
                }
              >
                {t.active ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </p>
        ))}
      </section>
      <section className="panel p-5">
        <h2 className="font-semibold">Assignments</h2>
        {entries.data?.map((e) => (
          <div className="flex justify-between border-b py-3" key={e.id}>
            <div>
              {e.employee_number} · {e.name} · {formatPeso(e.amount)}
              <p className="text-sm">
                {e.period_id
                  ? 'One-time payroll entry'
                  : `${e.start_date} – ${e.end_date ?? 'ongoing'}`}{' '}
                · {e.reason} {!e.active && '· Inactive'}
              </p>
            </div>
            {manage && e.active && (
              <button
                className="text-action"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    path: `entries/${e.id}/deactivate`,
                    body: { expectedRevision: e.revision },
                  })
                }
              >
                Deactivate
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
const policyVersionSchema = z.object({
  id: z.uuid(),
  version: z.string(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  policy: payrollPolicySchema,
});
export function PayrollPolicyPage() {
  const { session } = useAuth(),
    manage = usePermission('payroll_config.update'),
    mutation = usePayrollMutation();
  const query = useQuery({
    queryKey: ['payroll', 'policies', session?.accessToken],
    queryFn: async () =>
      z
        .array(policyVersionSchema)
        .parse(await foundationRequest('payroll/policies', session!.accessToken)),
    networkMode: 'always',
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    mutation.mutate({
      path: 'policies',
      body: {
        version: f.get('version'),
        effectiveFrom: f.get('effectiveFrom'),
        effectiveTo: f.get('effectiveTo'),
        supersedesId: f.get('supersedesId') || null,
        policy: {
          monthlyAllocation: f.get('monthlyAllocation'),
          prorationBasis: f.get('prorationBasis'),
          monthlyDailyDivisor: {
            numerator: f.get('divisorNumerator'),
            denominator: f.get('divisorDenominator'),
          },
          standardMinutesPerDay: Number(f.get('standardMinutesPerDay')),
          deductLate: f.get('deductLate') === 'on',
          deductUndertime: f.get('deductUndertime') === 'on',
          deductAbsence: f.get('deductAbsence') === 'on',
          contributionCutoff: f.get('contributionCutoff'),
        },
      },
    });
  }
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Payroll Monetary Policies</h1>
      <p>
        Company-approved monetary policies are required before payroll computation. Contents are
        immutable. A new version can explicitly supersede an earlier window when finalized history
        is unaffected. End dates are exclusive.
      </p>
      <ErrorMessage error={query.error ?? mutation.error} />
      {manage && (
        <form className="panel grid gap-4 p-5 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Version" name="version" />
          <Field label="Effective from" name="effectiveFrom" type="date" />
          <Field label="Effective to (exclusive)" name="effectiveTo" type="date" />
          <label>
            Supersede existing policy at the new start date
            <select className={inputClass} name="supersedesId">
              <option value="">No predecessor</option>
              {query.data?.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.version} · {p.effective_from} – {p.effective_to ?? 'ongoing'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Monthly allocation
            <select name="monthlyAllocation" className={inputClass}>
              <option value="calendar_month">
                Monthly / equal semi-monthly cutoffs; calendar share for weekly
              </option>
              <option value="annual_periods">Annual salary divided by periods per year</option>
            </select>
          </label>
          <label>
            Hire, termination, and rate-change proration
            <select name="prorationBasis" className={inputClass}>
              <option value="calendar_days">Calendar days in cutoff</option>
              <option value="scheduled_minutes">Scheduled minutes in cutoff</option>
            </select>
          </label>
          <Field label="Monthly daily divisor numerator" name="divisorNumerator" type="number" />
          <Field
            label="Monthly daily divisor denominator"
            name="divisorDenominator"
            type="number"
          />
          <Field label="Standard paid minutes per day" name="standardMinutesPerDay" type="number" />
          {['deductLate', 'deductUndertime', 'deductAbsence'].map((name, i) => (
            <label key={name}>
              <input name={name} type="checkbox" />{' '}
              {['Deduct late time', 'Deduct undertime', 'Deduct absences'][i]}
            </label>
          ))}
          <label>
            Monthly contribution collection
            <select name="contributionCutoff" className={inputClass}>
              <option value="last_period_of_month">Last period of month</option>
              <option value="every_period">Every period, reconcile month-to-date obligation</option>
            </select>
          </label>
          <button className="primary-button" disabled={mutation.isPending}>
            Create policy version
          </button>
        </form>
      )}
      {query.data?.map((p) => (
        <section className="panel p-5" key={p.id}>
          <h2 className="font-semibold">
            {p.version} · {p.effective_from} – {p.effective_to ?? 'ongoing'}
          </h2>
          <p>
            {p.policy.monthlyAllocation} · {p.policy.prorationBasis} · Daily divisor{' '}
            {p.policy.monthlyDailyDivisor.numerator}/{p.policy.monthlyDailyDivisor.denominator} ·{' '}
            {p.policy.standardMinutesPerDay} minutes/day
          </p>
          <p>Monthly contribution cutoff: {p.policy.contributionCutoff}</p>
        </section>
      ))}
    </div>
  );
}
const ruleVersionSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  version: z.string(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  status: z.string(),
  agency: z.string(),
  source_title: z.string(),
  source_reference: z.string(),
  verification_note: z.string(),
  content_checksum: z.string(),
  verified_by: z.string().nullable(),
  revision: z.number(),
  rules: statutoryRulesSchema,
});
export function StatutoryRulesPage() {
  const { session } = useAuth(),
    contributionView = usePermission('contributions.view'),
    taxView = usePermission('tax.view'),
    contributionManage = usePermission('contributions.configure'),
    taxManage = usePermission('tax.configure'),
    mutation = usePayrollMutation(),
    [json, setJson] = useState(''),
    [error, setError] = useState('');
  const contributions = useQuery({
    queryKey: ['payroll', 'rules', 'contributions', session?.accessToken],
    queryFn: async () =>
      z
        .array(ruleVersionSchema)
        .parse(await foundationRequest('payroll/rules', session!.accessToken)),
    enabled: contributionView,
    networkMode: 'always',
  });
  const taxes = useQuery({
    queryKey: ['payroll', 'rules', 'tax', session?.accessToken],
    queryFn: async () =>
      z
        .array(ruleVersionSchema)
        .parse(await foundationRequest('payroll/rules?kind=deduction', session!.accessToken)),
    enabled: taxView,
    networkMode: 'always',
  });
  const ruleRows = [...(contributions.data ?? []), ...(taxes.data ?? [])];
  const predecessor = (rule: z.infer<typeof ruleVersionSchema>) =>
    ruleRows.find(
      (old) =>
        old.status === 'active' &&
        old.type === rule.type &&
        old.rules.frequency === rule.rules.frequency &&
        old.effective_from < rule.effective_from &&
        (!old.effective_to || old.effective_to > rule.effective_from),
    );
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const input = statutoryImportSchema.parse(JSON.parse(json));
      setError('');
      mutation.mutate({ path: 'rules/import', body: input });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid reference document');
    }
  }
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Statutory Reference Versions</h1>
      <p>
        No government rates are bundled. Import verified reference documents and activate them after
        checking source provenance. Missing or unsupported rules block finalization.
      </p>
      <p>
        JSON import format and supported calculation formulas are documented in{' '}
        <code>docs/phase3-payroll.md</code>.
      </p>
      <ErrorMessage error={mutation.error ?? contributions.error ?? taxes.error} />
      {error && <p role="alert">{error}</p>}
      {(contributionManage || taxManage) && (
        <form onSubmit={submit} className="panel space-y-3 p-5">
          <label className="block">
            Verified statutory reference JSON
            <textarea
              className={inputClass + ' h-48 font-mono'}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              required
            />
          </label>
          <button className="primary-button" disabled={mutation.isPending}>
            Import draft version
          </button>
        </form>
      )}
      {ruleRows.map((r) => (
        <section key={r.id} className="panel space-y-2 p-5">
          <h2 className="font-semibold">
            {r.type.toUpperCase()} · {r.version} · <Status value={r.status} />
          </h2>
          <p>
            {r.effective_from} – {r.effective_to ?? 'ongoing'} (exclusive end)
          </p>
          <p>
            {r.agency} · {r.source_title}
          </p>
          <p>{r.source_reference}</p>
          <p>
            Verification: {r.verification_note} · Verified by:{' '}
            {r.verified_by ?? 'Pending activation'}
          </p>
          <details>
            <summary>Rules and checksum</summary>
            <p className="break-all text-xs">{r.content_checksum}</p>
            <pre className="overflow-auto text-sm">{JSON.stringify(r.rules, null, 2)}</pre>
          </details>
          {r.status === 'draft' && (r.type === 'bir' ? taxManage : contributionManage) && (
            <button
              className="primary-button"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  path: `rules/${r.id}/activate`,
                  body: { expectedRevision: r.revision, supersedesId: predecessor(r)?.id ?? null },
                })
              }
            >
              {predecessor(r)
                ? `Verify and supersede ${predecessor(r)!.version} from ${r.effective_from}`
                : 'Verify source and activate'}
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
export function PayrollDashboard() {
  const { session } = useAuth(),
    view = usePermission('payroll.view');
  const query = useQuery({
    queryKey: ['payroll', 'periods', session?.accessToken],
    queryFn: async () =>
      z
        .array(payrollPeriodResponseSchema)
        .parse(await foundationRequest('payroll/periods', session!.accessToken)),
    enabled: view,
    networkMode: 'always',
    refetchInterval: 15000,
  });
  if (!view) return null;
  const current = query.data?.find((p) => p.status !== 'cancelled');
  return (
    <section className="panel space-y-3 p-5">
      <h2 className="font-semibold">Current Payroll</h2>
      <ErrorMessage error={query.error} />
      {current ? (
        <>
          <p>
            {current.name} · {current.period_start} – {current.period_end}
          </p>
          <Status value={current.status} />
          <Totals totals={current.totals} />
          <Link className="text-action" to={'/payroll/periods/' + current.id}>
            Open payroll →
          </Link>
        </>
      ) : (
        <p>{query.isPending ? 'Loading payroll…' : 'No payroll periods yet.'}</p>
      )}
    </section>
  );
}
