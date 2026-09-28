/**
 * Money handling for Hex Payroll.
 *
 * RULE: every monetary value in this system is an INTEGER NUMBER OF CENTAVOS.
 * Floating-point pesos are never stored, never summed and never passed to the
 * database. Binary floating point cannot represent decimal money exactly
 * (0.1 + 0.2 !== 0.3), and in payroll those errors compound across earnings,
 * deductions, contributions and withholding tax until payslips fail to
 * reconcile. PostgreSQL holds these values as `numeric(14,2)`; JavaScript holds
 * them as integers of centavos; conversion happens only at the edges via
 * `centavosToDecimalString` / `decimalStringToCentavos`.
 */

/** An integer number of centavos. 1 peso = 100 centavos. */
export type Centavos = number;

export const CENTAVOS_PER_PESO = 100;

/** Throws unless `value` is a safe integer number of centavos. */
export function assertCentavos(value: number, label = 'value'): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${label} must be a safe integer number of centavos, received: ${String(value)}`,
    );
  }
}

/** True when `value` is a safe integer number of centavos. */
export function isCentavos(value: unknown): value is Centavos {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Converts a peso amount (e.g. from user input or a rate table) to centavos.
 * Rounds to the nearest centavo.
 */
export function pesosToCentavos(pesos: number): Centavos {
  if (!Number.isFinite(pesos)) {
    throw new RangeError(`pesos must be a finite number, received: ${String(pesos)}`);
  }
  return Math.round(pesos * CENTAVOS_PER_PESO);
}

/** Converts centavos to a peso amount. Display/reporting only. */
export function centavosToPesos(centavos: Centavos): number {
  assertCentavos(centavos, 'centavos');
  return centavos / CENTAVOS_PER_PESO;
}

export function addCentavos(...amounts: readonly Centavos[]): Centavos {
  let total = 0;
  for (const amount of amounts) {
    assertCentavos(amount, 'amount');
    total += amount;
  }
  assertCentavos(total, 'total');
  return total;
}

export function sumCentavos(amounts: readonly Centavos[]): Centavos {
  return addCentavos(...amounts);
}

export function subtractCentavos(minuend: Centavos, subtrahend: Centavos): Centavos {
  assertCentavos(minuend, 'minuend');
  assertCentavos(subtrahend, 'subtrahend');
  return minuend - subtrahend;
}

/** Multiplies a centavo amount by a factor (e.g. an overtime rate), rounding to the centavo. */
export function multiplyCentavos(centavos: Centavos, factor: number): Centavos {
  assertCentavos(centavos, 'centavos');
  if (!Number.isFinite(factor)) {
    throw new RangeError(`factor must be a finite number, received: ${String(factor)}`);
  }
  return Math.round(centavos * factor);
}

/**
 * Splits `total` across `weights` so that the parts sum EXACTLY to `total`.
 *
 * Uses the largest-remainder method: floor each exact share, then distribute
 * the leftover centavos to the largest fractional parts (ties broken by index,
 * so the result is deterministic). This matters whenever a total must be
 * divided — allocating a pay-run pot across days worked, splitting a
 * contribution across periods — because naive per-part rounding silently loses
 * or invents centavos and the payslip stops reconciling to the control total.
 *
 * The sign of `total` is preserved.
 */
export function allocateCentavos(total: Centavos, weights: readonly number[]): Centavos[] {
  assertCentavos(total, 'total');
  if (weights.length === 0) {
    throw new RangeError('weights must contain at least one entry');
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new RangeError('weights must be finite, non-negative numbers');
  }

  const totalWeight = weights.reduce((acc, weight) => acc + weight, 0);
  if (totalWeight <= 0) {
    throw new RangeError('the sum of weights must be greater than zero');
  }

  const sign = total < 0 ? -1 : 1;
  const absoluteTotal = Math.abs(total);

  const exactShares = weights.map((weight) => (absoluteTotal * weight) / totalWeight);
  const shares = exactShares.map((share) => Math.floor(share));
  let remaining = absoluteTotal - shares.reduce((acc, share) => acc + share, 0);

  const byLargestFraction = exactShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byLargestFraction) {
    if (remaining <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remaining -= 1;
  }

  return shares.map((share) => share * sign);
}

/** Formats centavos as a Philippine peso currency string, e.g. 123456 -> "₱1,234.56". */
export function formatPeso(centavos: Centavos, locale = 'en-PH'): string {
  assertCentavos(centavos, 'centavos');
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavos / CENTAVOS_PER_PESO);
}

/**
 * Renders centavos as a fixed-scale decimal string safe for a PostgreSQL
 * `numeric(14,2)` parameter, e.g. 123456 -> "1234.56", -5 -> "-0.05".
 * Built with integer arithmetic so no float ever touches a numeric column.
 */
export function centavosToDecimalString(centavos: Centavos): string {
  assertCentavos(centavos, 'centavos');
  const sign = centavos < 0 ? '-' : '';
  const absolute = Math.abs(centavos);
  const whole = Math.trunc(absolute / CENTAVOS_PER_PESO);
  const fraction = absolute % CENTAVOS_PER_PESO;
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Parses a PostgreSQL `numeric(14,2)` value (returned as a string by
 * node-postgres) into centavos.
 */
export function decimalStringToCentavos(value: string): Centavos {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new RangeError(`not a valid decimal amount: ${JSON.stringify(value)}`);
  }

  const sign = match[1] ?? '';
  const whole = match[2] ?? '0';
  const fraction = (match[3] ?? '').padEnd(2, '0');

  const total = Number(whole) * CENTAVOS_PER_PESO + Number(fraction);
  assertCentavos(total, 'parsed amount');
  return sign === '-' ? -total : total;
}
