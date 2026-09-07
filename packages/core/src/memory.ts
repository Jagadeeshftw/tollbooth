import { isUsable } from './pricing.js';
import type { EntitlementStore } from './store.js';
import type { SubjectRecord } from './subjects.js';
import type { Charge, ConsumeResult, Entitlement, Sku, Subject } from './types.js';

export interface MemoryStoreOptions {
  /**
   * Acknowledge that everything in this store is lost on restart — including
   * entitlements people have already paid for. Required outside tests.
   */
  acknowledgeEphemeral?: boolean;
  /** Injected clock, for tests. */
  now?: () => number;
  /**
   * Test seam. Awaited between reading an entitlement and swapping it, so a
   * test can force the interleaving that a naive read-then-write would lose to.
   * @internal
   */
  _beforeSwap?: () => Promise<void>;
}

const MAX_CAS_ATTEMPTS = 16;

/**
 * Reference {@link EntitlementStore}. Correct, and deliberately not durable.
 *
 * Use it in tests and to read the contract. Reach for `@tollbooth/store-sqlite`
 * anywhere a restart would cost somebody credits they paid for.
 */
export class MemoryEntitlementStore implements EntitlementStore {
  readonly #entitlements = new Map<string, Entitlement>();
  readonly #charges = new Map<string, Charge>();
  readonly #claimed = new Set<string>();
  readonly #subjects = new Map<string, SubjectRecord>();
  readonly #now: () => number;
  readonly #beforeSwap: (() => Promise<void>) | undefined;

  constructor(options: MemoryStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#beforeSwap = options._beforeSwap;
    if (!options.acknowledgeEphemeral && !isTestEnvironment()) {
      console.warn(
        '[tollbooth] MemoryEntitlementStore holds paid entitlements in memory and loses ' +
          'them on restart. Use @tollbooth/store-sqlite in production, or pass ' +
          '{ acknowledgeEphemeral: true } to silence this.'
      );
    }
  }

  async consume(subject: Subject, sku: Sku, cost = 1): Promise<ConsumeResult> {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new RangeError(`cost must be a positive integer, received ${cost}`);
    }

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const now = this.#now();
      const mine = [...this.#entitlements.values()].filter(
        (e) => e.subject === subject && e.sku === sku
      );
      if (mine.length === 0) return { ok: false, reason: 'no_entitlement' };

      const candidate = pickEntitlement(mine, now, cost);
      if (!candidate) {
        // Distinguish "you had one and it lapsed" from "you never had credits",
        // because the two want different messages in front of a user.
        const anyUnexpired = mine.some((e) => e.expiresAt === null || now < e.expiresAt);
        return { ok: false, reason: anyUnexpired ? 'insufficient_credits' : 'expired' };
      }

      // Snapshot, yield, then swap only if nothing moved underneath us.
      const expectedVersion = candidate.version;
      if (this.#beforeSwap) await this.#beforeSwap();

      const current = this.#entitlements.get(candidate.id);
      if (!current || current.version !== expectedVersion) {
        continue; // lost the race; re-read and try again
      }

      const next: Entitlement = {
        ...current,
        remaining: current.remaining === null ? null : current.remaining - cost,
        version: current.version + 1,
      };
      this.#entitlements.set(next.id, next);
      return {
        ok: true,
        entitlementId: next.id,
        remaining: next.remaining,
        expiresAt: next.expiresAt,
      };
    }

    throw new Error(
      `consume could not settle after ${MAX_CAS_ATTEMPTS} attempts under contention`
    );
  }

  async grant(entitlement: Entitlement): Promise<void> {
    this.#entitlements.set(entitlement.id, entitlement);
  }

  async claimSettlement(nonce: string): Promise<boolean> {
    // Synchronous check-and-set: no await between the two, so no interleaving.
    if (this.#claimed.has(nonce)) return false;
    this.#claimed.add(nonce);
    return true;
  }

  async putCharge(charge: Charge): Promise<void> {
    this.#charges.set(charge.nonce, charge);
  }

  async getCharge(nonce: string): Promise<Charge | undefined> {
    return this.#charges.get(nonce);
  }

  async updateCharge(nonce: string, patch: Partial<Charge>): Promise<void> {
    const existing = this.#charges.get(nonce);
    if (!existing) throw new Error(`no charge with nonce ${nonce}`);
    this.#charges.set(nonce, { ...existing, ...patch });
  }

  async pendingCharges(before: number = Number.MAX_SAFE_INTEGER): Promise<Charge[]> {
    return [...this.#charges.values()].filter(
      (c) => c.status === 'pending' && c.createdAt <= before
    );
  }

  async listEntitlements(subject: Subject): Promise<Entitlement[]> {
    return [...this.#entitlements.values()].filter((e) => e.subject === subject);
  }

  async putSubject(record: SubjectRecord): Promise<void> {
    this.#subjects.set(record.subject, record);
  }

  async getSubject(subject: Subject): Promise<SubjectRecord | undefined> {
    return this.#subjects.get(subject);
  }

  async sweepExpired(now: number): Promise<number> {
    let swept = 0;
    for (const charge of this.#charges.values()) {
      if (charge.status === 'pending' && charge.expiresAt <= now) {
        this.#charges.set(charge.nonce, { ...charge, status: 'abandoned' });
        swept++;
      }
    }
    return swept;
  }

  async close(): Promise<void> {
    this.#entitlements.clear();
    this.#charges.clear();
    this.#claimed.clear();
    this.#subjects.clear();
  }
}

/**
 * Prefer unlimited entitlements so a time pass is spent before a credit pack,
 * then soonest-expiring, then smallest balance. The effect is that credits the
 * buyer would otherwise lose to expiry get used first.
 */
function pickEntitlement(all: Entitlement[], now: number, cost: number): Entitlement | undefined {
  const usable = all.filter((e) => isUsable(e, now, cost));
  if (usable.length === 0) return undefined;
  return usable.sort((a, b) => {
    const aUnlimited = a.remaining === null ? 0 : 1;
    const bUnlimited = b.remaining === null ? 0 : 1;
    if (aUnlimited !== bUnlimited) return aUnlimited - bUnlimited;
    const aExp = a.expiresAt ?? Number.MAX_SAFE_INTEGER;
    const bExp = b.expiresAt ?? Number.MAX_SAFE_INTEGER;
    if (aExp !== bExp) return aExp - bExp;
    return (a.remaining ?? Infinity) - (b.remaining ?? Infinity);
  })[0];
}

function isTestEnvironment(): boolean {
  return (
    process.env['NODE_ENV'] === 'test' ||
    process.env['TOLLBOOTH_ALLOW_MEMORY_STORE'] === '1' ||
    // node:test sets this on the worker it runs suites in.
    process.env['NODE_TEST_CONTEXT'] !== undefined
  );
}
