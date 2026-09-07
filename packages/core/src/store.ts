import type { SubjectRecord } from './subjects.js';
import type { Charge, ChargeStatus, ConsumeResult, Entitlement, Sku, Subject } from './types.js';

/**
 * Where entitlements and charges live.
 *
 * Two operations carry the money-losing risk and have hard contracts:
 *
 * - {@link EntitlementStore.consume} must be atomic. A read-then-write
 *   implementation double-spends when an agent calls a paid tool twice
 *   concurrently, which is normal agent behaviour, not an edge case. Implement
 *   it as a compare-and-swap on `Entitlement.version` or inside a transaction.
 *
 * - {@link EntitlementStore.claimSettlement} must be exactly-once. Demand-driven
 *   polling and the background reconciler will both observe the same settled
 *   payment; exactly one of them may be allowed to grant credits for it.
 */
export interface EntitlementStore {
  /**
   * Spend `cost` credits from the caller's usable entitlements for `sku`.
   *
   * Atomic. Never returns `ok: true` twice for credits that only existed once.
   */
  consume(subject: Subject, sku: Sku, cost?: number): Promise<ConsumeResult>;

  grant(entitlement: Entitlement): Promise<void>;

  /**
   * Claim the right to settle `nonce`. Returns `true` to exactly one caller,
   * ever; every subsequent call for the same nonce returns `false`.
   */
  claimSettlement(nonce: string): Promise<boolean>;

  putCharge(charge: Charge): Promise<void>;

  getCharge(nonce: string): Promise<Charge | undefined>;

  updateCharge(
    nonce: string,
    patch: Partial<
      Pick<
        Charge,
        | 'status'
        | 'providerRef'
        | 'checkoutUrl'
        | 'settledAt'
        | 'receivedAmount'
        | 'lastPolledAt'
        | 'pollCount'
      >
    >
  ): Promise<void>;

  /** Charges still `pending` that were created before `before`. For the reconciler. */
  pendingCharges(before?: number): Promise<Charge[]>;

  listEntitlements(subject: Subject): Promise<Entitlement[]>;

  /**
   * Persist a subject handle and its sliding expiry. Called on issue and on
   * every successful use, so an active caller never loses paid credits.
   */
  putSubject(record: SubjectRecord): Promise<void>;

  getSubject(subject: Subject): Promise<SubjectRecord | undefined>;

  /** Mark expired pending charges abandoned. Returns how many were swept. */
  sweepExpired(now: number): Promise<number>;

  close(): Promise<void>;
}

export type { Charge, ChargeStatus, ConsumeResult, Entitlement, SubjectRecord };
