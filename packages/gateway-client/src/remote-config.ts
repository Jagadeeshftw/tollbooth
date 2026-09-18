import type { Sku } from '@tollbooth/core';

/**
 * A complete price definition as the gateway serves it — never a partial
 * patch. `sku` names which local price this tunes; `unit` and `currency` are
 * deliberately absent here — see `RemoteConfigurable`'s doc comment for why a
 * remote payload can never carry them.
 */
export interface RemotePriceUpdate {
  readonly sku: Sku;
  readonly amount: string;
  readonly credits: number | null;
  readonly ttlMs: number | null;
  readonly label: string;
}

export interface RemoteConfigApplyResult {
  /** Skus whose price actually changed. */
  readonly applied: readonly Sku[];
  /** Skus the provider sells locally, but this update was refused — and why. Never silent. */
  readonly rejected: readonly { sku: Sku; reason: string }[];
  /** Skus in the payload the provider does not sell at all — a remote update cannot invent one. */
  readonly ignored: readonly Sku[];
}

/**
 * The seam a `PaymentProvider` implements to accept remote price edits —
 * deliberately not part of `PaymentProvider` itself in `@tollbooth/core`,
 * the same reasoning as `ChargeFeedStore`: adding a required method there
 * breaks every existing provider at compile time. A provider either
 * implements this in addition, or it doesn't, detected structurally with
 * `isRemoteConfigurable` rather than assumed.
 *
 * This package cannot import `@tollbooth/moove`'s `MooveProvider` type
 * (`scripts/check-boundaries.mjs` forbids it — gateway mode must stay usable
 * with no payment provider opinion baked in), so this interface is the
 * independently-defined shape a provider matches structurally, the same
 * pattern `RawChargeOpenedEvent` already uses for `@tollbooth/mcp`'s hooks.
 *
 * The whole trust boundary lives in what this method is *not* given the
 * power to do:
 *
 *   - No `sku` outside what the provider already sells locally can be
 *     created remotely — tool-to-sku bindings are wired in the tenant's own
 *     deployed code, never invented from a wire payload.
 *   - `unit` and `currency` are not in `RemotePriceUpdate` at all: a remote
 *     edit tunes amount, credits, ttl and label, never a price's structural
 *     identity.
 *   - The floor (`assertPriceFloor` in `@tollbooth/core`) and its exemption
 *     list are local-only, fixed at construction from code the tenant
 *     deploys — nothing in this interface's input shape can carry or imply
 *     an exemption, so an implementation has no field to accidentally trust.
 *   - An already-open charge's price is a snapshot taken once at
 *     `openCharge` and never revisited — this seam only ever changes what a
 *     *future* `openCharge` reads.
 *
 * A conforming implementation must re-validate every update against its own
 * local floor before applying it, exactly as if the same value had arrived
 * through `MooveProviderOptions.prices` at construction — never trust the
 * gateway for correctness, only for the convenience of not redeploying to
 * change a price.
 */
export interface RemoteConfigurable {
  applyRemoteConfig(updates: readonly RemotePriceUpdate[]): RemoteConfigApplyResult;
}

export function isRemoteConfigurable(provider: unknown): provider is RemoteConfigurable {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    typeof (provider as Partial<RemoteConfigurable>).applyRemoteConfig === 'function'
  );
}
