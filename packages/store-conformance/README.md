# @tollbooth/store-conformance

The behaviour every Tollbooth `EntitlementStore` must have, written once and run against every implementation.

**Private — not published to npm.** It is a test suite, not a runtime dependency.

## Why it exists

A store is what stands between somebody's payment and the thing they paid for. The contracts that lose money when they are wrong — a credit spent exactly once under concurrency, a settlement granted exactly once when two callers observe it together, an entitlement that survives the process that wrote it — are properties of the *interface*, not of any one database. Re-deriving them per package is how two backends end up with two different ideas of what `consume` means.

So they live here, and each store runs them:

```js
import { runStoreConformance } from '@tollbooth/store-conformance';

runStoreConformance({
  name: 'SqliteEntitlementStore',
  create: async () => new SqliteEntitlementStore({ path: tempFile() }),
});
```

The three backends in this repo — the in-memory reference store in `@tollbooth/core`, `@tollbooth/store-sqlite` and `@tollbooth/store-postgres` — pass the same suite. A fourth implementation is welcome to; that is the point of the interface.

## What it checks

Granting and consuming, expiry and sliding subject lifetimes, the charge feed, and the parts that only fail under pressure: N concurrent callers against M credits granting exactly M, exactly one of many simultaneous claimants winning a settlement, and — where the harness provides a way to run one — a **separate process** competing for the same storage, which is the case a single-process test cannot reach.

Cross-process contention is opt-in per harness: provide the hook and that test runs, omit it and it is skipped rather than silently passing.
