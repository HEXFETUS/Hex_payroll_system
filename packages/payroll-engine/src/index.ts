/**
 * Hex Payroll computation core.
 *
 * PHASE 0 SCOPE: contracts only.
 *
 * This package is deliberately a pure library — no I/O, no database, no
 * Electron, no Express. It must run identically inside the desktop app and on
 * the central server, and it must be exhaustively unit-testable.
 *
 * PAYROLL RULES ARE NOT IMPLEMENTED YET, BY DESIGN. Phase 0 establishes the
 * foundation (workspace, API, PostgreSQL, Electron) before any payroll-domain
 * complexity enters the project. Contribution and tax RATES will arrive as
 * versioned reference data with effectivity dates — never as literals in this
 * source file — so that a rate change does not require a new application
 * release.
 */

import type { Centavos } from '@hexpayroll/shared';

export const PAYROLL_ENGINE_VERSION = '0.1.0';

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
