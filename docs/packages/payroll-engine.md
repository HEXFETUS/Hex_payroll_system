# Payroll engine Phase 3 exports

`packages/payroll-engine` is a pure ESM computation library. It depends on shared
contracts and integer assertions, with no database, Express, React, Electron,
clock reads, random values, or network operations. `PAYROLL_ENGINE_VERSION` is
`0.3.0` and is preserved in every run and employee snapshot.

The engine exports `roundRatio`, `rate`, `exactSum`, and `allocateExact` for exact
arithmetic; `resolveCompensation`, `computeBasicPay`,
`computeAttendanceAdjustments`, `computeEarnings`, `computeGrossPay`,
`computeContributions`, `computeDeductions`, `computeTaxableIncome`,
`computeWithholdingTax`, `computeNetPay`, and `validateResult` for the stages;
`computeEmployeePayroll` for orchestration; and `computePremiumEarning` as an
explicit premium-fact boundary.

`EmployeePayrollContext` supplies dates, company policy, effective employment
versions, approved daily facts, earning/deduction inputs, applicable rule versions,
monthly contribution bases, and earlier finalized contribution collections. The
result contains centavo totals, normalized lines, contribution shares, tax trace,
and typed blocking/warning issues. Missing rules produce errors alongside draft
figures rather than valid zero statutory obligations.

`AppliedRule` is supplied by the API loader; `evaluateRule` performs bracket/cap
evaluation without resolving reference data or querying storage. No Philippine
statutory rates are included. Test data are explicitly synthetic.

Legacy period/earning/payslip interfaces remain exported for compatibility.
Operational rules and limitations are documented in [Phase 3 payroll](../phase3-payroll.md).
Run `pnpm --filter @hexpayroll/payroll-engine test` for deterministic unit tests.
