/**
 * The Tollbooth entitlement model.
 *
 * All three pricing units are the same record with different nulls:
 *
 *   unit          remaining      expiresAt
 *   ------------- -------------- -----------------
 *   per_call      1              null
 *   credit_pack   N              null, or a horizon
 *   time_pass     null (any)     now + ttl
 *
 * `remaining: null` means unlimited calls. `expiresAt: null` means it never
 * expires. Two nullable fields carry the entire variation, so `consume` is one
 * function rather than three.
 */

/**
 * Who an entitlement belongs to.
 *
 * MCP has no stable caller identity: sessions were removed from the protocol in
 * revision 2026-07-28, `Mcp-Session-Id` does not survive a reconnect in
 * 2025-11-25, and stdio has no header layer at all. So a Subject is an opaque
 * handle *we* mint and the agent carries back as a tool argument — which is
 * what the specification itself now prescribes for cross-call state.
 */
export type Subject = string;

/** Identifies a thing that can be bought. Chosen by the tool author. */
export type Sku = string;

export type PricingUnit = 'per_call' | 'credit_pack' | 'time_pass';

export interface Price {
  readonly sku: Sku;
  readonly unit: PricingUnit;
  /** Decimal string in the settlement token, e.g. `"10.00"`. Never a number. */
  readonly amount: string;
  /** Display only. The real settlement token is fixed by the payee's wallet. */
  readonly currency: string;
  /** Credits granted. `null` means unlimited, which only a time pass may be. */
  readonly credits: number | null;
  /** Lifetime in ms from purchase. `null` means it never expires. */
  readonly ttlMs: number | null;
  /** Shown to the payer on the checkout page. */
  readonly label: string;
}

export interface Entitlement {
  readonly id: string;
  readonly subject: Subject;
  readonly sku: Sku;
  /** Credits left. `null` means unlimited. */
  readonly remaining: number | null;
  /** Epoch ms. `null` means it never expires. */
  readonly expiresAt: number | null;
  readonly chargeId: string;
  readonly createdAt: number;
  /**
   * Optimistic-concurrency version. `consume` swaps on this, so a lost update
   * is detected rather than silently overwriting a concurrent decrement.
   */
  readonly version: number;
}

export type ChargeStatus = 'pending' | 'settled' | 'abandoned';

export interface Charge {
  readonly id: string;
  /** Unguessable. Travels to the provider in `description` as `tb_<nonce>`. */
  readonly nonce: string;
  readonly subject: Subject;
  readonly sku: Sku;
  readonly amount: string;
  readonly status: ChargeStatus;
  /** Provider's own id for the request, e.g. a Moove payment-link id. */
  readonly providerRef: string | null;
  readonly checkoutUrl: string | null;
  readonly createdAt: number;
  /** After this the charge is abandoned. The only containment we have. */
  readonly expiresAt: number;
  readonly settledAt: number | null;
  /** What actually arrived, once settled. Compared against `amount`. */
  readonly receivedAmount: string | null;
  /** Last time a poller asked the provider about this charge. */
  readonly lastPolledAt: number | null;
  readonly pollCount: number;
}

export type ConsumeFailure = 'no_entitlement' | 'expired' | 'insufficient_credits';

export type ConsumeResult =
  | {
      readonly ok: true;
      readonly entitlementId: string;
      /** Credits left *after* this consume. `null` means unlimited. */
      readonly remaining: number | null;
      readonly expiresAt: number | null;
    }
  | {
      readonly ok: false;
      readonly reason: ConsumeFailure;
    };
