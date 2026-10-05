/**
 * Hex Payroll computation core.
 *
 * Phase 3: deterministic payroll stages and explicit versioned rule inputs.
 *
 * This package is deliberately a pure library — no I/O, no database, no
 * Electron, no Express. It must run identically inside the desktop app and on
 * the central server, and it must be exhaustively unit-testable.
 *
 * Contribution and tax rates are supplied as verified, versioned reference
 * data. No production statutory rates are bundled in this library.
 */

import type { Centavos } from '@hexpayroll/shared';

export const PAYROLL_ENGINE_VERSION = '0.3.0';
export * from './arithmetic.js';
export * from './computation.js';

/** How a payroll period is cut. Philippine practice is typically semi-monthly. */
export type PayrollPeriodKind = 'semi_monthly_first' | 'semi_monthly_second' | 'monthly';

/** A covered period and the date it is paid. Dates are ISO `YYYY-MM-DD`. */
export interface PayrollPeriod {
  readonly id: string;
  readonly kind: PayrollPeriodKind;
  readonly startDate: string;
  readonly endDate: string;
  readonly payDate: string;
}

/** A single earning component of a payslip (basic pay, overtime, holiday pay, ...). */
export interface EarningsLine {
  readonly code: string;
  readonly description: string;
  readonly amount: Centavos;
}

/** A single deduction component of a payslip (loan amortisation, withholding tax, ...). */
export interface DeductionLine {
  readonly code: string;
  readonly description: string;
  readonly amount: Centavos;
}

/**
 * The computed result for one employee for one period.
 *
 * Invariant Phase 2 must guarantee and test: `netPay = grossPay - totalDeductions`,
 * and `grossPay` / `totalDeductions` each equal the sum of their lines.
 */
export interface PayslipComputation {
  readonly employeeId: string;
  readonly periodId: string;
  readonly grossPay: Centavos;
  readonly totalDeductions: Centavos;
  readonly netPay: Centavos;
  readonly earnings: readonly EarningsLine[];
  readonly deductions: readonly DeductionLine[];
}
