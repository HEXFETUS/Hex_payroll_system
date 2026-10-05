import type {
  PayrollPolicy,
  PayrollLine,
  PayrollResult,
  PayrollIssue,
  PayrollContribution,
  StatutoryRules,
  StatutoryType,
} from '@hexpayroll/shared';
import { assertCentavos } from '@hexpayroll/shared';
import { roundRatio, exactSum, allocateExact } from './arithmetic.js';

export interface Compensation {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  hireDate: string;
  terminationDate: string | null;
  employmentStatus: string;
  payType: 'monthly' | 'daily' | 'hourly';
  payFrequency: 'monthly' | 'semi_monthly' | 'weekly' | 'biweekly';
  basicRateCentavos: number;
}
export interface PayrollDay {
  date: string;
  scheduledMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  absent: boolean;
  approved: boolean;
  complete: boolean;
  revision: number;
  attendanceId: string;
}
export interface AppliedRule {
  id: string;
  type: StatutoryType;
  version: string;
  rules: StatutoryRules;
}
export interface EmployeePayrollContext {
  employeeId: string;
  period: {
    start: string;
    end: string;
    payDate: string;
    frequency: Compensation['payFrequency'];
    isLastPeriodOfMonth: boolean;
  };
  policy: PayrollPolicy;
  employment: Compensation[];
  days: PayrollDay[];
  earnings: PayrollLine[];
  deductions: PayrollLine[];
  rules: AppliedRule[];
  monthlyBasis?: { basic: number; gross: number };
  priorContributions: Partial<Record<StatutoryType, { employee: number; employer: number }>>;
}
function dates(start: string, end: string): string[] {
  const values: string[] = [];
  let date = start;
  while (date <= end) {
    values.push(date);
    date = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  return values;
}
export function resolveCompensation(
  context: EmployeePayrollContext,
  date: string,
): Compensation | null {
  const matches = context.employment.filter(
    (v) =>
      v.effectiveFrom <= date &&
      (!v.effectiveTo || v.effectiveTo > date) &&
      v.hireDate <= date &&
      (!v.terminationDate || v.terminationDate >= date) &&
      ['active', 'on_leave'].includes(v.employmentStatus) &&
      v.payFrequency === context.period.frequency,
  );
  if (matches.length > 1) throw new Error(`Overlapping compensation on ${date}`);
  return matches[0] ?? null;
}
export function computeBasicPay(context: EmployeePayrollContext): {
  lines: PayrollLine[];
  issues: PayrollIssue[];
} {
  const lines: PayrollLine[] = [],
    issues: PayrollIssue[] = [];
  for (const day of context.days) {
    for (const value of [
      day.scheduledMinutes,
      day.workedMinutes,
      day.lateMinutes,
      day.undertimeMinutes,
      day.paidLeaveMinutes,
      day.unpaidLeaveMinutes,
    ])
      if (!Number.isSafeInteger(value) || value < 0 || value > 1440)
        throw new RangeError(`Invalid timekeeping minutes for ${day.date}`);
    if (day.paidLeaveMinutes + day.unpaidLeaveMinutes + day.workedMinutes > day.scheduledMinutes)
      throw new RangeError(`Overlapping payable time for ${day.date}`);
    if (
      day.lateMinutes + day.undertimeMinutes >
        day.scheduledMinutes - day.paidLeaveMinutes - day.unpaidLeaveMinutes ||
      (day.absent && day.workedMinutes > 0)
    )
      throw new RangeError(`Inconsistent attendance facts for ${day.date}`);
  }
  const periodDates = dates(context.period.start, context.period.end);
  const byDate = new Map(context.days.map((d) => [d.date, d]));
  const weightTotal =
    context.policy.prorationBasis === 'calendar_days'
      ? periodDates.length
      : exactSum(context.days.map((d) => d.scheduledMinutes));
  const groups = new Map<
    string,
    { version: Compensation; days: PayrollDay[]; eligibleDays: number }
  >();
  for (const date of periodDates) {
    const v = resolveCompensation(context, date);
    if (!v) continue;
    assertCentavos(v.basicRateCentavos);
    if (v.basicRateCentavos <= 0)
      issues.push({
        code: 'INVALID_COMPENSATION',
        severity: 'error',
        message: `Compensation must be positive on ${date}`,
      });
    const day = byDate.get(date);
    if (!day) {
      issues.push({
        code: 'MISSING_ATTENDANCE',
        severity: 'error',
        message: `Missing attendance for ${date}`,
      });
      continue;
    }
    if (!day.approved || !day.complete)
      issues.push({
        code: 'UNAPPROVED_ATTENDANCE',
        severity: 'error',
        message: `Attendance requires approval or completion for ${date}`,
      });
    const g = groups.get(v.id) ?? { version: v, days: [], eligibleDays: 0 };
    g.days.push(day);
    g.eligibleDays++;
    groups.set(v.id, g);
  }
  for (const { version: v, days, eligibleDays } of groups.values()) {
    let n = BigInt(v.basicRateCentavos),
      d = 1n;
    const paidMinutes = exactSum(days.map((day) => day.workedMinutes + day.paidLeaveMinutes));
    if (v.payType === 'monthly') {
      if (context.policy.monthlyAllocation === 'calendar_month') {
        const months = new Set(periodDates.map((date) => date.slice(0, 7)));
        for (const month of months) {
          const monthDays = Number(
            new Date(
              Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
            ).getUTCDate(),
          );
          const covered = periodDates.filter((date) => date.startsWith(month));
          const eligible = days.filter((day) => day.date.startsWith(month));
          if (!eligible.length) continue;
          const numerator =
            context.policy.prorationBasis === 'calendar_days'
              ? eligible.length
              : exactSum(eligible.map((day) => day.scheduledMinutes));
          const denominator =
            context.policy.prorationBasis === 'calendar_days'
              ? covered.length
              : exactSum(
                  context.days
                    .filter((day) => day.date.startsWith(month))
                    .map((day) => day.scheduledMinutes),
                );
          if (denominator === 0) {
            issues.push({
              code: 'EMPTY_PRORATION_BASIS',
              severity: 'error',
              message: 'No scheduled proration basis',
            });
            continue;
          }
          // Full cutoff entitlement is the monthly salary divided equally for semi-monthly;
          // weekly cutoffs use their calendar coverage in the month.
          const allocation =
            context.period.frequency === 'monthly'
              ? { n: 1, d: 1 }
              : context.period.frequency === 'semi_monthly'
                ? { n: 1, d: 2 }
                : { n: covered.length, d: monthDays };
          const n = BigInt(v.basicRateCentavos) * BigInt(allocation.n) * BigInt(numerator),
            d = BigInt(allocation.d) * BigInt(denominator);
          lines.push(
            line('BASIC', roundRatio(n, d), {
              employmentId: v.id,
              payType: v.payType,
              rate: v.basicRateCentavos,
              month,
              eligibleDays: eligible.length,
              paidMinutes: exactSum(
                eligible.map((day) => day.workedMinutes + day.paidLeaveMinutes),
              ),
              numerator: n.toString(),
              denominator: d.toString(),
              policy: context.policy,
            }),
          );
        }
        continue;
      }
      const periods = { monthly: 12, semi_monthly: 24, weekly: 52, biweekly: 26 }[
        context.period.frequency
      ];
      n *= 12n;
      d *= BigInt(periods);
      const weight =
        context.policy.prorationBasis === 'calendar_days'
          ? eligibleDays
          : exactSum(days.map((day) => day.scheduledMinutes));
      if (weightTotal === 0) {
        issues.push({
          code: 'EMPTY_PRORATION_BASIS',
          severity: 'error',
          message: 'No scheduled proration basis',
        });
        continue;
      }
      n *= BigInt(weight);
      d *= BigInt(weightTotal);
    } else {
      n *= BigInt(paidMinutes);
      d *= BigInt(v.payType === 'hourly' ? 60 : context.policy.standardMinutesPerDay);
    }
    lines.push(
      line('BASIC', roundRatio(n, d), {
        employmentId: v.id,
        payType: v.payType,
        rate: v.basicRateCentavos,
        paidMinutes,
        eligibleDays,
        numerator: n.toString(),
        denominator: d.toString(),
      }),
    );
  }
  if (!groups.size)
    issues.push({
      code: 'NO_COMPENSATION',
      severity: 'error',
      message: 'No eligible compensation for this period',
    });
  return { lines, issues };
}
function line(
  code: string,
  amount: number,
  metadata: Record<string, unknown>,
  taxable = true,
): PayrollLine {
  const descriptions: Record<string, string> = {
    BASIC: 'Basic Pay',
    LATE: 'Late',
    UNDERTIME: 'Undertime',
    ABSENCE: 'Absence',
    UNPAID_LEAVE: 'Unpaid leave',
  };
  return {
    code,
    description: descriptions[code] ?? code.replaceAll('_', ' '),
    amount,
    taxable,
    metadata,
  };
}
export function computeAttendanceAdjustments(context: EmployeePayrollContext): PayrollLine[] {
  const result: PayrollLine[] = [];
  for (const day of context.days) {
    const v = resolveCompensation(context, day.date);
    if (!v) continue;
    const minutes = {
      LATE: context.policy.deductLate && !day.absent ? day.lateMinutes : 0,
      UNDERTIME: context.policy.deductUndertime && !day.absent ? day.undertimeMinutes : 0,
      ABSENCE:
        context.policy.deductAbsence && day.absent
          ? Math.max(0, day.scheduledMinutes - day.paidLeaveMinutes - day.unpaidLeaveMinutes)
          : 0,
      UNPAID_LEAVE: day.unpaidLeaveMinutes,
    };
    for (const [code, value] of Object.entries(minutes)) {
      if (value === 0) continue;
      const n =
          BigInt(v.basicRateCentavos) *
          BigInt(value) *
          BigInt(context.policy.monthlyDailyDivisor.denominator),
        d =
          BigInt(context.policy.monthlyDailyDivisor.numerator) *
          BigInt(context.policy.standardMinutesPerDay);
      result.push(
        line(
          code,
          v.payType === 'monthly' ? roundRatio(n, d) : 0,
          {
            date: day.date,
            attendanceId: day.attendanceId,
            minutes: value,
            employmentId: v.id,
            alreadyExcludedFromBasic: v.payType !== 'monthly',
            numerator: n.toString(),
            denominator: d.toString(),
          },
          false,
        ),
      );
    }
  }
  return result;
}
export function computeEarnings(lines: readonly PayrollLine[]): PayrollLine[] {
  return lines.map((v) => {
    assertCentavos(v.amount);
    if (v.amount < 0) throw new RangeError('Earning must not be negative');
    return { ...v };
  });
}
export function computeGrossPay(lines: readonly PayrollLine[]): number {
  return exactSum(lines.map((v) => v.amount));
}
export function evaluateRule(
  rule: AppliedRule,
  basis: number,
): { employee: number; employer: number; basis: number; trace: Record<string, unknown> } {
  assertCentavos(basis);
  const r = rule.rules,
    clamped = Math.max(r.minimumBasis, Math.min(basis, r.maximumBasis ?? basis));
  const i = r.brackets.findIndex(
    (b) => clamped >= b.lower && (b.upper === null || clamped < b.upper),
  );
  if (i < 0) throw new Error(`No applicable bracket for ${rule.type}`);
  const b = r.brackets[i]!,
    excess = Math.max(0, clamped - b.excessOver);
  const employee = roundRatio(
    BigInt(b.fixedEmployee) * BigInt(b.employeeRate.denominator) +
      BigInt(excess) * BigInt(b.employeeRate.numerator),
    BigInt(b.employeeRate.denominator),
  );
  const employer = roundRatio(
    BigInt(b.fixedEmployer) * BigInt(b.employerRate.denominator) +
      BigInt(excess) * BigInt(b.employerRate.numerator),
    BigInt(b.employerRate.denominator),
  );
  return {
    employee,
    employer,
    basis: clamped,
    trace: {
      ruleSetId: rule.id,
      version: rule.version,
      bracket: i,
      baseTax: b.fixedEmployee,
      excessBasis: excess,
      bracketData: b,
      originalBasis: basis,
    },
  };
}
export function computeContributions(
  context: EmployeePayrollContext,
  basic: number,
  gross: number,
): { lines: PayrollContribution[]; issues: PayrollIssue[] } {
  const lines: PayrollContribution[] = [],
    issues: PayrollIssue[] = [];
  for (const type of ['sss', 'philhealth', 'pagibig'] as const) {
    const rule = context.rules.find((r) => r.type === type);
    if (!rule) {
      issues.push({
        code: `MISSING_${type.toUpperCase()}_RULE`,
        severity: 'error',
        message: `No verified ${type.toUpperCase()} rule set is configured`,
      });
      continue;
    }
    if (rule.rules.basis === 'taxable') {
      issues.push({
        code: 'UNSUPPORTED_CONTRIBUTION_BASIS',
        severity: 'error',
        message: `${type} taxable contribution basis requires an unsupported circular calculation`,
      });
      continue;
    }
    const monthly = rule.rules.frequency === 'monthly';
    if (monthly && context.period.start.slice(0, 7) !== context.period.end.slice(0, 7)) {
      issues.push({
        code: 'UNSUPPORTED_MONTHLY_ALLOCATION',
        severity: 'error',
        message: `${type} requires month-specific allocation for a cross-month period`,
      });
      continue;
    }
    if (!monthly && rule.rules.frequency !== context.period.frequency) {
      issues.push({
        code: 'RULE_FREQUENCY_MISMATCH',
        severity: 'error',
        message: `${type} rule frequency does not match payroll`,
      });
      continue;
    }
    if (
      monthly &&
      context.policy.contributionCutoff === 'last_period_of_month' &&
      !context.period.isLastPeriodOfMonth
    ) {
      lines.push({
        type,
        ruleSetId: rule.id,
        employeeShare: 0,
        employerShare: 0,
        basisAmount: 0,
        taxDeductible: rule.rules.employeeShareTaxDeductible,
        metadata: { deferredToFinalCutoff: true, version: rule.version },
      });
      continue;
    }
    if (monthly && !context.monthlyBasis) {
      issues.push({
        code: 'MISSING_MONTHLY_BASIS',
        severity: 'error',
        message: `${type} monthly basis is not available`,
      });
      continue;
    }
    const bases = monthly ? context.monthlyBasis! : { basic, gross };
    const evaluated = evaluateRule(rule, bases[rule.rules.basis]);
    const prior = monthly ? context.priorContributions[type] : undefined;
    const employee = evaluated.employee - (prior?.employee ?? 0),
      employer = evaluated.employer - (prior?.employer ?? 0);
    if (employee < 0 || employer < 0) {
      issues.push({
        code: 'CONTRIBUTION_CORRECTION_REQUIRED',
        severity: 'error',
        message: `${type} prior collection exceeds the monthly obligation; correction payroll is required`,
      });
      continue;
    }
    lines.push({
      type,
      ruleSetId: rule.id,
      employeeShare: employee,
      employerShare: employer,
      basisAmount: evaluated.basis,
      taxDeductible: rule.rules.employeeShareTaxDeductible,
      metadata: { ...evaluated.trace, prior: prior ?? null },
    });
  }
  return { lines, issues };
}
export function computeTaxableIncome(
  earnings: readonly PayrollLine[],
  deductions: readonly PayrollLine[],
  contributions: readonly PayrollContribution[],
): number {
  return Math.max(
    0,
    exactSum([
      ...earnings.filter((v) => v.taxable).map((v) => v.amount),
      ...deductions.filter((v) => v.metadata.reducesTaxable === true).map((v) => -v.amount),
      ...contributions.filter((v) => v.taxDeductible).map((v) => -v.employeeShare),
    ]),
  );
}
export function computeWithholdingTax(
  context: EmployeePayrollContext,
  taxable: number,
): { amount: number; trace: Record<string, unknown>; issues: PayrollIssue[] } {
  const rule = context.rules.find((v) => v.type === 'bir');
  if (!rule)
    return {
      amount: 0,
      trace: { status: 'awaiting_verified_reference_data' },
      issues: [
        {
          code: 'MISSING_BIR_RULE',
          severity: 'error',
          message: 'No verified BIR rule set is configured',
        },
      ],
    };
  if (rule.rules.frequency !== context.period.frequency || rule.rules.basis !== 'taxable')
    return {
      amount: 0,
      trace: {},
      issues: [
        {
          code: 'UNSUPPORTED_TAX_RULE',
          severity: 'error',
          message: 'BIR requires a taxable-basis rule matching the payroll frequency',
        },
      ],
    };
  const evaluated = evaluateRule(rule, taxable);
  return {
    amount: evaluated.employee,
    trace: { ...evaluated.trace, taxableCompensation: taxable },
    issues: [],
  };
}
export function computeDeductions(lines: readonly PayrollLine[]): number {
  for (const v of lines) {
    assertCentavos(v.amount);
    if (v.amount < 0) throw new RangeError('Deduction must not be negative');
  }
  return exactSum(lines.map((v) => v.amount));
}
export function computeNetPay(gross: number, deductions: number): number {
  return exactSum([gross, -deductions]);
}
export function validateResult(result: PayrollResult): PayrollIssue[] {
  const issues: PayrollIssue[] = [];
  if (
    result.grossPay !== computeGrossPay(result.earnings) ||
    result.ordinaryDeductions !== computeDeductions(result.deductions) ||
    result.employeeContributions !== exactSum(result.contributions.map((v) => v.employeeShare)) ||
    result.employerContributions !== exactSum(result.contributions.map((v) => v.employerShare)) ||
    result.totalDeductions !==
      exactSum([result.ordinaryDeductions, result.employeeContributions, result.withholdingTax]) ||
    result.netPay !== computeNetPay(result.grossPay, result.totalDeductions)
  )
    issues.push({
      code: 'RECONCILIATION_FAILED',
      severity: 'error',
      message: 'Payroll lines do not reconcile',
    });
  if (result.netPay < 0)
    issues.push({ code: 'NEGATIVE_NET_PAY', severity: 'error', message: 'Net pay is negative' });
  return issues;
}
export function computeEmployeePayroll(context: EmployeePayrollContext): PayrollResult {
  const basic = computeBasicPay(context),
    earnings = computeEarnings([...basic.lines, ...context.earnings]),
    attendance = computeAttendanceAdjustments(context);
  // Attendance reductions are compensation reductions; company deductions are post-tax.
  const deductions = [
    ...attendance.map((v) => ({ ...v, metadata: { ...v.metadata, reducesTaxable: true } })),
    ...context.deductions,
  ];
  const gross = computeGrossPay(earnings),
    contributions = computeContributions(context, computeGrossPay(basic.lines), gross);
  const taxable = computeTaxableIncome(earnings, deductions, contributions.lines),
    tax = computeWithholdingTax(context, taxable),
    ordinary = computeDeductions(deductions);
  const employee = exactSum(contributions.lines.map((v) => v.employeeShare)),
    employer = exactSum(contributions.lines.map((v) => v.employerShare)),
    total = exactSum([ordinary, employee, tax.amount]);
  const result: PayrollResult = {
    employeeId: context.employeeId,
    basicPay: computeGrossPay(basic.lines),
    grossPay: gross,
    ordinaryDeductions: ordinary,
    employeeContributions: employee,
    employerContributions: employer,
    withholdingTax: tax.amount,
    totalDeductions: total,
    taxableCompensation: taxable,
    netPay: computeNetPay(gross, total),
    earnings,
    deductions,
    contributions: contributions.lines,
    taxTrace: tax.trace,
    issues: [...basic.issues, ...contributions.issues, ...tax.issues],
  };
  result.issues.push(...validateResult(result));
  return result;
}
export function computePremiumEarning(
  code: string,
  rateCentavos: number,
  minutes: number,
  denominatorMinutes: number,
  multiplier: { numerator: string; denominator: string },
  sourceId: string,
): PayrollLine {
  if (
    !Number.isSafeInteger(minutes) ||
    minutes < 0 ||
    !Number.isSafeInteger(denominatorMinutes) ||
    denominatorMinutes <= 0
  )
    throw new RangeError('Invalid premium time');
  return line(
    code,
    roundRatio(
      BigInt(rateCentavos) * BigInt(minutes) * BigInt(multiplier.numerator),
      BigInt(denominatorMinutes) * BigInt(multiplier.denominator),
    ),
    { minutes, rateCentavos, denominatorMinutes, multiplier, sourceId },
  );
}
export { allocateExact };
