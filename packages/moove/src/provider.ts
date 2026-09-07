import {
  decimalGte,
  entitlementFromPrice,
  mintChargeId,
  mintEntitlementId,
  mintNonce,
} from '@tollbooth/core';
import type { Charge, EntitlementStore, Price, Sku, Subject } from '@tollbooth/core';

import type { MooveClient, MoovePaymentLink } from './client.js';
import { isTerminalStatus, shouldPoll } from './poller.js';

/** Prefix on the Moove `description` field that binds a payment to a charge. */
export const NONCE_PREFIX = 'tb_';

/**
 * How long a checkout stays payable.
 *
 * Moove has no endpoint to deactivate a link, so `expirationDate` is the only
 * containment there is. Short is safer: an abandoned link that never expires is
 * a payment that can arrive months later against an entitlement nobody is
 * waiting for.
 */
export const DEFAULT_CHARGE_TTL_MS = 15 * 60 * 1000;

export type SettlementOutcome =
  | { status: 'pending'; charge: Charge }
  | { status: 'granted'; charge: Charge; entitlementId: string }
  | { status: 'already_granted'; charge: Charge }
  | { status: 'expired'; charge: Charge }
  /**
   * Settled for less than asked. Moove's docs say a payment link debits the
   * payer enough to deliver the full amount, so this should not happen — which
   * is exactly why it is surfaced rather than absorbed. Not granted
   * automatically; the charge stays pending so reconciliation keeps raising it.
   */
  | { status: 'underpaid'; charge: Charge; expected: string; received: string };

export interface MooveProviderOptions {
  client: MooveClient;
  store: EntitlementStore;
  /** Everything this server sells. Looked up by sku when granting. */
  prices: readonly Price[];
  chargeTtlMs?: number;
  now?: () => number;
}

/**
 * Ties the Moove API to the entitlement model: opens a charge, and settles one
 * exactly once when the money arrives.
 */
export class MooveProvider {
  readonly #client: MooveClient;
  readonly #store: EntitlementStore;
  readonly #prices: Map<Sku, Price>;
  readonly #chargeTtlMs: number;
  readonly #now: () => number;

  constructor(options: MooveProviderOptions) {
    this.#client = options.client;
    this.#store = options.store;
    this.#prices = new Map(options.prices.map((p) => [p.sku, p]));
    this.#chargeTtlMs = options.chargeTtlMs ?? DEFAULT_CHARGE_TTL_MS;
    this.#now = options.now ?? Date.now;
  }

  priceFor(sku: Sku): Price | undefined {
    return this.#prices.get(sku);
  }

  /**
   * Create a checkout for one purchase.
   *
   * Always one link per charge with `maxUsage: 1`. Moove exposes nothing that
   * identifies a payer, so a link shared between two buyers would be
   * unattributable by construction; one link per charge makes attribution a
   * property of the design rather than a guess.
   */
  async openCharge(args: { sku: Sku; subject: Subject }): Promise<{ charge: Charge; checkoutUrl: string }> {
    const price = this.#prices.get(args.sku);
    if (!price) throw new Error(`no price registered for sku ${JSON.stringify(args.sku)}`);

    const now = this.#now();
    const nonce = mintNonce();
    const expiresAt = now + this.#chargeTtlMs;

    const created = await this.#client.createPaymentLink({
      toAmount: price.amount,
      description: `${NONCE_PREFIX}${nonce}`,
      maxUsage: 1,
      expirationDate: new Date(expiresAt).toISOString(),
    });

    const charge: Charge = {
      id: mintChargeId(),
      nonce,
      subject: args.subject,
      sku: args.sku,
      amount: price.amount,
      status: 'pending',
      providerRef: created.id,
      checkoutUrl: created.url,
      createdAt: now,
      expiresAt,
      settledAt: null,
      receivedAmount: null,
      lastPolledAt: null,
      pollCount: 0,
    };
    await this.#store.putCharge(charge);
    return { charge, checkoutUrl: created.url };
  }

  /**
   * Ask whether a charge has settled, and grant on the first observation that
   * it has.
   *
   * Safe to call from the agent's retry path and from a background reconciler
   * at the same time: `claimSettlement` lets exactly one of them grant.
   */
  async settleCharge(nonce: string, options: { force?: boolean } = {}): Promise<SettlementOutcome> {
    const charge = await this.#store.getCharge(nonce);
    if (!charge) throw new Error(`no charge with nonce ${nonce}`);

    if (charge.status === 'settled') return { status: 'already_granted', charge };
    if (charge.status === 'abandoned') return { status: 'expired', charge };

    const now = this.#now();
    if (now >= charge.expiresAt) {
      await this.#store.updateCharge(nonce, { status: 'abandoned' });
      return { status: 'expired', charge: { ...charge, status: 'abandoned' } };
    }

    // Respect the floor between polls however eagerly the agent retries.
    if (!shouldPoll({ lastPolledAt: charge.lastPolledAt, now, ...(options.force !== undefined ? { force: options.force } : {}) })) {
      return { status: 'pending', charge };
    }

    if (!charge.providerRef) return { status: 'pending', charge };
    const link = await this.#client.readPaymentLink(charge.providerRef);

    await this.#store.updateCharge(nonce, {
      lastPolledAt: now,
      pollCount: charge.pollCount + 1,
    });
    const polled: Charge = { ...charge, lastPolledAt: now, pollCount: charge.pollCount + 1 };

    if (!isTerminalStatus(link.status)) return { status: 'pending', charge: polled };

    if (link.status === 'inactive') {
      await this.#store.updateCharge(nonce, { status: 'abandoned' });
      return { status: 'expired', charge: { ...polled, status: 'abandoned' } };
    }

    return this.#grant(polled, link);
  }

  async #grant(charge: Charge, link: MoovePaymentLink): Promise<SettlementOutcome> {
    const received = link.receivedAmount ?? null;

    // Checked even though the fee schedule says the payer covers the protocol
    // fee and the payee receives the full amount. Granting paid capability on
    // an unverified number is not a saving worth making.
    if (received !== null && !decimalGte(received, charge.amount)) {
      await this.#store.updateCharge(charge.nonce, { receivedAmount: received });
      return {
        status: 'underpaid',
        charge: { ...charge, receivedAmount: received },
        expected: charge.amount,
        received,
      };
    }

    // Exactly-once boundary. The reconciler and the retry path both get here.
    const won = await this.#store.claimSettlement(charge.nonce);
    if (!won) return { status: 'already_granted', charge };

    const price = this.#prices.get(charge.sku);
    if (!price) throw new Error(`charge ${charge.nonce} references unknown sku ${charge.sku}`);

    const now = this.#now();
    const entitlement = entitlementFromPrice({
      price,
      subject: charge.subject,
      chargeId: charge.id,
      entitlementId: mintEntitlementId(),
      now,
    });
    await this.#store.grant(entitlement);
    await this.#store.updateCharge(charge.nonce, {
      status: 'settled',
      settledAt: now,
      receivedAmount: received,
    });

    return {
      status: 'granted',
      charge: { ...charge, status: 'settled', settledAt: now, receivedAmount: received },
      entitlementId: entitlement.id,
    };
  }

  /**
   * Sweep pending charges. Intended to run rarely — the retry path settles
   * almost everything, and this exists to catch what it missed.
   */
  async reconcile(): Promise<SettlementOutcome[]> {
    const now = this.#now();
    await this.#store.sweepExpired(now);
    const pending = await this.#store.pendingCharges();
    const outcomes: SettlementOutcome[] = [];
    for (const charge of pending) {
      outcomes.push(await this.settleCharge(charge.nonce));
    }
    return outcomes;
  }
}
