import type { Sku } from '@tollbooth/core';

/**
 * Raw hook events, mirrored by hand from `@tollbooth/mcp`'s `PaywallConfig`.
 *
 * This package may depend on `@tollbooth/core` and nothing else — not even
 * `@tollbooth/mcp`'s types, even as a type-only import. `scripts/check-boundaries.mjs`
 * enforces that. So these shapes are duplicated here rather than imported, and
 * TypeScript's structural typing does the rest at the call site: a tenant who
 * wires `withPaywall({ onCall: gatewayClient.onCall, ... })` gets a normal
 * assignability check against these types with no import in either direction.
 *
 * Keeping this file honest is a manual discipline: if `@tollbooth/mcp` ever
 * changes a hook's shape, nothing here fails to compile on its own. What does
 * catch drift is the leak test in `project.test.ts` — it fails loudly the
 * moment a raw event carries a field this file does not already name, which
 * is exactly the case a silent shape change would produce.
 */

/** Mirrors `PaywallConfig['onCall']`'s event. */
export interface RawCallEvent {
  readonly tool: string;
  readonly sku: Sku;
  readonly cost: number;
  readonly at: number;
  readonly tokenPresented: boolean;
  readonly tokenFingerprint: string | null;
  readonly tokenRecognised: boolean;
  readonly outcome: 'challenged' | 'authorised';
}

/** Mirrors `PaywallConfig['onChargeOpened']`'s event. */
export interface RawChargeOpenedEvent {
  readonly tool: string;
  readonly sku: Sku;
  /** Real Moove-facing nonce. Hashed into `chargeRef` before anything is sent; never sent itself. */
  readonly nonce: string;
  readonly amount: string;
  readonly currency: string;
  readonly at: number;
}

/**
 * `SettlementOutcome` itself is a `@tollbooth/core` type and is imported
 * directly in `project.ts` — it is not mirrored here. Unlike the two above,
 * it is not mcp-specific: it is what any `PaymentProvider` reports, so this
 * package is allowed to know its exact shape, subject handle and all.
 */

/**
 * What is actually allowed to leave this process. Every field on every
 * variant below was chosen because it appears on the allow-list Tollbooth's
 * wire policy states in plain language: fingerprints, tool names, skus,
 * amounts and timestamps — never a subject handle, a nonce, a Moove link id,
 * or a checkout URL. `chargeRef` is not an exception to that: it is a
 * one-way SHA-256 of the nonce (see `chargeRefFrom`), so holding it grants no
 * capability at all — it cannot be presented as a handle, cannot look
 * anything up at Moove, and cannot be turned back into the nonce it came
 * from. It exists only so the gateway can join a `charge_opened` event to the
 * `settlement` event for the same charge.
 */
export type WireEvent = WireChargeOpenedEvent | WireCallEvent | WireSettlementEvent;

interface WireEventBase {
  /**
   * Minted once, when this event is first queued, and never reissued on
   * retry. This is the whole idempotency mechanism: the gateway's ingest
   * endpoint dedupes on this, so resending the same event after a failed
   * flush is always safe.
   */
  readonly eventId: string;
  readonly at: number;
}

export interface WireChargeOpenedEvent extends WireEventBase {
  readonly kind: 'charge_opened';
  readonly tool: string;
  readonly sku: string;
  readonly chargeRef: string;
  readonly amount: string;
  readonly currency: string;
}

export interface WireCallEvent extends WireEventBase {
  readonly kind: 'call';
  readonly tool: string;
  readonly sku: string;
  readonly cost: number;
  readonly tokenPresented: boolean;
  readonly tokenFingerprint: string | null;
  readonly tokenRecognised: boolean;
  readonly outcome: 'challenged' | 'authorised';
}

/**
 * Only for the statuses that carry new information for the dashboard.
 * `pending` is every unpaid retry and would flood the wire with nothing to
 * show; `already_granted` is a duplicate observation of a settlement already
 * reported once. Neither is emitted; see `projectSettlement`.
 */
export type ReportedSettlementStatus = 'granted' | 'partial' | 'underpaid' | 'expired';

export interface WireSettlementEvent extends WireEventBase {
  readonly kind: 'settlement';
  readonly status: ReportedSettlementStatus;
  readonly sku: string;
  readonly chargeRef: string;
  readonly amount: string;
  readonly receivedAmount: string | null;
  readonly receivedFraction: number | null;
}
