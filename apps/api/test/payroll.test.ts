import test from 'node:test';
import assert from 'node:assert/strict';
import {
  payrollPeriodInputSchema,
  payrollPolicyInputSchema,
  statutoryImportSchema,
} from '@hexpayroll/shared';
import { canonical, fingerprint } from '../src/payroll/services.js';
test('payroll fingerprints use canonical ordering and preserve dates', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  assert.notEqual(
    fingerprint({ at: new Date('2025-01-01') }),
    fingerprint({ at: new Date('2025-01-02') }),
  );
  assert.equal(canonical({ a: [1, 2] }), '{"a":[1,2]}');
});
test('period validation accepts four frequencies and rejects reversed or invalid dates', () => {
  for (const payFrequency of ['monthly', 'semi_monthly', 'weekly', 'biweekly'])
    assert(
      payrollPeriodInputSchema.safeParse({
        code: 'P',
        name: 'Period',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-15',
        payDate: '2026-10-20',
        payFrequency,
      }).success,
    );
  assert(
    !payrollPeriodInputSchema.safeParse({
      code: 'P',
      name: 'Period',
      periodStart: '2026-10-15',
      periodEnd: '2026-10-01',
      payDate: '2026-10-20',
      payFrequency: 'monthly',
    }).success,
  );
});
test('monetary policies and reference imports require explicit valid configuration', () => {
  assert(!payrollPolicyInputSchema.safeParse({}).success);
  assert(!statutoryImportSchema.safeParse({ type: 'sss', version: 'invented' }).success);
});
