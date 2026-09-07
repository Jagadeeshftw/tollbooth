import {
  DEFAULT_SETTLEMENT_POLICY,
  assertValidPolicy,
  decideSettlement,
  entitlementFromPrice,
  issueSubjectRecord,
  mintChargeId,
  mintEntitlementId,
  mintNonce,
  mintSubject,
  slideSubject,
} from '@tollbooth/core';
import type {
  Charge,
  EntitlementStore,
  Price,
  SettlementPolicy,
  Sku,
  Subject,
  SubjectRecord,
} from '@tollbooth/core';

import type { MooveClient, MoovePaymentLink } from './client.js';
import { isTerminalStatus, shouldPoll } from './poller.js';

/** Prefix on the Moove `description` field that binds a payment to a charge. */
export const NONCE_PREFIX = 'tb_';

/** Moove caps `description` at 500 characters. */
export const MAX_DESCRIPTION_LENGTH = 500;

/**
 * How long a checkout stays payable.
 *
 * An hour, because a human may have to bridge funds from another chain before
 * they can pay, and fifteen minutes is not enough for that. Moove has no
 * endpoint to deactivate a link, so this is still the only containment there
 * is — long enough to be usable, short enough that an abandoned link does not
 * accept money months later against an entitlement nobody is waiting for.
 */
export const DEFAULT_CHARGE_TTL_MS = 60 * 60 * 1000;

/** Below this, ordinary cross-chain payers cannot finish in time. */
export const MIN_CHARGE_TTL_MS = 15 * 60 * 1000;

export type SettlementOutcome =
  | { status: 'pending'; charge: Charge }
  | { status: 'granted'; charge: Charge; entitlementId: string }
  | { status: 'already_granted'; charge: Charge }
  | { status: 'expired'; charge: Charge }
  /**
   * Settled short, but close enough or large enough to be worth something.
   * A reduced entitlement was granted and the charge is closed: there is no
   * refund path, so a payer who sent real money never ends up with nothing.
   */
  | {
      status: 'partial';
      charge: Charge;
      entitlementId: string;
      expected: string;
      received: string;
      receivedFraction: number;
      credits: number | null;
    }
  /**
   * Too little to be worth anything. Nothing granted, charge left pending so
   * reconciliation keeps raising it for the tenant to resolve by hand.
   */
  | {
      status: 'underpaid';
      charge: Charge;
      expected: string;
      received: string;
      receivedFraction: number;
    };

export interface MooveProviderOptions {
  client: MooveClient;
  store: EntitlementStore;
  /** Everything this server sells. Looked up by sku when granting. */
  prices: readonly Price[];
  /** Defaults to {@link DEFAULT_CHARGE_TTL_MS}; must be at least {@link MIN_CHARGE_TTL_MS}. */
  chargeTtlMs?: number;
  /** Defaults to {@link DEFAULT_SETTLEMENT_POLICY}. */
  settlementPolicy?: SettlementPolicy;
  /** Sliding lifetime of a subject handle. Defaults to the core default. */
  subjectTtlMs?: number;
  now?: () => number;
}

/**
 * Ties the Moove API to the entitlement model: issues handles, opens charges,
 * and settles one exactly once when the money arrives.
 */
export class MooveProvider {
  readonly #client: MooveClient;
  readonly #store: EntitlementStore;
  readonly #prices: Map<Sku, Price>;
  readonly #chargeTtlMs: number;
  readonly #policy: SettlementPolicy;
  readonly #subjectTtlMs: number | undefined;
  readonly #now: () => number;

  constructor(options: MooveProviderOptions) {
    this.#client = options.client;
    this.#store = options.store;
    this.#prices = new Map(options.prices.map((p) => [p.sku, p]));

    const ttl = options.chargeTtlMs ?? DEFAULT_CHARGE_TTL_MS;
    if (!Number.isFinite(ttl) || ttl < MIN_CHARGE_TTL_MS) {
      throw new RangeError(
        `chargeTtlMs must be at least ${MIN_CHARGE_TTL_MS}ms (15 minutes); received ${ttl}. ` +
          'A payer bridging from another chain needs longer than that, and there is no ' +
          'way to reopen a link once it expires.'
      );
    }
    this.#chargeTtlMs = ttl;

    this.#policy = options.settlementPolicy ?? DEFAULT_SETTLEMENT_POLICY;
    assertValidPolicy(this.#policy);
    this.#subjectTtlMs = options.subjectTtlMs;
    this.#now = options.now ?? Date.now;
  }

  priceFor(sku: Sku): Price | undefined {
    return this.#prices.get(sku);
  }

  listPrices(): Price[] {
    return [...this.#prices.values()];
  }

  /** Mint a fresh subject handle and persist its sliding window. */
  async issueSubject(boundTo: string | null = null): Promise<SubjectRecord> {
    const record = issueSubjectRecord({
      subject: mintSubject(),
      now: this.#now(),
      ...(this.#subjectTtlMs !== undefined ? { ttlMs: this.#subjectTtlMs } : {}),
      boundTo,
    });
    await this.#store.putSubject(record);
    return record;
  }

  /** Push a handle's expiry forward. Called after every successful use. */
  async touchSubject(subject: Subject): Promise<void> {
    const record = await this.#store.getSubject(subject);
    if (!record) return;
    await this.#store.putSubject(slideSubject(record, this.#now(), this.#subjectTtlMs));
  }

  /**
   * Create a checkout for one purchase.
   *
   * Always one link per charge with `maxUsage: 1`. Moove exposes nothing that
   * identifies a payer, so a link shared between two buyers would be
   * unattributable by construction.
   */
  async openCharge(args: {
    sku: Sku;
    subject: Subject;
    /** Included in the description so the tenant can reconcile from the dashboard. */
    toolName?: string;
  }): Promise<{ charge: Charge; checkoutUrl: string }> {
    const price = this.#prices.get(args.sku);
    if (!price) throw new Error(`no price registered for sku ${JSON.stringify(args.sku)}`);

    const now = this.#now();
    const nonce = mintNonce();
    const expiresAt = now + this.#chargeTtlMs;

    const created = await this.#client.createPaymentLink({
      toAmount: price.amount,
      description: buildChargeDescription({
        nonce,
        sku: args.sku,
        ...(args.toolName !== undefined ? { toolName: args.toolName } : {}),
        label: price.label,
      }),
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
   * it has. Safe to call from the agent's retry path and a background
   * reconciler at once: `claimSettlement` lets exactly one of them grant.
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

    if (
      !shouldPoll({
        lastPolledAt: charge.lastPolledAt,
        now,
        ...(options.force !== undefined ? { force: options.force } : {}),
      })
    ) {
      return { status: 'pending', charge };
    }

    if (!charge.providerRef) return { status: 'pending', charge };
    const link = await this.#client.readPaymentLink(charge.providerRef);

    await this.#store.updateCharge(nonce, { lastPolledAt: now, pollCount: charge.pollCount + 1 });
    const polled: Charge = { ...charge, lastPolledAt: now, pollCount: charge.pollCount + 1 };

    if (!isTerminalStatus(link.status)) return { status: 'pending', charge: polled };

    if (link.status === 'inactive') {
      await this.#store.updateCharge(nonce, { status: 'abandoned' });
      return { status: 'expired', charge: { ...polled, status: 'abandoned' } };
    }

    return this.#grant(polled, link);
  }

  async #grant(charge: Charge, link: MoovePaymentLink): Promise<SettlementOutcome> {
    const price = this.#prices.get(charge.sku);
    if (!price) throw new Error(`charge ${charge.nonce} references unknown sku ${charge.sku}`);

    const received = link.receivedAmount ?? null;
    const decision = decideSettlement({
      expected: charge.amount,
      received,
      price,
      policy: this.#policy,
    });

    // Below the floor there is nothing worth granting. Leave the charge pending
    // so the tenant sees it; we cannot refund, so we must not close it quietly.
    if (decision.kind === 'reject') {
      await this.#store.updateCharge(charge.nonce, { receivedAmount: received });
      return {
        status: 'underpaid',
        charge: { ...charge, receivedAmount: received },
        expected: charge.amount,
        received: received ?? '0',
        receivedFraction: decision.receivedFraction,
      };
    }

    // Exactly-once boundary. The reconciler and the retry path both get here.
    const won = await this.#store.claimSettlement(charge.nonce);
    if (!won) return { status: 'already_granted', charge };

    const now = this.#now();
    const granted: Price =
      decision.kind === 'full'
        ? price
        : { ...price, credits: decision.credits, ttlMs: decision.ttlMs };

    const entitlement = entitlementFromPrice({
      price: granted,
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

    const settled: Charge = {
      ...charge,
      status: 'settled',
      settledAt: now,
      receivedAmount: received,
    };

    if (decision.kind === 'pro_rata') {
      return {
        status: 'partial',
        charge: settled,
        entitlementId: entitlement.id,
        expected: charge.amount,
        received: received ?? charge.amount,
        receivedFraction: decision.receivedFraction,
        credits: decision.credits,
      };
    }

    return { status: 'granted', charge: settled, entitlementId: entitlement.id };
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

/**
 * Build the Moove `description`.
 *
 * The nonce goes first and is never truncated: it is the only thing binding a
 * settled payment back to a charge. What follows is for the human reading their
 * Moove dashboard, where a bare nonce says nothing about what was sold.
 */
export function buildChargeDescription(args: {
  nonce: string;
  sku: string;
  toolName?: string;
  label?: string;
  maxLength?: number;
}): string {
  const limit = args.maxLength ?? MAX_DESCRIPTION_LENGTH;
  const head = `${NONCE_PREFIX}${args.nonce}`;

  const parts = [args.sku, args.toolName, args.label].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );
  // De-duplicate: sku and label are often the same words.
  const seen = new Set<string>();
  const tail = parts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (tail.length === 0) return head.slice(0, limit);

  const full = `${head} · ${tail.join(' · ')}`;
  if (full.length <= limit) return full;

  const room = limit - head.length - 3; // ' · '
  if (room <= 1) return head.slice(0, limit);
  return `${head} · ${tail.join(' · ').slice(0, room - 1)}…`;
}
