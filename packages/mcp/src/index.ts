/**
 * @tollbooth/mcp — the MCP binding.
 *
 * Depends on @tollbooth/core and the MCP SDK, never on a payment provider:
 * the paywall talks to a PaymentProvider, so swapping Moove for anything else
 * does not touch this package.
 */

export { composeChallenge } from './challenge.js';
export type {
  Challenge,
  ChallengeRenderer,
  ChallengeResult,
  ContentBlock,
  ModelChannel,
  RenderedChallenge,
  RenderedUserOnly,
  RenderedWithToken,
  RendererSet,
  TokenBearingRenderer,
  UserChannel,
  UserOnlyRenderer,
} from './challenge.js';

export { COPY_VARIANTS, DEFAULT_COPY, resolveCopy, v1, v2, v3, v4, v5 } from './copy.js';
export type { CopyEvidence, CopyVariant } from './copy.js';

export { SUPPORTED_REVISIONS, negotiate } from './negotiate.js';
export type { ClientProfile, NegotiateOptions } from './negotiate.js';

export {
  CLASSIC_REVISIONS,
  MRTR_REVISION,
  createStructuredRenderer,
  createTextRenderer,
  inputRequiredRenderer,
  urlElicitationRenderer,
} from './renderers.js';

export { DEFAULT_ARGUMENT_NAME, Paywall, withPaywall } from './paywall.js';
export type {
  PaidToolPricing,
  PaywallConfig,
  PaywalledServer,
  RegisterableServer,
} from './paywall.js';
