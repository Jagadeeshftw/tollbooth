# @tollbooth/gateway-server

The hosted gateway's backend: GitHub sign-in, tenant records, write-only ingest tokens, idempotent event ingest, and the Postgres schema and row-level security the dashboard sits on.

**Private — not published to npm.** Nothing you need to run a paid MCP server is in here. Tollbooth works with no Tollbooth account; this is the optional dashboard side, and the [`@tollbooth/gateway-client`](https://www.npmjs.com/package/@tollbooth/gateway-client) that reports to it is the only part a tool author installs.

## Why it is its own package

It depends on `@tollbooth/gateway-client` — for the wire-event contract both sides share — and on `pg`. Nothing else, in either direction, and `scripts/check-boundaries.mjs` enforces it. In particular it never touches `@tollbooth/core`, `@tollbooth/mcp`, `@tollbooth/moove` or either entitlement store: **a tenant's entitlement store and this database must never share a connection**, and the cheapest way to guarantee that is to make the import impossible.

There is no HTTP framework here and no page code. The dashboard app supplies those.

## The boot guard

`GatewayDatabase` runs its own migrations on first connection, and refuses to boot at all if the role it connects as is a Postgres superuser or holds `BYPASSRLS`:

```js
import { GatewayDatabase } from '@tollbooth/gateway-server';

const db = new GatewayDatabase({ connectionString: process.env.GATEWAY_DATABASE_URL });
await db.withTenant(tenantId, async (client) => client.query('SELECT ...'));
```

Every tenant-scoped table is protected by row-level security with `FORCE`, and `withTenant` is what sets the tenant for the connection. A superuser or a `BYPASSRLS` role silently ignores those policies, so one misconfigured connection string would turn per-tenant isolation into a no-op that still passes every test. Refusing to start is the only failure mode loud enough. `withoutTenant` exists for the handful of tables that are not tenant-scoped, such as the tenant list itself.

## What it holds, and what it never sees

Tenants, their ingest tokens (stored as hashes; the token itself is shown once at creation), the projected wire events, the daily rollups and the remote price config with its audit log.

It never receives a payment handle, a Moove link id, a checkout URL or a Moove API key. Those stay in the tool author's own process. The client's projection strips them before anything is sent, and charges are joined across events by a one-way hash of the nonce.

## Tests

```bash
npm run test --workspace=@tollbooth/gateway-server
```

The suites that need a real database are skipped unless `TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL` is set — never `DATABASE_URL`, because they truncate what they find. The isolation suite is the interesting one: it asserts that one tenant cannot read another's rows even with a crafted query.
