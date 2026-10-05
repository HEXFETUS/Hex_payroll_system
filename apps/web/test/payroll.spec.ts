import { test, expect, type Page } from '@playwright/test';
import { permissionCodes } from '@hexpayroll/shared';
const id = (n: number) => `019a0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-05T00:00:00.000Z';
async function fixture(page: Page, { viewer = false, errors = false } = {}) {
  const user = {
    id: id(1),
    username: 'payroll',
    displayName: 'Payroll Test',
    organizationId: id(2),
    roles: [viewer ? 'viewer' : 'administrator'],
    permissions: viewer ? ['dashboard.view', 'payroll.view'] : [...permissionCodes],
  };
  const totals = {
    employees: 1,
    basicPay: 2500000,
    grossPay: 2500000,
    ordinaryDeductions: 10000,
    employeeContributions: 30000,
    employerContributions: 60000,
    withholdingTax: 10000,
    totalDeductions: 50000,
    netPay: 2450000,
  };
  const period = {
    id: id(10),
    code: 'OCT-2026',
    name: 'October payroll',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    pay_date: '2026-10-31',
    pay_frequency: 'monthly',
    status: 'draft',
    revision: 1,
    latest_run_id: null as string | null,
    reviewed_run_id: null as string | null,
    reviewed_by: null as string | null,
    finalized_by: null as string | null,
    warning_acknowledgments: [],
  };
  const runs: Record<string, unknown>[] = [],
    results: Record<string, unknown>[] = [];
  let exists = false,
    stale = false;
  await page.route('**/api/**', async (route) => {
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const req = route.request(),
      path = new URL(req.url()).pathname.replace('/api/', ''),
      method = req.method();
    let body: unknown,
      status = 200;
    if (path === 'health') body = { status: 'ok', database: 'reachable', timestamp: at };
    else if (path === 'auth/login')
      body = {
        user,
        accessToken: 'a'.repeat(43),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    else if (path === 'auth/session')
      body = { user, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    else if (path === 'organization/setup') body = { required: false, administratorReady: true };
    else if (path === 'timekeeping/context')
      body = { id: id(2), timezone: 'Asia/Manila', date: '2026-10-05' };
    else if (path === 'sync/summary')
      body = {
        configured: false,
        nodeProvisioned: false,
        pending: 0,
        processing: 0,
        synced: 0,
        failed: 0,
      };
    else if (path === 'dashboard/summary')
      body = {
        id: id(2),
        totalEmployees: 1,
        activeEmployees: 1,
        departments: 1,
        processed: 0,
        present: 0,
        late: 0,
        absent: 0,
        onLeave: 0,
        incomplete: 0,
        pending: 0,
        stale: 0,
      };
    else if (path === 'attendance') body = { items: [], total: 0, page: 1, pageSize: 25 };
    else if (path === 'payroll/periods' && method === 'POST') {
      exists = true;
      body = period;
    } else if (path === 'payroll/periods')
      body = exists ? [{ ...period, totals: runs.length ? totals : null }] : [];
    else if (path === `payroll/periods/${period.id}`) body = { period, runs, results, stale };
    else if (path === `payroll/periods/${period.id}/results/${id(30)}`)
      body = {
        ...results[0],
        engine_version: '0.3.0',
        pay_date: period.pay_date,
        period_start: period.period_start,
        period_end: period.period_end,
        payroll_earning_lines: [
          {
            id: id(40),
            code: 'BASIC',
            description: 'Basic Pay',
            amount: 2500000,
            taxable: true,
            metadata: { rate: 2500000, employmentId: id(3) },
          },
        ],
        payroll_deduction_lines: [
          {
            id: id(41),
            code: 'LATE',
            description: 'Late',
            amount: 10000,
            taxable: false,
            metadata: { minutes: 48, attendanceId: id(50) },
          },
        ],
        payroll_contribution_lines: [],
      };
    else if (path.startsWith(`payroll/periods/${period.id}/`) && method === 'POST') {
      const action = path.split('/').at(-1);
      if (viewer) {
        status = 403;
        body = { error: { code: 'FORBIDDEN', message: 'Permission required' } };
      } else {
        period.revision++;
        if (action === 'open') period.status = 'open';
        if (action === 'compute' || action === 'recompute') {
          stale = false;
          period.status = 'review';
          period.latest_run_id = id(20 + runs.length);
          period.reviewed_run_id = null;
          const issues = errors
            ? [
                {
                  code: 'MISSING_SSS_RULE',
                  severity: 'error',
                  message: 'No verified SSS rule set is configured',
                },
              ]
            : [];
          runs.unshift({
            id: period.latest_run_id,
            status: errors ? 'failed' : 'computed',
            totals,
            issues,
            engine_version: '0.3.0',
            prepared_by: user.id,
            created_at: at,
          });
          results.splice(0, results.length, {
            id: id(30),
            employee_id: id(3),
            payroll_run_id: period.latest_run_id,
            employee_number: 'EMP-001',
            first_name: 'Ana',
            last_name: 'Reyes',
            basic_pay: 2500000,
            gross_pay: 2500000,
            ordinary_deductions: 10000,
            employee_contributions: 30000,
            employer_contributions: 60000,
            withholding_tax: 10000,
            taxable_compensation: 2460000,
            total_deductions: 50000,
            net_pay: 2450000,
            status: errors ? 'failed' : 'computed',
            snapshot: {
              employee: { employee_number: 'EMP-001' },
              context: { policyVersion: 'Fixture policy' },
            },
            tax_trace: { ruleVersion: 'Synthetic test only', bracket: 0 },
            issues,
          });
        }
        if (action === 'review') {
          period.reviewed_run_id = period.latest_run_id;
          period.reviewed_by = user.id;
        }
        if (action === 'finalize') {
          period.status = 'finalized';
          period.finalized_by = user.id;
        }
        body = period;
      }
    } else {
      status = 404;
      body = { error: { code: 'NOT_FOUND', message: 'Fixture route missing' } };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/#/login');
  await page.getByLabel('Username or Email').fill('payroll');
  await page.getByLabel('Password', { exact: true }).fill('password');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  return {
    period,
    setExisting: () => {
      exists = true;
    },
    setStale: () => {
      stale = true;
    },
  };
}
async function createAndCompute(page: Page) {
  await page.goto('/#/payroll/periods');
  await page.getByRole('button', { name: 'Create Period', exact: true }).click();
  await page.getByLabel('Pay frequency').selectOption('monthly');
  for (const [label, value] of [
    ['Period code', 'OCT-2026'],
    ['Period name', 'October payroll'],
    ['Start date', '2026-10-01'],
    ['End date', '2026-10-31'],
    ['Pay date', '2026-10-31'],
  ])
    await page.getByLabel(label!).fill(value!);
  await page.getByRole('button', { name: 'Create period', exact: true }).click();
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Open period', exact: true }).click();
  await page.getByRole('button', { name: 'Compute', exact: true }).click();
}
test('period creation shows missing statutory errors and blocks finalization', async ({ page }) => {
  await fixture(page, { errors: true });
  await createAndCompute(page);
  await expect(page.getByText('ERROR: No verified SSS rule set is configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark reviewed' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toBeDisabled();
});
test('review explanations, stale recomputation, and immutable finalization workflow', async ({
  page,
}) => {
  const f = await fixture(page);
  await createAndCompute(page);
  await page.getByRole('link', { name: 'EMP-001 · Ana Reyes' }).click();
  await expect(page.getByRole('heading', { name: 'Employee payroll', exact: true })).toBeVisible();
  await page.getByText('Calculation details', { exact: true }).first().click();
  await expect(page.getByText('"rate": 2500000', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '← Payroll review' }).click();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toBeEnabled();
  f.setStale();
  await page.getByRole('link', { name: '← Payroll periods', exact: true }).click();
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(
    page.getByText('Payroll inputs changed. Recompute and review the latest run.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Recompute', exact: true }).click();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await page.getByRole('button', { name: 'Finalize', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm finalization' }).click();
  await expect(page.getByRole('button', { name: 'Recompute', exact: true })).toHaveCount(0);
  await expect(page.getByText('FINALIZED', { exact: true }).first()).toBeVisible();
});
test('viewer sees payroll but no preparation or finalization controls', async ({ page }) => {
  const f = await fixture(page, { viewer: true });
  f.setExisting();
  await page.goto('/#/payroll/periods');
  await expect(page.getByRole('button', { name: 'Create Period', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open period' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finalize', exact: true })).toHaveCount(0);
});
