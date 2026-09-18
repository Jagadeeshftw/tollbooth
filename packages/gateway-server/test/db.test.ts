import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GatewayDatabase } from '../src/db.js';
import { admin, CONNECTION_STRING, SUPERUSER_CONNECTION_STRING } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('GatewayDatabase', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  describe('GatewayDatabase.ready()', () => {
    it('boots normally against an ordinary, non-superuser role', async () => {
      const db = new GatewayDatabase({ connectionString: CONNECTION_STRING });
      try {
        await assert.doesNotReject(() => db.ready());
      } finally {
        await db.close();
      }
    });
  });

  describe('GatewayDatabase refuses a superuser connection', () => {
    it(
      'throws rather than booting silently against a role that bypasses row-level security',
      { skip: SUPERUSER_CONNECTION_STRING ? false : 'no TOLLBOOTH_GATEWAY_TEST_SUPERUSER_POSTGRES_URL set' },
      async () => {
        const db = new GatewayDatabase({ connectionString: SUPERUSER_CONNECTION_STRING });
        try {
          await assert.rejects(() => db.ready(), /superuser|BYPASSRLS/);
        } finally {
          await db.close();
        }
      }
    );
  });

  describe('GatewayDatabase refuses an entitlement-store connection, even under misconfiguration', () => {
    it('throws rather than migrating its schema into a database that already holds tollbooth_* tables', async () => {
      // Stand in for a real tenant entitlement store without depending on
      // @tollbooth/store-postgres: the guard keys only on the `tollbooth_%`
      // name prefix, which is exactly what that package's own schema uses
      // and nothing in this one ever would.
      await admin!.query('CREATE TABLE IF NOT EXISTS tollbooth_probe_entitlements (id TEXT PRIMARY KEY)');
      try {
        const db = new GatewayDatabase({ connectionString: CONNECTION_STRING });
        try {
          await assert.rejects(() => db.ready(), /tollbooth_\*|entitlement store/);
        } finally {
          await db.close();
        }
      } finally {
        await admin!.query('DROP TABLE IF EXISTS tollbooth_probe_entitlements');
      }
    });
  });
}
