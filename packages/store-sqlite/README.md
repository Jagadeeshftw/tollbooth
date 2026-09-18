# @tollbooth/store-sqlite

Durable SQLite `EntitlementStore` for Tollbooth — the production default. Entitlements people paid for survive a restart.

## Install

```bash
npm install @tollbooth/store-sqlite
```

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
