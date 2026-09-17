import { createHash, randomUUID } from 'node:crypto';

import type { SettlementOutcome } from '@tollbooth/core';

import type {
  RawCallEvent,
  RawChargeOpenedEvent,
  ReportedSettlementStatus,
  WireCallEvent,
  WireChargeOpenedEvent,
  WireSettlementEvent,
} from './events.js';

/**
 * A one-way, non-reversible reference to a charge, derived from its nonce.
 *
 * SHA-256 over 16 bytes of CSPRNG output: there is no rainbow table over that
 * much entropy, so this discloses nothing about the nonce it came from. It
 * exists purely to let two events about the *same* charge — one opened, one
 * settled — be joined on the gateway side, without either event carrying
 * anything that could open, spend, or look anything up.
 */
export function chargeRefFrom(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

/**
 * Project a raw `onChargeOpened` event onto the wire.
 *
 * Every field is named explicitly, never spread from the raw event: adding a
 * field to `RawChargeOpenedEvent` in the future cannot make it appear here by
 * itself. See `project.test.ts` for the test that leans on exactly that.
 */
export function projectChargeOpened(event: RawChargeOpenedEvent): WireChargeOpenedEvent {
  return {
    kind: 'charge_opened',
    eventId: randomUUID(),
    at: event.at,
    tool: event.tool,
    sku: event.sku,
    chargeRef: chargeRefFrom(event.nonce),
    amount: event.amount,
    currency: event.currency,
  };
}

/** Project a raw `onCall` event onto the wire. Same discipline: named fields only. */
export function projectCall(event: RawCallEvent): WireCallEvent {
  return {
    kind: 'call',
    eventId: randomUUID(),
    at: event.at,
    tool: event.tool,
    sku: event.sku,
    cost: event.cost,
    tokenPresented: event.tokenPresented,
    tokenFingerprint: event.tokenFingerprint,
    tokenRecognised: event.tokenRecognised,
    outcome: event.outcome,
  };
}

const REPORTED_STATUSES = new Set<SettlementOutcome['status']>([
  'granted',
  'partial',
  'underpaid',
  'expired',
]);

/**
 * Project a raw `SettlementOutcome` onto the wire, or `null` if this
 * observation carries nothing new: `pending` is every unpaid retry, and
 * `already_granted` is a second observer seeing a settlement someone else
 * already reported. Neither belongs on the wire.
 *
 * This is the load-bearing function in this package. `SettlementOutcome.charge`
 * carries the subject handle, the nonce, the Moove link id and the checkout
 * URL — every field the wire policy forbids, all in one object, because that
 * object is meant for the tenant's own process. Nothing here is spread from
 * `charge`; every field of the output is named, and the four forbidden ones
 * are never read at all, so a future field added to `Charge` cannot leak
 * through this function no matter what it is called.
 */
export function projectSettlement(outcome: SettlementOutcome, now: number): WireSettlementEvent | null {
  if (!REPORTED_STATUSES.has(outcome.status)) return null;
  const status = outcome.status as ReportedSettlementStatus;
  const { charge } = outcome;

  return {
    kind: 'settlement',
    eventId: randomUUID(),
    at: now,
    status,
    sku: charge.sku,
    chargeRef: chargeRefFrom(charge.nonce),
    amount: charge.amount,
    receivedAmount: charge.receivedAmount,
    receivedFraction:
      outcome.status === 'partial' || outcome.status === 'underpaid' ? outcome.receivedFraction : null,
  };
}
