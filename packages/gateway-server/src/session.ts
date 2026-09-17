import { createHmac } from 'node:crypto';

import { secretsEqual } from './ids.js';

/** Sliding session lifetime. A tenant re-authenticates through GitHub after this much inactivity. */
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  readonly tenantId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * A signed, stateless session token: `base64url(json).base64url(hmac)`.
 *
 * No session table, so no place for a session to leak sideways and no store
 * to keep separate from the gateway's tenant-scoped data. The secret is the
 * only thing that can forge one, and it never leaves server config.
 */
export function signSession(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/**
 * Verify a session token: signature, then expiry. Returns `null` rather than
 * throwing — an invalid or expired session is an ordinary "please sign in
 * again", not an exceptional condition the caller must handle specially.
 */
export function verifySession(token: string, secret: string, now: number = Date.now()): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts as [string, string];

  const expectedMac = createHmac('sha256', secret).update(body).digest('base64url');
  if (!secretsEqual(mac, expectedMac)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof payload?.tenantId !== 'string' ||
    typeof payload?.issuedAt !== 'number' ||
    typeof payload?.expiresAt !== 'number'
  ) {
    return null;
  }
  if (now >= payload.expiresAt) return null;
  return payload;
}

/** Build a fresh session for a tenant who just completed sign-in, or is being kept signed in. */
export function issueSession(
  tenantId: string,
  secret: string,
  options: { now?: number; ttlMs?: number } = {}
): string {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  return signSession({ tenantId, issuedAt: now, expiresAt: now + ttlMs }, secret);
}
