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
 * Re-check a credit pack against {@link MIN_CREDIT_PACK_AMOUNT}, independent of
 * how the `Price` was built.
 *
 * `definePrice` enforces this floor too, but its `allowBelowMinimum` escape
 * hatch is consumed at construction time and leaves no trace on the `Price`
 * object it returns — there is no field on `Price` recording that a bypass
 * happened. So a below-floor price that reaches a payment provider by any
 * other route (built by hand, or — once prices can be edited remotely —
 * loaded from outside this process) looks identical to one that was never
 * validated at all. A provider that wants a local floor must re-check the
 * object itself, which is what this is for: see
 * `MooveProviderOptions.allowBelowMinimum`, which exempts specific SKUs by
 * name, in code the tenant controls, rather than trusting anything the
 * `Price` object claims about itself.
 *
 * Only `credit_pack` has a floor; `per_call` is fixed at one credit and
 * `time_pass` has no minimum today.
 */
export function assertPriceFloor(price: Price): void {
  if (price.unit !== 'credit_pack') return;
  if (compareDecimal(price.amount, MIN_CREDIT_PACK_AMOUNT) < 0) {
    throw new InvalidPriceError(
      `credit pack ${JSON.stringify(price.sku)} would be sold at ${price.amount} ` +
        `${price.currency}, below the ${MIN_CREDIT_PACK_AMOUNT} minimum. It was not rejected ` +
        'when it was built, which means either it bypassed definePrice or it used ' +
        'allowBelowMinimum — and a payment provider does not trust that bypass by itself. ' +
        "Name this sku in the provider's own allowBelowMinimum list if this is intentional."
    );
  }
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
