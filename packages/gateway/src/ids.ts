import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mirrors `@tollbooth/core`'s `ids.ts`. This package does not depend on core
 * — it has no reason to import the entitlement model — so unguessable id
 * minting and constant-time comparison are duplicated here rather than
 * shared. Same reasoning as `@tollbooth/gateway-client`'s local `backoff.ts`:
 * a few lines duplicated is the price of a boundary staying real.
 */
function random(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function mintTenantId(): string {
  return `tb_t_${random()}`;
}

/**
 * Shown to the tenant exactly once. Never stored — only its hash is, and only
 * the hash is ever compared against.
 */
export function mintIngestToken(): string {
  return `tbgw_ingest_${random(24)}`;
}

/**
 * Constant-time comparison, for the one place a secret this package holds is
 * compared against caller input: verifying a presented ingest token's hash.
 * `===` would leak length and prefix through timing.
 */
export function secretsEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
