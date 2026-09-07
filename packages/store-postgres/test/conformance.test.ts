import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

import { runStoreConformance } from '@tollbooth/store-conformance';
import { Pool } from 'pg';

import { PostgresEntitlementStore } from '../src/index.js';

const execFileAsync = promisify(execFile);

/**
 * Point this at a real database.
 *
 * Neon is what deployment runs on, so that is where the reported numbers should
 * come from. A local Postgres is useful for shaking out logic bugs but does not
 * exercise the pooler, TLS, or cold starts after idle suspension.
 */
/**
 * Deliberately NOT falling back to DATABASE_URL.
 *
 * This suite truncates every Tollbooth table on each `create`. Falling back to
 * the variable a deployment uses would mean anyone running `npm test` on a
 * machine configured for production wipes entitlements people have paid for.
 * The test variable has to be set on purpose.
 */
const CONNECTION_STRING = process.env['TOLLBOOTH_TEST_POSTGRES_URL'] ?? '';

const TABLES = [
  'tollbooth_entitlements',
  'tollbooth_charges',
  'tollbooth_subjects',
  'tollbooth_settlement_claims',
];

if (!CONNECTION_STRING) {
  describe('PostgresEntitlementStore', () => {
    it(
      'needs TOLLBOOTH_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)',
      { skip: 'no connection string' },
      () => {}
    );
  });
} else {
  /** One shared pool for fixture work, kept out of the store under test. */
  const admin = new Pool({ connectionString: CONNECTION_STRING, max: 1 });

  runStoreConformance({
    name: `PostgresEntitlementStore (${hostOf(CONNECTION_STRING)})`,

    async create(options) {
      const store = new PostgresEntitlementStore({
        connectionString: CONNECTION_STRING,
        ...options,
      });
      await store.ready();
      // Every test expects an empty store, and node:test runs these
      // sequentially, so truncating on create is isolation enough.
      await admin.query(`TRUNCATE ${TABLES.join(', ')}`);
      return store;
    },

    async reopen(store) {
      await store.close();
      const reopened = new PostgresEntitlementStore({
        connectionString: CONNECTION_STRING,
        migrate: false,
      });
      await reopened.ready();
      return reopened;
    },

    async spawnConsumers({ count, subject, sku }) {
      const worker = new URL('./worker-consume.mjs', import.meta.url).pathname;
      // Generous, because a cold Neon compute can take a second to accept the
      // first connection and every worker must still collide.
      const startAt = Date.now() + 2500;
      const outputs = await Promise.all(
        Array.from({ length: count }, () =>
          execFileAsync(process.execPath, [
            worker,
            CONNECTION_STRING,
            subject,
            sku,
            String(startAt),
          ])
            .then((r) => r.stdout)
            .catch(
              (e: { stdout?: string; stderr?: string }) =>
                e.stdout ||
                JSON.stringify({ ok: false, reason: 'spawn-failed', error: e.stderr ?? '' })
            )
        )
      );
      // A worker that wrote nothing crashed before it could report. Say so,
      // rather than dying in JSON.parse and hiding the real failure.
      return outputs.map((o) =>
        o.trim() === ''
          ? { ok: false, reason: 'no-output' }
          : (JSON.parse(o) as { ok: boolean })
      );
    },

    async cleanup() {
      await admin.query(`TRUNCATE ${TABLES.join(', ')}`).catch(() => undefined);
      await admin.end();
    },
  });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'unknown host';
  }
}
