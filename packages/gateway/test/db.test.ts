import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GatewayDatabase } from '../src/db.js';
import { CONNECTION_STRING, SUPERUSER_CONNECTION_STRING } from './helpers.js';

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
}
