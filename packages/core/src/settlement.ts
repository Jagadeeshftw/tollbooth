import { parseDecimal } from './decimal.js';
import type { Price } from './types.js';

/**
 * What to do when less money arrives than was asked for.
 *
 * There is no refund path — Moove has no Send endpoint — so a short settlement
 * must never end with the payer holding nothing. The bands below trade a small
 * amount of revenue for never stranding someone who actually paid.
 */
export interface SettlementPolicy {
  /**
   * Shortfall within this fraction of the asking price is granted in full.
   *
   * Default 0.005. Moove's documented market-quote slippage tolerance is
   * 0.10%, so 0.5% absorbs it with room to spare rather than punishing a payer
   * for a route that filled a shade under quote.
   */
  toleranceFraction: number;
  /**
   * Below this fraction of the asking price, grant nothing and leave the
   * charge pending for the tenant to look at. Default 0.10.
   */
  minimumFraction: number;
}

export const DEFAULT_SETTLEMENT_POLICY: SettlementPolicy = {
  toleranceFraction: 0.005,
  minimumFraction: 0.1,
};

export type SettlementDecision =
  /** Grant everything the price promises. */
  | { kind: 'full'; receivedFraction: number }
  /** Grant a reduced entitlement proportional to what landed. */
  | {
      kind: 'pro_rata';
      receivedFraction: number;
      /** Scaled credits, floored at 1. `null` for an unlimited pass. */
      credits: number | null;
      /** Scaled lifetime in ms. `null` when the price never expires. */
      ttlMs: number | null;
    }
  /** Too little to be worth anything. Nothing granted, charge stays pending. */
  | { kind: 'reject'; receivedFraction: number };

const PPM = 1_000_000n;

/** Align two decimals onto a common scale so their units are comparable. */
function alignedUnits(a: string, b: string): [bigint, bigint] {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const scale = Math.max(x.scale, y.scale);
  return [
    x.units * 10n ** BigInt(scale - x.scale),
    y.units * 10n ** BigInt(scale - y.scale),
  ];
}

export function assertValidPolicy(policy: SettlementPolicy): void {
  const { toleranceFraction, minimumFraction } = policy;
  for (const [name, value] of [
    ['toleranceFraction', toleranceFraction],
    ['minimumFraction', minimumFraction],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${name} must be between 0 and 1, received ${value}`);
    }
  }
  if (minimumFraction > 1 - toleranceFraction) {
    throw new RangeError(
      'minimumFraction must leave room below the tolerance band; ' +
        `received minimum ${minimumFraction} with tolerance ${toleranceFraction}`
    );
  }
}

/**
 * Decide what a settled-but-short payment buys.
 *
 * `received === null` is treated as full: some responses do not carry the
 * amount, and a completed link with no figure to check is not evidence of a
 * shortfall.
 */
export function decideSettlement(args: {
  expected: string;
  received: string | null;
  price: Price;
  policy?: SettlementPolicy;
}): SettlementDecision {
  const policy = args.policy ?? DEFAULT_SETTLEMENT_POLICY;
  assertValidPolicy(policy);

  if (args.received === null) return { kind: 'full', receivedFraction: 1 };

  const [expectedUnits, receivedUnits] = alignedUnits(args.expected, args.received);
  if (expectedUnits <= 0n) return { kind: 'full', receivedFraction: 1 };

  if (receivedUnits >= expectedUnits) return { kind: 'full', receivedFraction: 1 };

  // Exact ratio in parts per million; no floating point in the decision itself.
  const ratioPpm = (receivedUnits * PPM) / expectedUnits;
  const receivedFraction = Number(ratioPpm) / 1_000_000;

  const toleranceFloorPpm = PPM - BigInt(Math.round(policy.toleranceFraction * 1_000_000));
  if (ratioPpm >= toleranceFloorPpm) return { kind: 'full', receivedFraction };

  const minimumPpm = BigInt(Math.round(policy.minimumFraction * 1_000_000));
  if (ratioPpm < minimumPpm) return { kind: 'reject', receivedFraction };

  // Scale whatever the price grants, flooring so we never round in our favour.
  const credits =
    args.price.credits === null
      ? null
      : Math.max(1, Number((BigInt(args.price.credits) * receivedUnits) / expectedUnits));

  const ttlMs =
    args.price.ttlMs === null
      ? null
      : Math.max(1, Number((BigInt(Math.round(args.price.ttlMs)) * receivedUnits) / expectedUnits));

  return { kind: 'pro_rata', receivedFraction, credits, ttlMs };
}
