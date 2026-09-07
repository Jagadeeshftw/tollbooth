/**
 * An adaptive token bucket.
 *
 * Moove publishes no rate-limit numbers and sends no RateLimit-* or Retry-After
 * headers, so there is nothing to read and nothing to plan against. A probe of
 * the public read endpoint absorbed 56 req/s from one IP without a single 429,
 * which says the real ceiling is generous but not what it is.
 *
 * So this reacts only to what it observes: additive increase while requests
 * succeed, multiplicative decrease the moment a 429 arrives. It converges on
 * the real limit without needing to know it.
 */
export interface RateLimiterOptions {
  /** Requests per second to begin at. */
  initialRatePerSecond?: number;
  /** Never adapt above this. */
  maxRatePerSecond?: number;
  /** Never adapt below this, so a burst of 429s cannot wedge us at zero. */
  minRatePerSecond?: number;
  /** Successes required before nudging the rate back up. */
  successesBeforeIncrease?: number;
  /** How much to add on increase, in requests per second. */
  increaseStep?: number;
  /** Multiplier applied on a 429. */
  decreaseFactor?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class AdaptiveRateLimiter {
  #rate: number;
  readonly #max: number;
  readonly #min: number;
  readonly #successesBeforeIncrease: number;
  readonly #increaseStep: number;
  readonly #decreaseFactor: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  #tokens: number;
  #lastRefill: number;
  #consecutiveSuccesses = 0;
  /** Serialises waiters so they queue rather than all waking at once. */
  #tail: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.#rate = options.initialRatePerSecond ?? 5;
    this.#max = options.maxRatePerSecond ?? 25;
    this.#min = options.minRatePerSecond ?? 0.2;
    this.#successesBeforeIncrease = options.successesBeforeIncrease ?? 20;
    this.#increaseStep = options.increaseStep ?? 1;
    this.#decreaseFactor = options.decreaseFactor ?? 0.5;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#tokens = this.#rate;
    this.#lastRefill = this.#now();
  }

  get ratePerSecond(): number {
    return this.#rate;
  }

  /** Wait until a token is available, then take it. */
  async acquire(): Promise<void> {
    const mine = this.#tail.then(() => this.#take());
    // Swallow rejection on the chain so one failure cannot poison the queue.
    this.#tail = mine.catch(() => undefined);
    return mine;
  }

  async #take(): Promise<void> {
    for (;;) {
      this.#refill();
      if (this.#tokens >= 1) {
        this.#tokens -= 1;
        return;
      }
      const deficit = 1 - this.#tokens;
      await this.#sleep(Math.max(5, Math.ceil((deficit / this.#rate) * 1000)));
    }
  }

  #refill(): void {
    const now = this.#now();
    const elapsed = (now - this.#lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.#lastRefill = now;
    // Burst is capped at one second's worth, so an idle period cannot bank a
    // flood that immediately trips the limit we are trying to respect.
    this.#tokens = Math.min(this.#rate, this.#tokens + elapsed * this.#rate);
  }

  onSuccess(): void {
    if (++this.#consecutiveSuccesses >= this.#successesBeforeIncrease) {
      this.#consecutiveSuccesses = 0;
      this.#rate = Math.min(this.#max, this.#rate + this.#increaseStep);
    }
  }

  /** Called on an observed 429. Halves the rate and drains the bucket. */
  onRateLimited(): void {
    this.#consecutiveSuccesses = 0;
    this.#rate = Math.max(this.#min, this.#rate * this.#decreaseFactor);
    this.#tokens = 0;
    this.#lastRefill = this.#now();
  }
}

/**
 * Exponential backoff with full jitter, which is what Moove's own docs
 * recommend. Jitter matters more than the base here: without it, every pending
 * charge in a process retries on the same tick.
 */
export function backoffDelayMs(attempt: number, baseMs = 1000, capMs = 30_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponential);
}
