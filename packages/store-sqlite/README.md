# @tollbooth/store-sqlite

Durable SQLite `EntitlementStore` for Tollbooth — the production default. Entitlements people paid for survive a restart.

## Install

```bash
npm install @tollbooth/store-sqlite
```

### Node versions

Node 20, 22 and 24. The SQLite driver, [`better-sqlite3`](https://www.npmjs.com/package/better-sqlite3), ships prebuilt binaries for Node 22 and 24, so installs there download a binary and are done.

On Node 20 it no longer ships one, so npm compiles it from source — which needs Python and a C++ toolchain (`build-essential` on Debian/Ubuntu, Xcode Command Line Tools on macOS). Slim and Alpine images usually lack them. If you can't install a toolchain, pin the driver to its last release with Node 20 binaries in your own `package.json`:

```json
"overrides": { "better-sqlite3": "12.9.0" }
```

Node 20 is past end-of-life; moving to 22 or 24 removes the compile step entirely.

## Use

```js
import { definePrice, entitlementFromPrice, mintEntitlementId, mintSubject } from '@tollbooth/core';
import { SqliteEntitlementStore } from '@tollbooth/store-sqlite';

const store = new SqliteEntitlementStore({ path: 'tollbooth.sqlite' });
const price = definePrice({ sku: 'search', unit: 'credit_pack', amount: '5.00', credits: 10, label: 'Search — 10 credits' });

const subject = mintSubject();
await store.grant(entitlementFromPrice({ price, subject, chargeId: 'demo', entitlementId: mintEntitlementId(), now: Date.now() }));

await store.consume(subject, 'search');
// { ok: true, remaining: 9, ... } — still there after a restart
```

Implements the same `EntitlementStore` interface as [`@tollbooth/core`](https://www.npmjs.com/package/@tollbooth/core)'s in-memory reference store and [`@tollbooth/store-postgres`](https://www.npmjs.com/package/@tollbooth/store-postgres) — swap between them without touching calling code.

## Docs

[tollbooth.0xo.in/docs/stores](https://tollbooth.0xo.in/docs/stores)
