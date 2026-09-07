/**
 * Per-subject rate limiting and a hard deadline on every tool.
 *
 * Credits stop someone using the server for free. They do not stop someone who
 * bought a pack from spending 250 credits in a few seconds probing hosts, so
 * the paid path needs its own ceiling.
 */

export class RateLimitedError extends Error {
  override readonly name = 'RateLimitedError';
  constructor(readonly retryAfterMs: number) {
    super(
      `Too many requests. Wait ${Math.ceil(retryAfterMs / 1000)}s and try again. ` +
        'This limit is per payment handle and is separate from your credit balance.'
    );
  }
}

export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
  constructor(ms: number) {
    super(`This tool took longer than ${ms / 1000}s and was stopped.`);
  }
}

export interface RateLimitOptions {
  /** Sustained requests per second, per subject. */
  ratePerSecond?: number;
  /** How many may arrive at once before pacing applies. */
  burst?: number;
  /** Entries idle this long are forgotten, so the map cannot grow forever. */
  idleEvictionMs?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

/**
 * Token bucket keyed by subject.
 *
 * Refuses rather than queues: an agent that is told to wait can retry, and
 * holding requests open would tie up the connections the ceiling is meant to
 * protect.
 */
export class PerSubjectRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #rate: number;
  readonly #burst: number;
  readonly #idleMs: number;
  readonly #now: () => number;
  #lastSweep = 0;

  constructor(options: RateLimitOptions = {}) {
    this.#rate = options.ratePerSecond ?? 2;
    this.#burst = options.burst ?? 10;
    this.#idleMs = options.idleEvictionMs ?? 10 * 60 * 1000;
    this.#now = options.now ?? Date.now;
  }

  /** Throws {@link RateLimitedError} when the subject is over its ceiling. */
  check(subject: string): void {
    const now = this.#now();
    this.#sweep(now);

    const bucket = this.#buckets.get(subject) ?? { tokens: this.#burst, lastRefill: now };
    const elapsed = Math.max(0, now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.#burst, bucket.tokens + elapsed * this.#rate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const deficit = 1 - bucket.tokens;
      this.#buckets.set(subject, bucket);
      throw new RateLimitedError(Math.ceil((deficit / this.#rate) * 1000));
    }

    bucket.tokens -= 1;
    this.#buckets.set(subject, bucket);
  }

  /** Drop buckets nobody has touched, so an unbounded key space cannot leak. */
  #sweep(now: number): void {
    if (now - this.#lastSweep < this.#idleMs) return;
    this.#lastSweep = now;
    for (const [subject, bucket] of this.#buckets) {
      if (now - bucket.lastRefill > this.#idleMs) this.#buckets.delete(subject);
    }
  }

  get size(): number {
    return this.#buckets.size;
  }
}

/**
 * Run `fn` with a hard deadline.
 *
 * The fetch layer has its own timeout, but DNS, TLS and parsing all sit outside
 * it. This is the ceiling on the whole call, so no tool can hold a connection
 * open indefinitely.
 */
export async function withDeadline<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
