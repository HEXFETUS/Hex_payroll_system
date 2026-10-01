# `@hexpayroll/payroll-engine`

The pure computation core. It must run identically inside the desktop app and on the central
server, and it must be exhaustively unit-testable — so it has **no I/O, no database, no
Express, no Electron**.

|             |                                                                                      |
| ----------- | ------------------------------------------------------------------------------------ |
| Source      | `packages/payroll-engine/src/index.ts`                                               |
| Build       | `tsc -p tsconfig.json` → `dist/` (ESM, `NodeNext`)                                   |
| Depends on  | `@hexpayroll/shared` for the `Centavos` type only                                    |
| Consumed by | `apps/api` (logs `PAYROLL_ENGINE_VERSION` at startup); payroll flows land in Phase 2 |

## Phase 0 scope: contracts only

`PAYROLL_ENGINE_VERSION = '0.1.0'` is exported so the API can log which engine built the
process it is running.

**No payroll rule is implemented yet, by design.** Contribution and tax rates will arrive as
_versioned reference data with effectivity dates_ — never as literals in this source file —
so that a rate change does not require a new application release.

## Types

| Type                 | Shape                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PayrollPeriodKind`  | `'semi_monthly_first' \| 'semi_monthly_second' \| 'monthly'` (Philippine practice is typically semi-monthly)     |
| `PayrollPeriod`      | `id`, `kind`, `startDate`, `endDate`, `payDate` — ISO `YYYY-MM-DD`, all `readonly`                               |
| `EarningsLine`       | `code`, `description`, `amount: Centavos` (basic pay, overtime, holiday pay, …)                                  |
| `DeductionLine`      | `code`, `description`, `amount: Centavos` (loan amortisation, withholding tax, …)                                |
| `PayslipComputation` | `employeeId`, `periodId`, `grossPay`, `totalDeductions`, `netPay`, `earnings[]`, `deductions[]` — all `readonly` |

## Invariants Phase 2 must implement and test

- `netPay = grossPay - totalDeductions`
- `grossPay` equals the sum of `earnings[].amount`
- `totalDeductions` equals the sum of `deductions[].amount`

Every amount is a `Centavos` integer, so these sums are exact — see
[`shared.md`](shared.md#moneyts--money-is-an-integer-number-of-centavos).
