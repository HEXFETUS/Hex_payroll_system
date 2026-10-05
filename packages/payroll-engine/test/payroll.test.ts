import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEmployeePayroll,
  computePremiumEarning,
  roundRatio,
  allocateExact,
  evaluateRule,
  exactSum,
  validateResult,
  type EmployeePayrollContext,
  type AppliedRule,
} from '../src/index.js';
import { statutoryRulesSchema, formatPeso } from '@hexpayroll/shared';

// Synthetic evaluator fixtures. These are not Philippine statutory rates.
const zero = { numerator: '0', denominator: '1' };
test('peso display preserves the exact centavo at the safe integer limit and below one peso', () => {
  assert.equal(formatPeso(9007199254740991), '₱90,071,992,547,409.91');
  assert.equal(formatPeso(-5), '-₱0.05');
});
function rule(
  type: AppliedRule['type'],
  frequency: 'monthly' | 'semi_monthly' | 'weekly' | 'biweekly' = 'monthly',
): AppliedRule {
  return {
    id: type,
    version: 'SYNTHETIC_TEST_ONLY',
    type,
    rules: statutoryRulesSchema.parse({
      basis: type === 'bir' ? 'taxable' : 'basic',
      frequency,
      effectiveDateBasis: 'period_end',
      employeeShareTaxDeductible: type !== 'bir',
      brackets: [
        {
          lower: 0,
          upper: null,
          fixedEmployee: 0,
          fixedEmployer: 0,
          employeeRate: { numerator: '1', denominator: '100' },
          employerRate: { numerator: '2', denominator: '100' },
          excessOver: 0,
        },
      ],
    }),
  };
}
function context(): EmployeePayrollContext {
  return {
    employeeId: 'e1',
    period: {
      start: '2026-10-01',
      end: '2026-10-31',
      payDate: '2026-10-31',
      frequency: 'monthly',
      isLastPeriodOfMonth: true,
    },
    policy: {
      monthlyAllocation: 'calendar_month',
      prorationBasis: 'calendar_days',
      monthlyDailyDivisor: { numerator: '25', denominator: '1' },
      standardMinutesPerDay: 480,
      deductLate: true,
      deductUndertime: true,
      deductAbsence: true,
      contributionCutoff: 'last_period_of_month',
    },
    employment: [
      {
        id: 'v1',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        hireDate: '2026-01-01',
        terminationDate: null,
        employmentStatus: 'active',
        payType: 'monthly',
        payFrequency: 'monthly',
        basicRateCentavos: 2500000,
      },
    ],
    days: Array.from({ length: 31 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      scheduledMinutes: 480,
      workedMinutes: 480,
      lateMinutes: 0,
      undertimeMinutes: 0,
      paidLeaveMinutes: 0,
      unpaidLeaveMinutes: 0,
      absent: false,
      approved: true,
      complete: true,
      revision: 1,
      attendanceId: `a${i}`,
    })),
    earnings: [],
    deductions: [],
    rules: ['sss', 'philhealth', 'pagibig', 'bir'].map((t) => rule(t as AppliedRule['type'])),
    monthlyBasis: { basic: 2500000, gross: 2500000 },
    priorContributions: {},
  };
}

for (const [name, n, d, expected] of [
  ['exact', 10n, 2n, 5],
  ['below midpoint', 49n, 100n, 0],
  ['midpoint', 50n, 100n, 1],
  ['above midpoint', 51n, 100n, 1],
  ['negative midpoint', -50n, 100n, -1],
  ['large intermediate', 9007199254740991n * 10000n, 10000n, 9007199254740991],
] as const)
  test(`rational rounding: ${name}`, () => assert.equal(roundRatio(n, d), expected));
test('unsafe result and invalid denominator fail', () => {
  assert.throws(() => roundRatio(9007199254740992n, 1n));
  assert.throws(() => roundRatio(1n, 0n));
  assert.throws(() => exactSum([9007199254740991, 1]));
});
test('exact allocation reconciles with stable ties', () => {
  assert.deepEqual(allocateExact(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(allocateExact(-10, [1, 1, 1]), [-4, -3, -3]);
});
test('monthly payroll reconciles employee shares, tax, and employer expense', () => {
  const r = computeEmployeePayroll(context());
  assert.equal(r.basicPay, 2500000);
  assert.equal(r.employeeContributions, 75000);
  assert.equal(r.employerContributions, 150000);
  assert.equal(r.taxableCompensation, 2425000);
  assert.equal(r.withholdingTax, 24250);
  assert.equal(r.netPay, 2400750);
  assert.equal(r.issues.length, 0);
});
for (const payType of ['daily', 'hourly'] as const)
  test(`${payType} pay uses paid minutes without a second late deduction`, () => {
    const c = context();
    c.employment[0]!.payType = payType;
    c.employment[0]!.basicRateCentavos = payType === 'daily' ? 100000 : 12500;
    c.days = c.days.map((d) => ({ ...d, workedMinutes: 450, lateMinutes: 30 }));
    const r = computeEmployeePayroll(c);
    assert.equal(r.basicPay, 2906250);
    assert.equal(r.ordinaryDeductions, 0);
    assert.ok(r.deductions.every((l) => l.metadata.alreadyExcludedFromBasic));
  });
for (const [name, field] of [
  ['late', 'lateMinutes'],
  ['undertime', 'undertimeMinutes'],
] as const)
  test(`${name} produces traceable monetary line`, () => {
    const c = context();
    c.days[0]![field] = 23;
    const r = computeEmployeePayroll(c);
    assert.equal(r.ordinaryDeductions, 4792);
    assert.equal(r.deductions[0]!.metadata.minutes, 23);
  });
test('monthly absence and unpaid leave have separate monetary traces', () => {
  const c = context();
  c.days[0]!.absent = true;
  c.days[0]!.workedMinutes = 0;
  c.days[1]!.unpaidLeaveMinutes = 240;
  c.days[1]!.workedMinutes = 240;
  const r = computeEmployeePayroll(c);
  assert.equal(r.ordinaryDeductions, 150000);
  assert.deepEqual(
    r.deductions.map((l) => l.code),
    ['ABSENCE', 'UNPAID_LEAVE'],
  );
});
for (const payType of ['monthly', 'daily', 'hourly'] as const)
  test(`${payType} paid leave preserves pay`, () => {
    const c = context();
    c.employment[0]!.payType = payType;
    c.employment[0]!.basicRateCentavos =
      payType === 'monthly' ? 2500000 : payType === 'daily' ? 100000 : 12500;
    c.days[0]!.workedMinutes = 240;
    c.days[0]!.paidLeaveMinutes = 240;
    assert.equal(computeEmployeePayroll(c).basicPay, payType === 'monthly' ? 2500000 : 3100000);
  });
test('mid-period hire and termination prorate entitlement', () => {
  const c = context();
  c.employment[0]!.hireDate = '2026-10-10';
  c.employment[0]!.terminationDate = '2026-10-20';
  assert.equal(computeEmployeePayroll(c).basicPay, 887097);
});
test('effective-dated salary changes preserve separate lines', () => {
  const c = context();
  c.employment[0]!.effectiveTo = '2026-10-16';
  c.employment.push({
    ...c.employment[0]!,
    id: 'v2',
    effectiveFrom: '2026-10-16',
    effectiveTo: null,
    basicRateCentavos: 3100000,
  });
  const r = computeEmployeePayroll(c);
  assert.equal(r.earnings.length, 2);
  assert.equal(r.basicPay, 2809677);
});
test('scheduled minute proration uses full cutoff denominator', () => {
  const c = context();
  c.policy.prorationBasis = 'scheduled_minutes';
  c.employment[0]!.hireDate = '2026-10-16';
  assert.equal(computeEmployeePayroll(c).basicPay, 1290323);
});
for (const [frequency, periods] of [
  ['monthly', 12],
  ['semi_monthly', 24],
  ['weekly', 52],
  ['biweekly', 26],
] as const)
  test(`annual allocation supports ${frequency}`, () => {
    const c = context();
    c.period.frequency = frequency;
    c.employment[0]!.payFrequency = frequency;
    c.policy.monthlyAllocation = 'annual_periods';
    c.rules = c.rules.map((r) => ({ ...r, rules: { ...r.rules, frequency } }));
    assert.equal(computeEmployeePayroll(c).basicPay, roundRatio(30000000n, BigInt(periods)));
  });
test('recurring, one-time, taxable, and non-taxable lines retain distinct entries', () => {
  const c = context();
  c.earnings = [
    {
      code: 'ALLOW',
      description: 'Recurring',
      amount: 10000,
      taxable: false,
      metadata: { entryId: 'recurring' },
    },
    {
      code: 'BONUS',
      description: 'One time',
      amount: 20000,
      taxable: true,
      metadata: { entryId: 'one-time' },
    },
  ];
  c.deductions = [
    {
      code: 'LOAN',
      description: 'Recurring loan',
      amount: 10000,
      taxable: false,
      metadata: { entryId: 'loan' },
    },
    {
      code: 'CHARGE',
      description: 'Manual deduction',
      amount: 5000,
      taxable: false,
      metadata: { entryId: 'manual' },
    },
  ];
  const r = computeEmployeePayroll(c);
  assert.equal(r.grossPay, 2530000);
  assert.equal(r.taxableCompensation, 2445000);
  assert.equal(r.ordinaryDeductions, 15000);
  assert.equal(r.netPay, r.grossPay - r.totalDeductions);
});
test('missing statutory data returns blocking issues rather than valid zero tax', () => {
  const c = context();
  c.rules = [];
  const r = computeEmployeePayroll(c);
  assert.equal(r.issues.filter((i) => i.code.startsWith('MISSING_')).length, 4);
});
test('unapproved and incomplete facts block payroll', () => {
  const c = context();
  c.days[0]!.approved = false;
  c.days[1]!.complete = false;
  assert.equal(
    computeEmployeePayroll(c).issues.filter((i) => i.code === 'UNAPPROVED_ATTENDANCE').length,
    2,
  );
});
test('monthly collection reconciles earlier employee and employer shares', () => {
  const c = context();
  c.priorContributions.sss = { employee: 10000, employer: 20000 };
  const r = computeEmployeePayroll(c);
  assert.equal(r.contributions[0]!.employeeShare, 15000);
  assert.equal(r.contributions[0]!.employerShare, 30000);
});
test('prior overcollection requires future correction payroll', () => {
  const c = context();
  c.priorContributions.sss = { employee: 999999, employer: 0 };
  assert.ok(
    computeEmployeePayroll(c).issues.some((i) => i.code === 'CONTRIBUTION_CORRECTION_REQUIRED'),
  );
});
test('earlier cutoff defers monthly contribution collection', () => {
  const c = context();
  c.period.isLastPeriodOfMonth = false;
  const r = computeEmployeePayroll(c);
  assert.equal(r.employeeContributions, 0);
  assert.ok(r.contributions.every((l) => l.metadata.deferredToFinalCutoff));
});
test('negative net pay blocks finalization', () => {
  const c = context();
  c.deductions = [
    { code: 'CHARGE', description: 'Charge', amount: 3000000, taxable: false, metadata: {} },
  ];
  assert.ok(computeEmployeePayroll(c).issues.some((i) => i.code === 'NEGATIVE_NET_PAY'));
});
test('identical inputs produce identical outputs and preserve historic rules', () => {
  const c = context();
  const old = computeEmployeePayroll(c);
  assert.deepEqual(computeEmployeePayroll(c), old);
  const next = structuredClone(c);
  next.rules[0]!.version = 'NEW_SYNTHETIC';
  next.rules[0]!.rules.brackets[0]!.employeeRate = { numerator: '2', denominator: '100' };
  assert.notEqual(computeEmployeePayroll(next).employeeContributions, old.employeeContributions);
  assert.deepEqual(computeEmployeePayroll(c), old);
});
for (const value of [9999, 10000, 10001])
  test(`synthetic bracket boundary ${value}`, () => {
    const r = rule('sss');
    r.rules.brackets = [
      {
        lower: 0,
        upper: 10000,
        fixedEmployee: 100,
        fixedEmployer: 0,
        employeeRate: zero,
        employerRate: zero,
        excessOver: 0,
      },
      {
        lower: 10000,
        upper: null,
        fixedEmployee: 200,
        fixedEmployer: 0,
        employeeRate: zero,
        employerRate: zero,
        excessOver: 10000,
      },
    ];
    assert.equal(evaluateRule(r, value).employee, value < 10000 ? 100 : 200);
  });
test('synthetic contribution min/max basis caps', () => {
  const r = rule('philhealth');
  r.rules.minimumBasis = 10000;
  r.rules.maximumBasis = 20000;
  assert.equal(evaluateRule(r, 9999).employee, 100);
  assert.equal(evaluateRule(r, 20001).employee, 200);
});
test('premium boundary traces explicit multipliers and approved source', () => {
  const l = computePremiumEarning(
    'OT',
    100000,
    23,
    480,
    { numerator: '5', denominator: '4' },
    'approved-ot-fact',
  );
  assert.equal(l.amount, 5990);
  assert.equal(l.metadata.sourceId, 'approved-ot-fact');
});
test('unpaid leave reduces daily pay without a duplicate deduction', () => {
  const c = context();
  c.employment[0]!.payType = 'daily';
  c.employment[0]!.basicRateCentavos = 100000;
  c.days[0]!.workedMinutes = 240;
  c.days[0]!.unpaidLeaveMinutes = 240;
  const result = computeEmployeePayroll(c);
  assert.equal(result.basicPay, 3050000);
  assert.equal(result.ordinaryDeductions, 0);
});
test('absence absorbs late time and contradictory payable facts are rejected', () => {
  const c = context();
  c.days[0]!.absent = true;
  c.days[0]!.workedMinutes = 0;
  c.days[0]!.lateMinutes = 23;
  assert.equal(computeEmployeePayroll(c).ordinaryDeductions, 100000);
  c.days[0]!.workedMinutes = 10;
  assert.throws(() => computeEmployeePayroll(c), /Inconsistent attendance/);
});
test('public reconciliation detects mismatched line and contribution totals', () => {
  const result = computeEmployeePayroll(context());
  result.contributions[0]!.employeeShare++;
  assert(validateResult(result).some((i) => i.code === 'RECONCILIATION_FAILED'));
});
test('cross-month weekly basic lines carry exact month-specific traces', () => {
  const c = context();
  c.period = { ...c.period, start: '2026-10-29', end: '2026-11-04', frequency: 'weekly' };
  c.employment[0]!.payFrequency = 'weekly';
  c.days = Array.from({ length: 7 }, (_, i) => ({
    ...c.days[0]!,
    date: new Date(Date.UTC(2026, 9, 29 + i)).toISOString().slice(0, 10),
  }));
  const result = computeEmployeePayroll(c);
  assert.equal(result.earnings.length, 2);
  assert.deepEqual(
    result.earnings.map((l) => l.metadata.month),
    ['2026-10', '2026-11'],
  );
  assert.equal(result.basicPay, 575268);
  assert(result.earnings.every((l) => typeof l.metadata.numerator === 'string'));
  assert(result.issues.some((i) => i.code === 'UNSUPPORTED_MONTHLY_ALLOCATION'));
});
