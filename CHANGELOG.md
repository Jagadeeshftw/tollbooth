# Changelog

Six packages are published on npm; the rest of the repo — the dashboard, the site, the
example and the video — is not published and versions with `main`. This tracks changes on
`main`, and records each npm release below.

## Unreleased

### Fixed

- **Settlement could grant the wrong entitlement if a price changed while a charge was pending. This was a real bug in shipped behaviour, not a refactor.** `MooveProvider`'s grant step looked up the *current* price table by SKU at settlement time, not the price that was actually in effect when the checkout link was created. A charge survives a redeploy — that is the entire point of the Postgres store — so an entirely ordinary tool-author action (raising or lowering a price, then redeploying while a buyer's charge is still pending) could grant more or fewer credits than the buyer actually paid for. Reproduced in `packages/moove/test/provider.test.ts` ("grants the price recorded on the charge, not whatever the price table says at settlement time") by opening a charge against one price table and settling the same charge, for the same amount actually received, against a second `MooveProvider` constructed with a different price for that SKU — the shape of a redeploy, from the store's point of view. Fixed by snapshotting the resolved price onto `Charge.price` when the charge is opened, and granting from that snapshot. A charge written before this field existed reads back as `price: null`, and settlement falls back to the current price table for those — exactly what every charge did before this existed.
- The paywall's challenge — the amount, currency and label shown to the agent when an existing pending charge is reused on retry — had the same class of bug: it read the *current* price table rather than the price the reused charge (and its already-rendered checkout page) actually opened at. It now reads the reused charge's own snapshot too.

### Added

- `Charge.price: Price | null` in `@tollbooth/core` — the price resolved and used at charge-creation time.
- `assertPriceFloor(price)` in `@tollbooth/core`, and `MooveProviderOptions.allowBelowMinimum: readonly Sku[]`. A `MooveProvider` now re-validates every price it is given against `MIN_CREDIT_PACK_AMOUNT`, regardless of how the `Price` object was built, unless its SKU is named in this local, code-configured list. `definePrice({ allowBelowMinimum: true })` alone is no longer sufficient for a running server to sell a credit pack below the floor — its bypass is consumed when the price is built and leaves no trace on the object, so the provider does not take it on trust. This is aimed at a price list that may one day be loaded from outside this process: the floor is enforced at the boundary closest to the money, not only at the point a price happens to be defined in code.
- `PaywallConfig.onChargeOpened` in `@tollbooth/mcp` — fires once per genuinely new checkout link (never for a retry that reuses a pending one), carrying `tool`, `sku`, `nonce`, `amount`, `currency` and `at`. No handle, no checkout URL.
- `PaywallConfig.onCall` gained `cost` and `at` (epoch ms).
- `@tollbooth/gateway-client` — an opt-in package, depending on nothing but `@tollbooth/core`, that batches paywall telemetry off the call path and sends it to a Tollbooth gateway with retry and idempotent event ids. Its allow-list projection reduces a raw settlement observation — which carries the subject handle, the nonce, the Moove link id and the checkout URL — down to a wire event with none of them, joining a charge's `charge_opened` and `settlement` events on a one-way hash of the nonce instead. No other package depends on this one, in either direction, and `scripts/check-boundaries.mjs` now enforces that both ways: this package cannot import anything but core, and nothing else can import this package.

### Migration notes

- `@tollbooth/store-postgres`: migration `0002_charge_price_snapshot` adds a nullable `price JSONB` column to `tollbooth_charges`, applied automatically on `store.ready()`. Verified against a database shaped like the deployed one (existing rows, no `price` column, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`): old rows read back `price: null`; new charges round-trip their full snapshot.
- `@tollbooth/store-sqlite`: adds a nullable `price TEXT` (JSON) column to `charges` — present in the schema for a new database, and added defensively via `ALTER TABLE` (ignoring "duplicate column") for one that already exists.
- Any `EntitlementStore` implementation outside this repo, and any code constructing a `Charge` object literal by hand (tests, fixtures), now needs a `price` field.
- `examples/research-tools`: its `MooveProvider` is now constructed with `allowBelowMinimum: ['research-trial']`, since that SKU is a deliberately below-floor $1 pack. Without this the example server now refuses to start.

## store-sqlite 0.1.2 — 2026-09-19

### Fixed

- **`@tollbooth/store-sqlite` crashed at process exit on Node 24.** `better-sqlite3` 11.10.0 aborts during teardown on Node 24.20 — `Statement::~Statement` calls `RemoveEnvironmentCleanupHook` with a null environment, failing an assertion after the tests themselves have passed. Any Node 24 user of this package hit it, not only CI. Fixed by moving to `better-sqlite3` `^12.11.1`: the full suite is green on Node 20.20.2, 22.23.2 and 24.20.0, and the cross-process contention test that reproduced it passes ten runs out of ten on 24.20.0 where 11.10.0 failed every time. The JavaScript API this package uses is unchanged across the major version; the bundled SQLite moves from 3.49.2 to 3.53.2.
- Note for Node 20 users: from 12.10.0 `better-sqlite3` ships no prebuilt Node 20 binary, so installing on Node 20 compiles it from source and needs Python and a C++ toolchain. The package README explains this and gives an `overrides` pin for hosts without one.

## 0.1.1 — 2026-09-18

### Added

- READMEs for the six published packages, and `repository`, `homepage` and `bugs` metadata so each npm page links back to its own directory. No code changed in this release.

## 0.1.0 — 2026-09-18

First npm release of the six public packages: `@tollbooth/core`, `@tollbooth/mcp`, `@tollbooth/moove`, `@tollbooth/gateway-client`, `@tollbooth/store-postgres` and `@tollbooth/store-sqlite`. `@tollbooth/design`, `@tollbooth/gateway-server` and `@tollbooth/store-conformance` stay private and unpublished.
