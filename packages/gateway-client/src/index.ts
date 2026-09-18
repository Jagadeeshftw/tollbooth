/**
 * @tollbooth/gateway-client — opt-in telemetry for the hosted Tollbooth gateway.
 *
 * Depends on `@tollbooth/core` and nothing else, enforced by
 * `scripts/check-boundaries.mjs`. No other Tollbooth package depends on this
 * one, in either direction: the library is fully usable with no Tollbooth
 * account, and this package is how a tenant opts in, never how they are
 * required in.
 *
 * Wire it into `@tollbooth/mcp`'s `withPaywall` by spreading `GatewayClient`'s
 * hook methods into `PaywallConfig` — see `GatewayClient`'s own doc comment.
 */

export { GatewayClient } from './client.js';
export type { BackfillOptions, BackfillReport, GatewayClientOptions } from './client.js';

export { chargeRefFrom, deterministicEventId, projectCall, projectChargeOpened, projectSettlement } from './project.js';

export { eventsForCharge } from './backfill.js';

export { isRemoteConfigurable } from './remote-config.js';
export type { RemoteConfigApplyResult, RemoteConfigurable, RemotePriceUpdate } from './remote-config.js';

export type {
  RawCallEvent,
  RawChargeOpenedEvent,
  ReportedSettlementStatus,
  WireCallEvent,
  WireChargeOpenedEvent,
  WireEvent,
  WireSettlementEvent,
} from './events.js';
