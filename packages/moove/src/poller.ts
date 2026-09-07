/**
 * When to ask Moove whether a charge has settled.
 *
 * Polling is demand-driven first: the natural trigger is the agent retrying the
 * tool call, so a single-tenant library with a patient agent makes no
 * background requests at all. The schedule below only governs the optional
 * reconciler, and the terminal-state cache means a settled charge is never
 * asked about twice.
 */

/** Gaps between polls, in ms. After the last entry, repeat the last value. */
export const POLL_SCHEDULE_MS = [3_000, 6_000, 12_000, 24_000, 48_000, 60_000] as const;

/** Fraction of the interval to jitter by, so pending charges do not sync up. */
export const POLL_JITTER = 0.3;

/**
 * Delay before poll number `pollCount` (0-based: the first poll waits 3s).
 * Jittered by +/-30% so many pending charges in one process spread out
 * instead of all firing on the same tick.
 */
export function nextPollDelayMs(pollCount: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(pollCount, 0), POLL_SCHEDULE_MS.length - 1);
  const base = POLL_SCHEDULE_MS[index] ?? POLL_SCHEDULE_MS[POLL_SCHEDULE_MS.length - 1]!;
  const spread = base * POLL_JITTER;
  return Math.max(0, Math.round(base - spread + random() * spread * 2));
}

/**
 * The floor between two polls of the same charge, however often the agent
 * retries. Without it, an agent in a tight retry loop would hammer the API on
 * the user's behalf.
 */
export const MIN_POLL_INTERVAL_MS = 2_000;

export function shouldPoll(args: {
  lastPolledAt: number | null;
  now: number;
  minIntervalMs?: number;
  force?: boolean;
}): boolean {
  if (args.force) return true;
  if (args.lastPolledAt === null) return true;
  return args.now - args.lastPolledAt >= (args.minIntervalMs ?? MIN_POLL_INTERVAL_MS);
}

/** Statuses that will never change again, so their charges are never re-polled. */
export function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'inactive';
}
