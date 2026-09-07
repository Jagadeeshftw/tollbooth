/**
 * Money is a decimal string end to end, never a JavaScript number.
 *
 * `0.1 + 0.2 !== 0.3`, and a rounding error here is a real mispriced charge.
 * Everything in Tollbooth that touches an amount takes and returns a string;
 * the only arithmetic we do is exact, on bigints.
 */

/** A parsed decimal: `units` scaled by 10^`scale`. `"1.50"` -> `{units: 150n, scale: 2}`. */
export interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export class InvalidDecimalError extends Error {
  override readonly name = 'InvalidDecimalError';
  constructor(readonly value: string, reason: string) {
    super(`Invalid decimal amount ${JSON.stringify(value)}: ${reason}`);
  }
}

export function parseDecimal(value: string): Decimal {
  if (typeof value !== 'string') {
    throw new InvalidDecimalError(String(value), 'amounts must be strings, not numbers');
  }
  const trimmed = value.trim();
  if (trimmed === '' || !DECIMAL_RE.test(trimmed)) {
    throw new InvalidDecimalError(value, 'expected a plain decimal such as "5.00"');
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf('.');
  const digits = dot === -1 ? unsigned : unsigned.slice(0, dot) + unsigned.slice(dot + 1);
  const scale = dot === -1 ? 0 : unsigned.length - dot - 1;
  const units = BigInt(digits) * (negative ? -1n : 1n);
  return { units, scale };
}

/** Re-scale two decimals to a common scale so their units are comparable. */
function align(a: Decimal, b: Decimal): [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);
  const lift = (d: Decimal) => d.units * 10n ** BigInt(scale - d.scale);
  return [lift(a), lift(b)];
}

/** -1 if a < b, 0 if equal, 1 if a > b. Exact; no floating point involved. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = align(parseDecimal(a), parseDecimal(b));
  return x < y ? -1 : x > y ? 1 : 0;
}

export function decimalGte(a: string, b: string): boolean {
  return compareDecimal(a, b) >= 0;
}

export function isPositiveDecimal(value: string): boolean {
  try {
    return parseDecimal(value).units > 0n;
  } catch {
    return false;
  }
}

/** Number of digits after the decimal point. Used to check token precision. */
export function decimalScale(value: string): number {
  return parseDecimal(value).scale;
}

/**
 * Normalise to a fixed number of decimal places without rounding.
 * Throws rather than silently truncating, because truncating money is a bug.
 */
export function toFixedScale(value: string, scale: number): string {
  const d = parseDecimal(value);
  if (d.scale > scale) {
    throw new InvalidDecimalError(
      value,
      `has ${d.scale} decimal places but only ${scale} are supported; ` +
        'round it yourself if that is what you intend'
    );
  }
  const lifted = d.units * 10n ** BigInt(scale - d.scale);
  const negative = lifted < 0n;
  const digits = (negative ? -lifted : lifted).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale === 0 ? '' : '.' + digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${frac}`;
}
