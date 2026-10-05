import { assertCentavos } from '@hexpayroll/shared';
import type { Rational } from '@hexpayroll/shared';

export function roundRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n,
    absolute = numerator * sign;
  const amount = Number(
    sign * (absolute / denominator + ((absolute % denominator) * 2n >= denominator ? 1n : 0n)),
  );
  assertCentavos(amount, 'Rounded amount');
  return amount;
}
export function rate(amount: number, ratio: Rational): number {
  assertCentavos(amount);
  return roundRatio(BigInt(amount) * BigInt(ratio.numerator), BigInt(ratio.denominator));
}
export function exactSum(amounts: readonly number[]): number {
  let sum = 0n;
  for (const amount of amounts) {
    assertCentavos(amount);
    sum += BigInt(amount);
  }
  const result = Number(sum);
  assertCentavos(result, 'Total');
  return result;
}
export function allocateExact(total: number, weights: readonly number[]): number[] {
  assertCentavos(total);
  if (weights.length === 0 || weights.some((v) => !Number.isSafeInteger(v) || v < 0))
    throw new RangeError('Invalid allocation weights');
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (sum === 0n) throw new RangeError('Empty allocation basis');
  const sign = total < 0 ? -1 : 1,
    t = BigInt(Math.abs(total));
  const shares = weights.map((w) => Number((t * BigInt(w)) / sum));
  let remainder = Math.abs(total) - exactSum(shares);
  const order = weights
    .map((w, i) => ({ i, r: (t * BigInt(w)) % sum }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of order) {
    if (remainder-- <= 0) break;
    shares[i] = shares[i]! + 1;
  }
  return shares.map((v) => v * sign);
}
