import { InvalidDecimalError, compareDecimal, isPositiveDecimal } from './decimal.js';
import type { Entitlement, Price, PricingUnit, Sku, Subject } from './types.js';

/**
 * Minimum sensible credit-pack price.
 *
 * Not a Moove constraint — Moove's protocol fee is 0.02%, which is $0.001 on a
 * $5 pack and never binds. The floor exists because of what the payer bears
 * (network gas, and a bridge relayer fee when they arrive cross-chain, often
 * $0.10-$0.50 fixed) and because every purchase costs a human 30-60 seconds of
 * attention. Packs should be sized to keep the human out of the loop.
 */
export const MIN_CREDIT_PACK_AMOUNT = '5.00';

export class InvalidPriceError extends Error {
  override readonly name = 'InvalidPriceError';
  constructor(message: string) {
    super(message);
  }
}

export interface DefinePriceInput {
  sku: Sku;
  unit: PricingUnit;
  amount: string;
  currency?: string;
  credits?: number | null;
  ttlMs?: number | null;
  label?: string;
  /**
   * Permit a credit pack priced below {@link MIN_CREDIT_PACK_AMOUNT}.
   * Only sensible when you can guarantee payers settle same-chain, same-token,
   * where Moove charges nothing and gas is a fraction of a cent.
   */
  allowBelowMinimum?: boolean;
}

/**
 * Build a validated {@link Price}, rejecting combinations the model cannot
 * represent. Every unit's invariants are enforced here so that the rest of the
 * system can treat a `Price` as already-coherent.
 */
export function definePrice(input: DefinePriceInput): Price {
  const { sku, unit, amount } = input;

  if (!sku || typeof sku !== 'string') {
    throw new InvalidPriceError('sku is required and must be a non-empty string');
  }
  if (!isPositiveDecimal(amount)) {
    throw new InvalidDecimalError(String(amount), 'price must be a positive decimal string');
  }

  const currency = input.currency ?? 'USDC';
  const label = input.label ?? sku;

  let credits: number | null;
  let ttlMs: number | null;

  switch (unit) {
    case 'per_call': {
      // One call, no expiry. Credits are fixed at 1 by definition.
      if (input.credits !== undefined && input.credits !== 1) {
        throw new InvalidPriceError(
          'a per_call price grants exactly 1 credit; use credit_pack for more'
        );
      }
      credits = 1;
      ttlMs = input.ttlMs ?? null;
      break;
    }

    case 'credit_pack': {
      const n = input.credits;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
        throw new InvalidPriceError('a credit_pack requires an integer credits >= 1');
      }
      if (!input.allowBelowMinimum && compareDecimal(amount, MIN_CREDIT_PACK_AMOUNT) < 0) {
        throw new InvalidPriceError(
          `credit pack ${JSON.stringify(sku)} is priced at ${amount} ${currency}, below the ` +
            `${MIN_CREDIT_PACK_AMOUNT} minimum. Below this, the payer's gas and bridge costs ` +
            'can rival the purchase, and the human is interrupted too often. ' +
            'Pass allowBelowMinimum: true if payers settle same-chain, same-token.'
        );
      }
      credits = n;
      ttlMs = input.ttlMs ?? null;
      break;
    }

    case 'time_pass': {
      // Unlimited calls for a bounded window. That is the whole point, so an
      // unbounded time pass is almost certainly a mistake rather than a choice.
      if (input.credits !== undefined && input.credits !== null) {
        throw new InvalidPriceError(
          'a time_pass grants unlimited calls; leave credits null and set ttlMs'
        );
      }
      if (typeof input.ttlMs !== 'number' || !Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
        throw new InvalidPriceError('a time_pass requires a positive ttlMs');
      }
      credits = null;
      ttlMs = input.ttlMs;
      break;
    }

    default: {
      const never: never = unit;
      throw new InvalidPriceError(`unknown pricing unit ${JSON.stringify(never)}`);
    }
  }

  return { sku, unit, amount, currency, credits, ttlMs, label };
}

/**
 * The single place a Price becomes an Entitlement. Collapsing the three units
 * into `remaining`/`expiresAt` happens here and nowhere else.
 */
export function entitlementFromPrice(args: {
  price: Price;
  subject: Subject;
  chargeId: string;
  entitlementId: string;
  now: number;
}): Entitlement {
  const { price, subject, chargeId, entitlementId, now } = args;
  return {
    id: entitlementId,
    subject,
    sku: price.sku,
    remaining: price.credits,
    expiresAt: price.ttlMs === null ? null : now + price.ttlMs,
    chargeId,
    createdAt: now,
    version: 0,
  };
}

/** Whether an entitlement is spent, expired, or otherwise unusable at `now`. */
export function isUsable(e: Entitlement, now: number, cost = 1): boolean {
  if (e.expiresAt !== null && now >= e.expiresAt) return false;
  if (e.remaining !== null && e.remaining < cost) return false;
  return true;
}
