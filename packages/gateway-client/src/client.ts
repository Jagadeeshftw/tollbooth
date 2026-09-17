import type { SettlementOutcome } from '@tollbooth/core';

import { backoffDelayMs } from './backoff.js';
import type { RawCallEvent, RawChargeOpenedEvent, WireEvent } from './events.js';
import { projectCall, projectChargeOpened, projectSettlement } from './project.js';

export interface GatewayClientOptions {
  /** The tenant's gateway ingest URL. */
  endpoint: string;
  /** A write-only ingest token for this tenant. Never the Moove key. */
  ingestToken: string;
  /** How often the background timer flushes. Default 5000ms. */
  flushIntervalMs?: number;
  /** Events sent per request. Default 50. */
  maxBatchSize?: number;
  /**
   * Oldest events are dropped past this so a persistent outage cannot grow
   * memory without bound. This is telemetry, not money: the Moove settlement
   * path this reports on has its own independent, already-correct
   * exactly-once mechanics, untouched by anything in this package. Default 5000.
   */
  maxQueueSize?: number;
  /** Attempts per batch before it is dropped and reported via `onDropped`. Default 4. */
  maxAttempts?: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called whenever events are dropped — by the queue bound, or after exhausting retries. */
  onDropped?: (events: readonly WireEvent[], error: unknown) => void;
}

/**
 * Batches paywall telemetry off the call path and sends it to a Tollbooth
 * gateway, with retry and idempotent event ids.
 *
 * Entirely opt-in: nothing in `@tollbooth/mcp`, `@tollbooth/core`,
 * `@tollbooth/moove` or either store package knows this class exists, and a
 * server that never constructs one behaves exactly as it did before this
 * package existed. Wire it in by spreading its hooks into `withPaywall`:
 *
 *     const gateway = new GatewayClient({ endpoint, ingestToken });
 *     gateway.start();
 *     const server = withPaywall(mcp, {
 *       provider, store,
 *       onChargeOpened: gateway.onChargeOpened,
 *       onCall: gateway.onCall,
 *       onSettlement: gateway.onSettlement,
 *     });
 *
 * Every hook method here is synchronous and never throws: `onCall` et al. in
 * `@tollbooth/mcp` are fire-and-forget calls on the paywall's own critical
 * path, so nothing here may block or fail a paid tool call. A telemetry
 * failure is visible only through `onDropped`.
 */
export class GatewayClient {
  readonly #endpoint: string;
  readonly #ingestToken: string;
  readonly #flushIntervalMs: number;
  readonly #maxBatchSize: number;
  readonly #maxQueueSize: number;
  readonly #maxAttempts: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #onDropped: ((events: readonly WireEvent[], error: unknown) => void) | undefined;

  #queue: WireEvent[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #flushing: Promise<void> | undefined;

  constructor(options: GatewayClientOptions) {
    if (!options.endpoint) throw new Error('GatewayClient requires an endpoint');
    if (!options.ingestToken) throw new Error('GatewayClient requires an ingestToken');
    this.#endpoint = options.endpoint;
    this.#ingestToken = options.ingestToken;
    this.#flushIntervalMs = options.flushIntervalMs ?? 5000;
    this.#maxBatchSize = options.maxBatchSize ?? 50;
    this.#maxQueueSize = options.maxQueueSize ?? 5000;
    this.#maxAttempts = options.maxAttempts ?? 4;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    this.#onDropped = options.onDropped;
  }

  /** How many projected events are queued, waiting to be sent. For tests and health checks. */
  get queueLength(): number {
    return this.#queue.length;
  }

  /** Structurally matches `@tollbooth/mcp`'s `PaywallConfig['onChargeOpened']`. */
  readonly onChargeOpened = (event: RawChargeOpenedEvent): void => {
    this.#enqueue(projectChargeOpened(event));
  };

  /** Structurally matches `@tollbooth/mcp`'s `PaywallConfig['onCall']`. */
  readonly onCall = (event: RawCallEvent): void => {
    this.#enqueue(projectCall(event));
  };

  /** Structurally matches `@tollbooth/mcp`'s `PaywallConfig['onSettlement']`. */
  readonly onSettlement = (outcome: SettlementOutcome): void => {
    const projected = projectSettlement(outcome, this.#now());
    if (projected) this.#enqueue(projected);
  };

  #enqueue(event: WireEvent): void {
    this.#queue.push(event);
    if (this.#queue.length > this.#maxQueueSize) {
      // Oldest first: the newest events are the ones most likely still worth having.
      const dropped = this.#queue.splice(0, this.#queue.length - this.#maxQueueSize);
      this.#onDropped?.(dropped, new Error('queue exceeded maxQueueSize'));
    }
  }

  /** Start the periodic flush. Idempotent; safe to call again after `stop()`. */
  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.flush();
    }, this.#flushIntervalMs);
    this.#timer.unref?.();
  }

  /** Stop the periodic flush and send whatever is queued one last time. */
  async stop(): Promise<void> {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.flush();
  }

  /**
   * Send everything currently queued, in batches. Never rejects: there is
   * nothing the caller could do about a telemetry failure that `onDropped`
   * does not already cover, and a paid tool call must never fail because
   * analytics could not be sent.
   */
  async flush(): Promise<void> {
    // A concurrent call — the timer firing mid-`stop()` — shares one in-flight
    // flush rather than racing it over the same queue.
    if (this.#flushing) return this.#flushing;
    this.#flushing = this.#doFlush().finally(() => {
      this.#flushing = undefined;
    });
    return this.#flushing;
  }

  async #doFlush(): Promise<void> {
    while (this.#queue.length > 0) {
      const batch = this.#queue.slice(0, this.#maxBatchSize);
      await this.#send(batch);
      // Always advance: `#send` either delivered this batch or reported it
      // dropped after exhausting retries. A batch that keeps failing must
      // not block every batch behind it during a long gateway outage.
      this.#queue.splice(0, batch.length);
    }
  }

  /** One batch, retried with jittered backoff. Reports via `onDropped` on total failure. */
  async #send(batch: readonly WireEvent[]): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.#maxAttempts; attempt++) {
      try {
        const res = await this.#fetch(this.#endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.#ingestToken}`,
          },
          body: JSON.stringify({ events: batch }),
        });
        if (res.ok) return;
        lastError = new Error(`gateway ingest responded HTTP ${res.status}`);
        // The 4xx family — a bad token, a malformed batch — cannot succeed on
        // retry, and retrying still spends the tenant's own request budget
        // against their gateway account for no gain.
        if (res.status >= 400 && res.status < 500) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < this.#maxAttempts - 1) await this.#sleep(backoffDelayMs(attempt));
    }
    this.#onDropped?.(batch, lastError);
  }
}
