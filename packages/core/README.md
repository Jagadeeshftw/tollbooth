# @tollbooth/core

The Tollbooth entitlement model: prices, entitlements, charges and subject handles. No payment provider, no MCP — the model any binding is built on.

## Install

```bash
npm install @tollbooth/core
```

## Use

```js
import { MemoryEntitlementStore, definePrice, entitlementFromPrice, mintEntitlementId, mintSubject } from '@tollbooth/core';

const store = new MemoryEntitlementStore({ acknowledgeEphemeral: true });
const price = definePrice({ sku: 'search', unit: 'credit_pack', amount: '5.00', credits: 10, label: 'Search — 10 credits' });

const subject = mintSubject();
await store.grant(entitlementFromPrice({ price, subject, chargeId: 'demo', entitlementId: mintEntitlementId(), now: Date.now() }));

await store.consume(subject, 'search');
// { ok: true, entitlementId: '...', remaining: 9, expiresAt: null }
```

`MemoryEntitlementStore` is the reference implementation — correct, and deliberately not durable. For production, use [`@tollbooth/store-sqlite`](https://www.npmjs.com/package/@tollbooth/store-sqlite) or [`@tollbooth/store-postgres`](https://www.npmjs.com/package/@tollbooth/store-postgres); either implements the same `EntitlementStore` interface this package defines.

## Docs

[tollbooth.0xo.in/docs/overview](https://tollbooth.0xo.in/docs/overview)
