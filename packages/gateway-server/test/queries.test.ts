import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type { WireCallEvent, WireSettlementEvent } from '@tollbooth/gateway-client';

import { ingestBatch } from '../src/ingest.js';
import { creditsOutstanding, medianTimeToPaySeconds } from '../src/queries.js';
import { upsertTenantForGithubUser } from '../src/tenants.js';
import { CONNECTION_STRING, freshDatabase } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('queries', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  async function tenant(db: Awaited<ReturnType<typeof freshDatabase>>) {
    return upsertTenantForGithubUser(db, { id: 1, login: 'tenant-a', name: null, avatarUrl: null });
  }

  function settlement(over: Partial<WireSettlementEvent> = {}): WireSettlementEvent {
    return {
      kind: 'settlement', eventId: randomUUID(), at: 2000, status: 'granted', sku: 'search',
      chargeRef: randomUUID().replace(/-/g, ''), amount: '10.00', receivedAmount: '10.00',
      receivedFraction: null, credits: null, ...over,
    };
  }

  function call(over: Partial<WireCallEvent> = {}): WireCallEvent {
    return {
      kind: 'call', eventId: randomUUID(), at: 1500, tool: 'lookup_market_data', sku: 'search', cost: 1,
      tokenPresented: true, tokenFingerprint: 'tb_s_x7Q..dyA3', tokenRecognised: true, outcome: 'authorised', ...over,
    };
  }

  describe('creditsOutstanding', () => {
    it('is zero for a tenant with no history', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        assert.deepEqual(await creditsOutstanding(db, t.id), { bySku: {}, total: 0 });
      } finally {
        await db.close();
      }
    });

    it('is granted minus consumed, per sku and in total', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          settlement({ sku: 'search', status: 'granted', credits: 250 }),
          call({ sku: 'search', outcome: 'authorised', cost: 60 }),
        ]);
        const result = await creditsOutstanding(db, t.id);
        assert.equal(result.bySku['search'], 190);
        assert.equal(result.total, 190);
      } finally {
        await db.close();
      }
    });

    it('accumulates all-time, across separate days, not just a recent window', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const longAgo = Date.UTC(2026, 0, 1);
        const today = Date.now();
        await ingestBatch(db, t.id, [settlement({ sku: 'search', status: 'granted', credits: 250, at: longAgo })]);
        await ingestBatch(db, t.id, [call({ sku: 'search', outcome: 'authorised', cost: 10, at: today })]);
        const result = await creditsOutstanding(db, t.id);
        assert.equal(result.total, 240, 'a purchase from months ago is still outstanding until spent');
      } finally {
        await db.close();
      }
    });

    it('separates skus rather than mixing their balances', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          settlement({ sku: 'research-trial', status: 'granted', credits: 25 }),
          settlement({ sku: 'research', status: 'granted', credits: 250 }),
        ]);
        const result = await creditsOutstanding(db, t.id);
        assert.equal(result.bySku['research-trial'], 25);
        assert.equal(result.bySku['research'], 250);
        assert.equal(result.total, 275);
      } finally {
        await db.close();
      }
    });

    it('one tenant\'s balance is invisible to another (row-level security, not just app filtering)', async () => {
      const db = await freshDatabase();
      try {
        const a = await upsertTenantForGithubUser(db, { id: 1, login: 'a', name: null, avatarUrl: null });
        const b = await upsertTenantForGithubUser(db, { id: 2, login: 'b', name: null, avatarUrl: null });
        await ingestBatch(db, a.id, [settlement({ sku: 'search', status: 'granted', credits: 250 })]);
        assert.equal((await creditsOutstanding(db, b.id)).total, 0);
        assert.equal((await creditsOutstanding(db, a.id)).total, 250);
      } finally {
        await db.close();
      }
    });
  });

  describe('medianTimeToPaySeconds', () => {
    it('is null when nothing has ever settled', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        assert.equal(await medianTimeToPaySeconds(db, t.id), null);
      } finally {
        await db.close();
      }
    });

    it('is null for a charge that opened but never settled — not zero', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          {
            kind: 'charge_opened', eventId: randomUUID(), at: 1000, tool: 'x', sku: 'search',
            chargeRef: randomUUID().replace(/-/g, ''), amount: '10.00', currency: 'USDC',
          },
        ]);
        assert.equal(await medianTimeToPaySeconds(db, t.id), null);
      } finally {
        await db.close();
      }
    });

    it('reports the middle value, in seconds, across several settled charges', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        // Three charges: 10s, 30s, 50s to settle. Median = 30s.
        for (const seconds of [10, 30, 50]) {
          const ref = randomUUID().replace(/-/g, '');
          await ingestBatch(db, t.id, [
            {
              kind: 'charge_opened', eventId: randomUUID(), at: 0, tool: 'x', sku: 'search',
              chargeRef: ref, amount: '10.00', currency: 'USDC',
            },
          ]);
          await ingestBatch(db, t.id, [settlement({ chargeRef: ref, at: seconds * 1000 })]);
        }
        assert.equal(await medianTimeToPaySeconds(db, t.id), 30);
      } finally {
        await db.close();
      }
    });
  });
}
