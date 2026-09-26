import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Moove webhooks: verification and parsing.
 *
 * Moove POSTs a signed JSON body when a payment link is paid, and again when a
 * payment completes the link. This module does the part that must not be got
 * wrong — proving the request came from Moove — and nothing else. Deciding what
 * a payment bought stays where it already was, in `MooveProvider.settleCharge`.
 *
 * Three properties of the delivery contract shape everything here:
 *
 *   - The endpoint is a public URL, so an unsigned or badly signed request is
 *     hostile, not merely malformed.
 *   - Delivery is at-least-once: the same `Moove-Event-Id` can arrive twice.
 *   - A single-use link fires `transaction.succeeded` and `completed`
 *     separately, in either order.
 *
 * None of that is a problem for us, because both events are treated as the
 * same instruction — *go and ask Moove what happened to this link* — and the
 * store's `claimSettlement` already admits exactly one grant per charge.
 */

/** `v1=` + hex HMAC-SHA256 of `{timestamp}.{raw body}`. */
export const SIGNATURE_HEADER = 'moove-signature';
/** Unix seconds this attempt was signed at. Changes on every retry. */
export const TIMESTAMP_HEADER = 'moove-timestamp';
/** Stable across retries of one delivery; different per endpoint. */
export const EVENT_ID_HEADER = 'moove-event-id';

/**
 * How far out of date a delivery may be. The timestamp is inside the signed
 * message, so it cannot be edited without breaking the signature; this bounds
 * how long a captured delivery stays replayable. Moove's own guidance.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type MooveWebhookEventType = 'payment_link.transaction.succeeded' | 'payment_link.completed';

export interface MooveWebhookTransaction {
  id: string;
  status: string;
  amount: string;
  tokenAddress: string;
  chainId: string;
  /** The payer's hash on the chain they paid *from*. The payload carries no source chain id. */
  sourceTransaction: string | null;
  dateCreated: string;
}

export interface MooveWebhookEvent {
  id: string;
  type: MooveWebhookEventType | string;
  createdAt: string;
  data: {
    paymentLinkId: string;
    status: string;
    amount: string;
    receivedAmount: string;
    currentUsage: number;
    maxUsage: number | null;
    chainId: string;
    tokenAddress: string;
    description: string | null;
    transaction?: MooveWebhookTransaction;
  };
}

/**
 * Is this delivery genuinely from Moove, and recent?
 *
 * Constant-time comparison: a byte-by-byte early return leaks the expected
 * digest to anyone willing to make a few thousand requests. Staleness is
 * checked first, so an ancient replay costs nothing.
 *
 * `rawBody` must be the bytes as received. Re-serialising a parsed object
 * changes key order and whitespace, and the signature is over the bytes.
 */
export function verifyWebhookSignature(args: {
  rawBody: Buffer | string;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  now?: () => number;
  toleranceSeconds?: number;
}): boolean {
  const { rawBody, signature, timestamp, secret } = args;
  if (!signature || !timestamp || !secret) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  const nowSeconds = (args.now?.() ?? Date.now()) / 1000;
  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - seconds) > tolerance) return false;

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const message = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
  // The secret signs as shown, `whsec_` prefix included.
  const expected = `v1=${createHmac('sha256', secret).update(message).digest('hex')}`;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself not secret.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Parse a verified body into an event, or return null if it is not shaped like
 * one. Never called before {@link verifyWebhookSignature}.
 */
export function parseWebhookEvent(rawBody: Buffer | string): MooveWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const event = parsed as Partial<MooveWebhookEvent>;
  if (typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const data = event.data as MooveWebhookEvent['data'] | undefined;
  if (!data || typeof data.paymentLinkId !== 'string') return null;
  return event as MooveWebhookEvent;
}

/**
 * The charge nonce Moove is holding for us, out of the link's description.
 *
 * `buildChargeDescription` writes `tb_<nonce>` first and never truncates it,
 * precisely so it survives the round trip. This is the cheap half of the
 * mapping: the caller must still check the nonce's charge really does point at
 * the payment link the event is about, because a description is free text and
 * the link id is not.
 */
export function nonceFromDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = /(?:^|\s)tb_([A-Za-z0-9_-]{16,})/.exec(description);
  return match?.[1] ?? null;
}
