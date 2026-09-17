import { Pool } from 'pg';

import { GatewayDatabase } from '../src/db.js';

/**
 * Deliberately its own variable, never falling back to DATABASE_URL or
 * anything a tenant's own entitlement store might read — same reasoning as
 * `@tollbooth/store-postgres`'s test suite: this one truncates every gateway
 * table on each `freshDatabase()`, and must never be pointed at anything by
 * accident. It also must never be the *same* database as
 * TOLLBOOTH_TEST_POSTGRES_URL — the whole point under test is that this
 * schema and a tenant's entitlement store are different trust domains.
 *
 * Unlike store-postgres, these tests span several files that all truncate
 * and reuse the same tenant fixture data against one live database — `node
 * --test` runs separate files concurrently by default, which raced
 * migrations and truncations against each other. `package.json` runs this
 * suite with `--test-concurrency=1` for exactly that reason.
 *
 * The connection's role MUST NOT be a Postgres superuser and must not have
 * BYPASSRLS. Postgres exempts both from row-level security unconditionally —
 * `FORCE ROW LEVEL SECURITY` does not override it — so pointing this at the
 * default `postgres` superuser in a fresh `postgres:16` container makes
 * every isolation test pass by accident, having tested nothing. Neon's own
 * connection roles are ordinary, non-superuser roles, so this only asks the
 * test setup to match production. To reproduce locally:
 *
 *   CREATE ROLE gateway_test_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
 *   ALTER DATABASE <db> OWNER TO gateway_test_app;
 *   ALTER SCHEMA public OWNER TO gateway_test_app;
 *   GRANT ALL ON SCHEMA public TO gateway_test_app;
 *
 * and point TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL at that role, not `postgres`.
 */
export const CONNECTION_STRING = process.env['TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL'] ?? '';

/**
 * Optional, and only for `db.test.ts`'s one negative case: a connection
 * string that resolves to an actual Postgres superuser (or a BYPASSRLS
 * role), to prove `GatewayDatabase` refuses to boot against one. Not every
 * environment running this suite will have direct superuser access — a
 * hosted Neon test branch, for instance — so that one test skips cleanly
 * when this is unset rather than requiring it.
 */
export const SUPERUSER_CONNECTION_STRING = process.env['TOLLBOOTH_GATEWAY_TEST_SUPERUSER_POSTGRES_URL'] ?? '';

const TABLES = [
  'gateway_daily_rollups',
  'gateway_calls',
  'gateway_charges',
  'gateway_ingested_events',
  'gateway_ingest_tokens',
  'gateway_tenants',
];

/** One shared admin pool for fixture work (truncating, raw isolation probes), kept out of the code under test. */
export const admin = CONNECTION_STRING ? new Pool({ connectionString: CONNECTION_STRING, max: 2 }) : undefined;

export async function freshDatabase(): Promise<GatewayDatabase> {
  const db = new GatewayDatabase({ connectionString: CONNECTION_STRING });
  await db.ready();
  // node:test runs a file's tests sequentially, so truncating on setup is
  // isolation enough — same approach as store-postgres's own suite.
  await admin!.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  return db;
}
