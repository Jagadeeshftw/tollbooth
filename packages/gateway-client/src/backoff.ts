/**
 * Exponential backoff with full jitter, for retrying a failed batch flush.
 *
 * `@tollbooth/moove` has an equivalent, but this package may depend only on
 * `@tollbooth/core` — duplicating five lines is the price of that boundary,
 * not a reason to cross it.
 */
export function backoffDelayMs(attempt: number, baseMs = 1000, capMs = 30_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponential);
}
