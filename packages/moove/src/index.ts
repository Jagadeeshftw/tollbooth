/**
 * @tollbooth/moove — the Moove payment-provider binding.
 *
 * Knows nothing about MCP: it is usable from any server that can create a
 * charge and later ask whether it settled.
 */

export {
  MOOVE_PRODUCTION_BASE_URL,
  MooveClient,
} from './client.js';
export type {
  CreatePaymentLinkInput,
  MooveChain,
  MooveClientOptions,
  MoovePaymentLink,
  MoovePaymentLinkCreation,
  MoovePaymentLinkStatus,
  MooveToken,
} from './client.js';

export {
  MooveAccountNotReadyError,
  MooveAmountError,
  MooveAuthError,
  MooveError,
  MooveNotFoundError,
  MooveRateLimitError,
  MooveScopeError,
  MooveServerError,
  toMooveError,
} from './errors.js';
export type { MooveErrorCode } from './errors.js';

export {
  MIN_POLL_INTERVAL_MS,
  POLL_JITTER,
  POLL_SCHEDULE_MS,
  isTerminalStatus,
  nextPollDelayMs,
  shouldPoll,
} from './poller.js';

export {
  DEFAULT_CHARGE_TTL_MS,
  MAX_DESCRIPTION_LENGTH,
  MIN_CHARGE_TTL_MS,
  MooveProvider,
  NONCE_PREFIX,
  buildChargeDescription,
} from './provider.js';
export type { MooveProviderOptions } from './provider.js';
export type { PaymentProvider, SettlementOutcome } from '@tollbooth/core';

export { AdaptiveRateLimiter, backoffDelayMs } from './ratelimit.js';
export type { RateLimiterOptions } from './ratelimit.js';
