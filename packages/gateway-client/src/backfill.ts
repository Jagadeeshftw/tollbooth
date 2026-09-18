import { decideSettlement } from '@tollbooth/core';
import type { Charge, Price, SettlementPolicy } from '@tollbooth/core';

import type { WireEvent, WireSettlementEvent } from './events.js';
import { chargeRefFrom, deterministicEventId } from './project.js';

/**
 * A placeholder used only to satisfy {@link decideSettlement}'s signature when
 * a charge's own price snapshot is unavailable (a pre-migration charge — see
 * `Charge.price`). Its `credits`/`ttlMs` are never read: the `full` and
 * `reject` decisions never touch price at all, and the `pro_rata` branch's
 * scaled credits/ttlMs are discarded and reported `null` (unknown, not zero)
 * whenever the real price was unavailable, the same convention `Charge.price`
 * itself already uses.
 */
const UNKNOWN_PRICE: Price = {
  sku: '',
  unit: 'credit_pack',
  amount: '0',
  currency: '',
  credits: 0,
  ttlMs: null,
  label: '',
};

function decideSettlementFromCharge(charge: Charge, policy?: SettlementPolicy) {
  const decision = decideSettlement({
    expected: charge.amount,
    received: charge.receivedAmount,
    price: charge.price ?? UNKNOWN_PRICE,
    ...(policy ? { policy } : {}),
  });
  if (charge.price === null && decision.kind === 'pro_rata') {
    return { ...decision, credits: null, ttlMs: null };
  }
  return decision;
}

function settlementEventForCharge(
  charge: Charge,
  chargeRef: string,
  policy: SettlementPolicy | undefined
): WireSettlementEvent | null {
  if (charge.status === 'abandoned') {
    return {
      kind: 'settlement',
      eventId: deterministicEventId('settlement', chargeRef, 'expired', 'null'),
      // The exact moment a poller would have noticed is not recoverable —
      // nothing durable records it — so this uses the moment the charge
      // *became* eligible to expire, which is deterministic and reconstructs
      // to the same value every time this charge is fed through again.
      at: charge.expiresAt,
      status: 'expired',
      sku: charge.sku,
      chargeRef,
      amount: charge.amount,
      receivedAmount: null,
      receivedFraction: null,
      credits: null,
    };
  }

  if (charge.status === 'settled') {
    const decision = decideSettlementFromCharge(charge, policy);
    // `settled` is only ever written for `full` or `pro_rata` — see
    // moove's `#grant` — so `reject` here means the policy passed to this
    // reconstruction differs from whatever policy actually decided this
    // charge live. Recomputing rather than trusting a stored status is
    // deliberate: report nothing rather than something that cannot be
    // reconciled against what the wire would have carried at the time.
    if (decision.kind === 'reject') return null;
    const status = decision.kind === 'full' ? 'granted' : 'partial';
    const credits = decision.kind === 'full' ? (charge.price?.credits ?? null) : decision.credits;
    return {
      kind: 'settlement',
      eventId: deterministicEventId('settlement', chargeRef, status, charge.receivedAmount ?? 'null'),
      at: charge.settledAt ?? charge.createdAt,
      status,
      sku: charge.sku,
      chargeRef,
      amount: charge.amount,
      receivedAmount: charge.receivedAmount,
      receivedFraction: decision.kind === 'pro_rata' ? decision.receivedFraction : null,
      credits,
    };
  }

  // `pending` with money already received is what an underpaid observation
  // looks like durably: Moove has no refund path, so a short payment leaves
  // the charge open for a later, larger payment to still be graded — see
  // moove's `#grant`, the `reject` branch. `pending` with nothing received
  // is a charge nothing has happened to yet; there is nothing to report.
  if (charge.status === 'pending' && charge.receivedAmount !== null) {
    const decision = decideSettlementFromCharge(charge, policy);
    if (decision.kind !== 'reject') return null; // policy mismatch — see above
    return {
      kind: 'settlement',
      eventId: deterministicEventId('settlement', chargeRef, 'underpaid', charge.receivedAmount),
      at: charge.lastPolledAt ?? charge.createdAt,
      status: 'underpaid',
      sku: charge.sku,
      chargeRef,
      amount: charge.amount,
      receivedAmount: charge.receivedAmount,
      receivedFraction: decision.receivedFraction,
      credits: null,
    };
  }

  return null;
}

/**
 * Reconstruct every wire event a charge should ever have produced, entirely
 * from what a store durably persisted about it — never approximated, never
 * re-derived from anything but the charge's own recorded fields.
 *
 * Every id this produces is deterministic (see `deterministicEventId`), so
 * resending the reconstruction of a charge the gateway already has is a safe
 * no-op: `ingestBatch`'s existing `(tenant_id, event_id)` dedup recognises it
 * as a duplicate and never touches revenue a second time. That is the entire
 * mechanism that makes backfill safe to run over a window that overlaps
 * events which already arrived live — this function does not need to know
 * which charges are "new" and which aren't; it reconstructs all of them, and
 * lets ingest's own idempotency sort out what actually is.
 *
 * `policy` must be the same `SettlementPolicy` the tenant's own
 * `PaymentProvider` was actually configured with when these charges were
 * decided — passing a different one can reconstruct a different outcome than
 * what the wire would have carried live, and this recomputes rather than
 * trusts a stored status for exactly that reason (see the `reject`-branch
 * comments below). Omit it only if the provider used the default.
 */
export function eventsForCharge(charge: Charge, policy?: SettlementPolicy): WireEvent[] {
  const chargeRef = chargeRefFrom(charge.nonce);
  const events: WireEvent[] = [];

  // Both a tool name and a price snapshot are required to reconstruct an
  // honest charge_opened: `Charge` carries no `currency` of its own outside
  // `price`, and a pre-migration charge may be missing either. Skipped
  // rather than guessed — the settlement side below still reports revenue
  // exactly even when the open side cannot be reconstructed.
  if (charge.tool !== null && charge.price !== null) {
    events.push({
      kind: 'charge_opened',
      eventId: deterministicEventId('charge_opened', chargeRef),
      at: charge.createdAt,
      tool: charge.tool,
      sku: charge.sku,
      chargeRef,
      amount: charge.amount,
      currency: charge.price.currency,
    });
  }

  const settlement = settlementEventForCharge(charge, chargeRef, policy);
  if (settlement) events.push(settlement);

  return events;
}
