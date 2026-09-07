import { isPositiveDecimal } from '@tollbooth/core';

import { MooveAuthError, MooveError, toMooveError } from './errors.js';
import { AdaptiveRateLimiter, backoffDelayMs } from './ratelimit.js';

export const MOOVE_PRODUCTION_BASE_URL = 'https://api.moove.xyz';

export interface MooveChain {
  id: string;
  name: string;
  symbol: string;
  chainType: 'EVM' | 'SVM' | 'TVM' | 'BVM';
  logo: string;
}

export interface MooveToken {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  logo: string | null;
  isNative: boolean | null;
  isStablecoin: boolean | null;
  currencyCode: string | null;
  commodityCode: string | null;
  chain: MooveChain;
  priceUsd?: string | null;
  isVerified?: boolean | null;
}

export type MoovePaymentLinkStatus = 'active' | 'completed' | 'inactive';

export interface MoovePaymentLink {
  id: string;
  userId: string;
  toAmount: string;
  destinationAddress: string;
  url: string;
  dateCreated: string;
  token: MooveToken;
  status: MoovePaymentLinkStatus;
  description?: string | null;
  maxUsage?: number | null;
  receivedAmount?: string | null;
  expirationDate?: string | null;
  transactionUrl?: string | null;
}

export interface MoovePaymentLinkCreation {
  id: string;
  url: string;
}

export interface CreatePaymentLinkInput {
  /** Decimal string in the settlement token. Never a number. */
  toAmount: string;
  description?: string;
  maxUsage?: number | null;
  /** ISO 8601, in the future. */
  expirationDate?: string | null;
}

export interface MooveClientOptions {
  apiKey: string;
  /** The host shown next to the key. Never guess it. */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /** Attempts for retryable failures (429, 5xx). Default 4. */
  maxAttempts?: number;
  /** Governs authenticated calls, which consume the per-key budget. */
  keyedLimiter?: AdaptiveRateLimiter;
  /** Governs unauthenticated reads, which consume only the per-IP budget. */
  publicLimiter?: AdaptiveRateLimiter;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A thin, typed client over the three Moove operations Tollbooth needs.
 *
 * The API key is held here and never leaves: it is not logged, not attached to
 * errors, and not sent on the public read.
 */
export class MooveClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxAttempts: number;
  readonly #keyed: AdaptiveRateLimiter;
  readonly #public: AdaptiveRateLimiter;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: MooveClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        'MooveClient requires an API key. Create one at ' +
          'https://www.moove.xyz/dashboard/api-keys and pass it as apiKey.'
      );
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? MOOVE_PRODUCTION_BASE_URL).replace(/\/+$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxAttempts = options.maxAttempts ?? 4;
    // Writes are rarer and cost money; reads are cheap and unauthenticated.
    this.#keyed = options.keyedLimiter ?? new AdaptiveRateLimiter({ initialRatePerSecond: 2 });
    this.#public = options.publicLimiter ?? new AdaptiveRateLimiter({ initialRatePerSecond: 8 });
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** POST /v1/payment-link. Settles to the key owner's own default wallet. */
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<MoovePaymentLinkCreation> {
    if (!isPositiveDecimal(input.toAmount)) {
      throw new TypeError(
        `toAmount must be a positive decimal string such as "5.00", received ` +
          `${JSON.stringify(input.toAmount)}`
      );
    }
    const body: Record<string, unknown> = { toAmount: input.toAmount };
    if (input.description !== undefined) body['description'] = input.description;
    if (input.maxUsage !== undefined) body['maxUsage'] = input.maxUsage;
    if (input.expirationDate !== undefined) body['expirationDate'] = input.expirationDate;

    return this.#request<MoovePaymentLinkCreation>({
      method: 'POST',
      path: '/v1/payment-link',
      authenticated: true,
      body,
    });
  }

  /**
   * GET /v1/payment-link/{id}.
   *
   * Public by design — the payer has no Moove account and no key — which is
   * why polling costs nothing against the tenant's key budget. The route is
   * deliberately absent from the published OpenAPI document, so if it ever
   * starts demanding a key this falls back to an authenticated read rather
   * than breaking.
   */
  async readPaymentLink(id: string): Promise<MoovePaymentLink> {
    try {
      return await this.#request<MoovePaymentLink>({
        method: 'GET',
        path: `/v1/payment-link/${encodeURIComponent(id)}`,
        authenticated: false,
      });
    } catch (error) {
      if (error instanceof MooveAuthError) {
        return this.#request<MoovePaymentLink>({
          method: 'GET',
          path: `/v1/payment-link/${encodeURIComponent(id)}`,
          authenticated: true,
        });
      }
      throw error;
    }
  }

  /**
   * GET /v1/payment-link. Ten per page, newest first.
   *
   * For reconciliation sweeps, not for watching one link — Moove's own docs are
   * explicit that polling this is the fastest way to a 429.
   */
  async listPaymentLinks(
    params: { status?: MoovePaymentLinkStatus; offset?: number } = {}
  ): Promise<{ data: MoovePaymentLink[]; limit: number; offset: number; nextOffset: number | null }> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.offset !== undefined) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query}` : '';
    return this.#request({
      method: 'GET',
      path: `/v1/payment-link${suffix}`,
      authenticated: true,
    });
  }

  async #request<T>(spec: {
    method: string;
    path: string;
    authenticated: boolean;
    body?: unknown;
  }): Promise<T> {
    const limiter = spec.authenticated ? this.#keyed : this.#public;
    let lastError: MooveError | undefined;

    for (let attempt = 0; attempt < this.#maxAttempts; attempt++) {
      await limiter.acquire();

      const headers: Record<string, string> = { accept: 'application/json' };
      if (spec.authenticated) headers['X-API-Key'] = this.#apiKey;
      if (spec.body !== undefined) headers['content-type'] = 'application/json';

      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}${spec.path}`, {
          method: spec.method,
          headers,
          ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
        });
      } catch (cause) {
        // Network-level failure: worth one more try, same as a 5xx.
        lastError = new MooveError('Moove request failed to reach the API', 0, 'UNKNOWN', true, {
          cause,
        });
        await this.#sleep(backoffDelayMs(attempt));
        continue;
      }

      if (response.ok) {
        limiter.onSuccess();
        return (await response.json()) as T;
      }

      const payload = await response.json().catch(() => undefined);
      const error = toMooveError(response.status, payload, response.headers.get('retry-after'));

      if (error.status === 429) limiter.onRateLimited();

      // The 4xx family can never succeed on retry, and retrying still counts
      // against the limit. Fail fast and let the caller act.
      if (!error.retryable) throw error;

      lastError = error;
      const retryAfterMs =
        'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number'
          ? error.retryAfterSeconds * 1000
          : backoffDelayMs(attempt);
      await this.#sleep(retryAfterMs);
    }

    throw lastError ?? new MooveError('Moove request failed', 0, 'UNKNOWN', false);
  }
}
