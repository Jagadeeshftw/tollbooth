# @tollbooth/store-postgres

Durable Postgres `EntitlementStore` for Tollbooth, built for Neon — for a deployment across more than one process or region.

## Install

```bash
npm install @tollbooth/store-postgres
```

## Use

```js
import { definePrice, entitlementFromPrice, mintEntitlementId, mintSubject } from '@tollbooth/core';
import { PostgresEntitlementStore } from '@tollbooth/store-postgres';

const store = new PostgresEntitlementStore({ connectionString: process.env.DATABASE_URL });
const price = definePrice({ sku: 'search', unit: 'credit_pack', amount: '5.00', credits: 10, label: 'Search — 10 credits' });

const subject = mintSubject();
await store.grant(entitlementFromPrice({ price, subject, chargeId: 'demo', entitlementId: mintEntitlementId(), now: Date.now() }));

await store.consume(subject, 'search');
// { ok: true, remaining: 9, ... }
```

Needs a real Postgres to run — for a throwaway one: `docker run -p 5432:5432 -e POSTGRES_PASSWORD=x -e POSTGRES_DB=tollbooth postgres:16`, then `DATABASE_URL=postgresql://postgres:x@localhost:5432/tollbooth`. Migrations run automatically on first connection.

Implements the same `EntitlementStore` interface as [`@tollbooth/store-sqlite`](https://www.npmjs.com/package/@tollbooth/store-sqlite) — swap between them without touching calling code.

## Docs

[tollbooth.0xo.in/docs/stores](https://tollbooth.0xo.in/docs/stores)
