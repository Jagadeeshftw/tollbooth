import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Handles minted here are bearer credentials that will sit in an LLM's context
 * window, so they must be unguessable rather than merely unique. 16 bytes of
 * CSPRNG output, base64url, no counters and no timestamps.
 */
function random(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

/** The handle the agent carries back as a tool argument. */
export function mintSubject(): string {
  return `tb_s_${random()}`;
}

/**
 * Binds a settled payment to the charge that triggered it. Travels to the
 * payment provider in a reference field, so it must be safe to show a human.
 */
export function mintNonce(): string {
  return random();
}

export function mintChargeId(): string {
  return `tb_c_${random(12)}`;
}

export function mintEntitlementId(): string {
  return `tb_e_${random(12)}`;
}

/**
 * Constant-time comparison for handles. These gate access to paid capability,
 * so comparing them with `===` would leak length and prefix through timing.
 */
export function handlesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
