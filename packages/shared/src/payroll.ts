import { z } from 'zod';
import { isoDateSchema, nonNegativeCentavosSchema } from './primitives.js';
import { frequencySchema, revisionSchema } from './foundation.js';

export const payrollPermissionCodes = [
  'payroll.view',
  'payroll.create_period',
  'payroll.compute',
  'payroll.recompute',
  'payroll.review',
  'payroll.finalize',
  'earnings.view',
  'earnings.manage',
  'deductions.view',
  'deductions.manage',
  'contributions.view',
  'contributions.configure',
  'tax.view',
  'tax.configure',
] as const;
const text = z.string().trim().min(1).max(254);
export const rationalSchema = z
  .object({
    numerator: z.string().max(30).regex(/^\d+$/),
    denominator: z
      .string()
      .max(30)
      .regex(/^[1-9]\d*$/),
  })
  .strict();
export type Rational = z.infer<typeof rationalSchema>;
export const payrollPeriodInputSchema = z
  .object({
    code: text,
    name: text,
    periodStart: isoDateSchema,
    periodEnd: isoDateSchema,
    payDate: isoDateSchema,
    payFrequency: frequencySchema,
  })
  .strict()
  .refine((v) => v.periodEnd >= v.periodStart, 'End must not precede start');
export const payrollTransitionSchema = z
  .object({
    expectedRevision: revisionSchema,
    warningAcknowledgments: z.array(z.string()).default([]),
  })
  .strict();
export const payrollComputeSchema = payrollTransitionSchema.extend({ idempotencyKey: z.uuid() });
export const payrollTypeStatusSchema = z
  .object({ active: z.boolean(), expectedRevision: revisionSchema })
  .strict();
export const statutoryActivationSchema = payrollTransitionSchema.extend({
  supersedesId: z.uuid().nullable().default(null),
});
export const payrollPolicySchema = z
  .object({
    monthlyAllocation: z.enum(['calendar_month', 'annual_periods']),
    prorationBasis: z.enum(['calendar_days', 'scheduled_minutes']),
    monthlyDailyDivisor: rationalSchema,
    standardMinutesPerDay: z.number().int().min(1).max(1440),
    deductLate: z.boolean(),
    deductUndertime: z.boolean(),
    deductAbsence: z.boolean(),
    contributionCutoff: z.enum(['every_period', 'last_period_of_month']),
  })
  .strict()
  .refine(
    (v) =>
      /^\d+$/.test(v.monthlyDailyDivisor.numerator) &&
      /[1-9]/.test(v.monthlyDailyDivisor.numerator),
    'Divisor must be positive',
  );
export type PayrollPolicy = z.infer<typeof payrollPolicySchema>;
export const payrollPolicyInputSchema = z
  .object({
    version: text,
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable().default(null),
    policy: payrollPolicySchema,
    supersedesId: z.uuid().nullable().default(null),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, 'Invalid effectivity');
export const payrollTypeInputSchema = z
  .object({
    kind: z.enum(['earning', 'deduction']),
    code: text,
    name: text,
    taxable: z.boolean().default(true),
    category: z.enum(['attendance', 'loan', 'company', 'other']).default('other'),
    active: z.boolean().default(true),
  })
  .strict();
export const payrollEntryInputSchema = z
  .object({
    employeeId: z.uuid(),
    typeId: z.uuid(),
    amount: nonNegativeCentavosSchema,
    reason: z.string().trim().min(1).max(2000),
    periodId: z.uuid().nullable().default(null),
    startDate: isoDateSchema.nullable().default(null),
    endDate: isoDateSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      v.periodId !== null
        ? v.startDate === null && v.endDate === null
        : v.startDate !== null && (!v.endDate || v.endDate >= v.startDate),
    'Select one-time period or recurring date range',
  );
export const statutoryTypeSchema = z.enum(['sss', 'philhealth', 'pagibig', 'bir']);
export const statutoryBracketSchema = z
  .object({
    lower: nonNegativeCentavosSchema,
    upper: nonNegativeCentavosSchema.nullable(),
    fixedEmployee: nonNegativeCentavosSchema.default(0),
    fixedEmployer: nonNegativeCentavosSchema.default(0),
    employeeRate: rationalSchema,
    employerRate: rationalSchema,
    excessOver: nonNegativeCentavosSchema.default(0),
  })
  .strict()
  .refine((v) => v.upper === null || v.upper > v.lower, 'Invalid bracket bounds');
export const statutoryRulesSchema = z
  .object({
    basis: z.enum(['basic', 'gross', 'taxable']),
    frequency: z.enum(['monthly', 'semi_monthly', 'weekly', 'biweekly']),
    effectiveDateBasis: z.enum(['period_end', 'pay_date']),
    minimumBasis: nonNegativeCentavosSchema.default(0),
    maximumBasis: nonNegativeCentavosSchema.nullable().default(null),
    employeeShareTaxDeductible: z.boolean().default(false),
    brackets: z.array(statutoryBracketSchema).min(1).max(500),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.maximumBasis !== null && v.maximumBasis < v.minimumBasis)
      c.addIssue({ code: 'custom', message: 'Invalid basis cap' });
    if (v.brackets[0]?.lower !== 0)
      c.addIssue({ code: 'custom', message: 'Brackets must begin at zero' });
    for (let i = 1; i < v.brackets.length; i++)
      if (v.brackets[i - 1]!.upper !== v.brackets[i]!.lower)
        c.addIssue({ code: 'custom', message: 'Brackets must be ordered and contiguous' });
    if (v.brackets.at(-1)?.upper !== null)
      c.addIssue({ code: 'custom', message: 'Last bracket must be unbounded' });
  });
export const statutoryImportSchema = z
  .object({
    type: statutoryTypeSchema,
    version: text,
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable().default(null),
    agency: text,
    sourceTitle: text,
    sourceReference: z.string().trim().min(1).max(2000),
    verificationNote: z.string().trim().min(1).max(2000),
    rules: statutoryRulesSchema,
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, 'Invalid effectivity');
export type StatutoryRules = z.infer<typeof statutoryRulesSchema>;
export type StatutoryType = z.infer<typeof statutoryTypeSchema>;
export interface PayrollIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  employeeId?: string;
}
export interface PayrollLine {
  code: string;
  description: string;
  amount: number;
  taxable: boolean;
  metadata: Record<string, unknown>;
}
export interface PayrollContribution {
  type: StatutoryType;
  ruleSetId: string;
  employeeShare: number;
  employerShare: number;
  basisAmount: number;
  taxDeductible: boolean;
  metadata: Record<string, unknown>;
}
export interface PayrollResult {
  employeeId: string;
  basicPay: number;
  grossPay: number;
  ordinaryDeductions: number;
  employeeContributions: number;
  employerContributions: number;
  withholdingTax: number;
  totalDeductions: number;
  taxableCompensation: number;
  netPay: number;
  earnings: PayrollLine[];
  deductions: PayrollLine[];
  contributions: PayrollContribution[];
  taxTrace: Record<string, unknown>;
  issues: PayrollIssue[];
}

const persistedAmount = z
  .union([
    z.number().int(),
    z
      .string()
      .regex(/^-?\d+$/)
      .transform(Number),
  ])
  .refine(Number.isSafeInteger, 'Unsafe monetary value');
export const payrollIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  employeeId: z.string().optional(),
});
export const payrollTotalsSchema = z.object({
  employees: z.number().int(),
  basicPay: persistedAmount,
  grossPay: persistedAmount,
  ordinaryDeductions: persistedAmount,
  employeeContributions: persistedAmount,
  employerContributions: persistedAmount,
  withholdingTax: persistedAmount,
  totalDeductions: persistedAmount,
  netPay: persistedAmount,
});
export const payrollPeriodResponseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  period_start: isoDateSchema,
  period_end: isoDateSchema,
  pay_date: isoDateSchema,
  pay_frequency: frequencySchema,
  status: z.enum(['draft', 'open', 'review', 'finalized', 'cancelled']),
  revision: revisionSchema,
  latest_run_id: z.uuid().nullable(),
  reviewed_run_id: z.uuid().nullable(),
  reviewed_by: z.uuid().nullable(),
  finalized_by: z.uuid().nullable(),
  warning_acknowledgments: z.array(z.string()),
  totals: payrollTotalsSchema.nullable().optional(),
});
export const payrollRunResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(['processing', 'computed', 'failed']),
  totals: payrollTotalsSchema,
  issues: z.array(payrollIssueSchema),
  engine_version: z.string(),
  prepared_by: z.uuid(),
  created_at: z.string(),
});
export const payrollEmployeeResponseSchema = z.object({
  id: z.uuid(),
  employee_id: z.uuid(),
  payroll_run_id: z.uuid(),
  basic_pay: persistedAmount,
  gross_pay: persistedAmount,
  ordinary_deductions: persistedAmount,
  employee_contributions: persistedAmount,
  employer_contributions: persistedAmount,
  withholding_tax: persistedAmount,
  taxable_compensation: persistedAmount,
  total_deductions: persistedAmount,
  net_pay: persistedAmount,
  status: z.enum(['computed', 'failed', 'finalized']),
  snapshot: z.record(z.string(), z.unknown()),
  tax_trace: z.record(z.string(), z.unknown()),
  issues: z.array(payrollIssueSchema),
  employee_number: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
export const payrollDetailResponseSchema = z.object({
  period: payrollPeriodResponseSchema,
  runs: z.array(payrollRunResponseSchema),
  results: z.array(payrollEmployeeResponseSchema),
  stale: z.boolean(),
});
export const payrollPersistedLineSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  description: z.string(),
  amount: persistedAmount,
  taxable: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
});
export const payrollPersistedContributionSchema = z.object({
  id: z.uuid(),
  type: statutoryTypeSchema,
  rule_set_id: z.uuid(),
  employee_share: persistedAmount,
  employer_share: persistedAmount,
  basis_amount: persistedAmount,
  metadata: z.record(z.string(), z.unknown()),
});
export const payrollResultDetailSchema = payrollEmployeeResponseSchema.extend({
  engine_version: z.string(),
  pay_date: isoDateSchema,
  period_start: isoDateSchema,
  period_end: isoDateSchema,
  payroll_earning_lines: z.array(payrollPersistedLineSchema),
  payroll_deduction_lines: z.array(payrollPersistedLineSchema),
  payroll_contribution_lines: z.array(payrollPersistedContributionSchema),
});
