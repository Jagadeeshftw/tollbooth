# Changelog

Nothing has shipped to npm yet (see the README). This tracks changes on `main`.

## Unreleased

### Fixed

- **Settlement could grant the wrong entitlement if a price changed while a charge was pending. This was a real bug in shipped behaviour, not a refactor.** `MooveProvider`'s grant step looked up the *current* price table by SKU at settlement time, not the price that was actually in effect when the checkout link was created. A charge survives a redeploy — that is the entire point of the Postgres store — so an entirely ordinary tool-author action (raising or lowering a price, then redeploying while a buyer's charge is still pending) could grant more or fewer credits than the buyer actually paid for. Reproduced in `packages/moove/test/provider.test.ts` ("grants the price recorded on the charge, not whatever the price table says at settlement time") by opening a charge against one price table and settling the same charge, for the same amount actually received, against a second `MooveProvider` constructed with a different price for that SKU — the shape of a redeploy, from the store's point of view. Fixed by snapshotting the resolved price onto `Charge.price` when the charge is opened, and granting from that snapshot. A charge written before this field existed reads back as `price: null`, and settlement falls back to the current price table for those — exactly what every charge did before this existed.

### Added

- `Charge.price: Price | null` in `@tollbooth/core` — the price resolved and used at charge-creation time.
- `assertPriceFloor(price)` in `@tollbooth/core`, and `MooveProviderOptions.allowBelowMinimum: readonly Sku[]`. A `MooveProvider` now re-validates every price it is given against `MIN_CREDIT_PACK_AMOUNT`, regardless of how the `Price` object was built, unless its SKU is named in this local, code-configured list. `definePrice({ allowBelowMinimum: true })` alone is no longer sufficient for a running server to sell a credit pack below the floor — its bypass is consumed when the price is built and leaves no trace on the object, so the provider does not take it on trust. This is aimed at a price list that may one day be loaded from outside this process: the floor is enforced at the boundary closest to the money, not only at the point a price happens to be defined in code.

### Migration notes

- `@tollbooth/store-postgres`: migration `0002_charge_price_snapshot` adds a nullable `price JSONB` column to `tollbooth_charges`, applied automatically on `store.ready()`. Verified against a database shaped like the deployed one (existing rows, no `price` column, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`): old rows read back `price: null`; new charges round-trip their full snapshot.
- `@tollbooth/store-sqlite`: adds a nullable `price TEXT` (JSON) column to `charges` — present in the schema for a new database, and added defensively via `ALTER TABLE` (ignoring "duplicate column") for one that already exists.
- Any `EntitlementStore` implementation outside this repo, and any code constructing a `Charge` object literal by hand (tests, fixtures), now needs a `price` field.
- `examples/research-tools`: its `MooveProvider` is now constructed with `allowBelowMinimum: ['research-trial']`, since that SKU is a deliberately below-floor $1 pack. Without this the example server now refuses to start.
