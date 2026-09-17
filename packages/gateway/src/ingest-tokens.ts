import { createHash } from 'node:crypto';

import { mintIngestToken, secretsEqual } from './ids.js';

export interface IssuedIngestToken {
  /** Shown to the tenant exactly once. Never stored. */
  readonly token: string;
  /** What is actually persisted. */
  readonly tokenHash: string;
}

/**
 * SHA-256 of the token, hex-encoded. Write-only by design: nothing in this
 * package ever needs the token back from its hash, only whether a presented
 * token hashes to a stored one — see {@link verifyIngestToken}.
 */
export function hashIngestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Mint a fresh ingest token and its hash in one step, so the plaintext is never separately reconstructable. */
export function issueIngestToken(): IssuedIngestToken {
  const token = mintIngestToken();
  return { token, tokenHash: hashIngestToken(token) };
}

/**
 * Whether a presented token is the one that hashed to `storedHash`.
 *
 * Hashing the presented token is not itself constant-time (SHA-256 is length-
 * dependent but not secret-dependent in a way that matters here), but the
 * *comparison* of two hashes must be — an early-exit `===` on the hash would
 * leak how many leading hex characters matched, one HTTP request at a time.
 */
export function verifyIngestToken(presented: string, storedHash: string): boolean {
  return secretsEqual(hashIngestToken(presented), storedHash);
}
