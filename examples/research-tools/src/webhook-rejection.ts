import { DEFAULT_TOLERANCE_SECONDS } from '@tollbooth/moove';

/**
 * Why a delivery failed verification, for the server's own log only. The
 * caller still answers a plain 401: telling an unauthenticated sender which
 * check it failed would help it, and would help nobody legitimate.
 *
 * It exists because "bad signature or stale timestamp" hid a real
 * misconfiguration for a week: Moove re-signs every retry with a fresh
 * timestamp, so a delivery that keeps failing while fresh is signed with a
 * secret this server does not hold, which in practice means a second
 * endpoint registered for the same URL.
 */
export function webhookRejectionReason(args: {
  signature: string | undefined;
  timestamp: string | undefined;
  nowSeconds: number;
  toleranceSeconds?: number;
}): string {
  if (!args.signature || !args.timestamp) return 'missing signature headers';
  const signedAt = Number(args.timestamp);
  if (!Number.isFinite(signedAt)) return 'timestamp is not a number';
  const age = Math.round(args.nowSeconds - signedAt);
  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(age) > tolerance) return `stale timestamp (signed ${age}s ago, tolerance ${tolerance}s)`;
  return `signature mismatch while fresh (signed ${age}s ago): signed with a secret this server does not hold, such as a second endpoint registered for this URL`;
}
