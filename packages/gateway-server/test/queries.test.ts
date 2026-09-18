import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type { WireCallEvent, WireSettlementEvent } from '@tollbooth/gateway-client';

import { ingestBatch } from '../src/ingest.js';
import type { WireChargeOpenedEvent } from '@tollbooth/gateway-client';

import {
  creditsOutstanding,
  medianTimeToPaySeconds,
  overviewSummary,
  recentActivity,
  recentUnderpaidCharges,
  reportedPricesAndTools,
  revenueByDay,
  settlementOutcomeCounts,
} from '../src/queries.js';
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

  function chargeOpened(over: Partial<WireChargeOpenedEvent> = {}): WireChargeOpenedEvent {
    return {
      kind: 'charge_opened', eventId: randomUUID(), at: 1000, tool: 'lookup_market_data', sku: 'search',
      chargeRef: randomUUID().replace(/-/g, ''), amount: '10.00', currency: 'USDC', ...over,
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

  describe('overviewSummary', () => {
    it('sums revenue and opened/converted counts within the window, and lists distinct tools', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const now = Date.now();
        await ingestBatch(db, t.id, [
          chargeOpened({ chargeRef: 'o1'.repeat(16), tool: 'fetch_readable', at: now - 1000 }),
          chargeOpened({ chargeRef: 'o2'.repeat(16), tool: 'extract_tables', at: now - 2000 }),
          settlement({ chargeRef: 'o1'.repeat(16), status: 'granted', receivedAmount: '10.00', at: now }),
          settlement({ chargeRef: 'o2'.repeat(16), status: 'partial', receivedAmount: '5.00', at: now }),
        ]);
        const summary = await overviewSummary(db, t.id, 30, now);
        assert.equal(Number(summary.revenueAmount), 15);
        assert.equal(summary.chargesOpened, 2);
        assert.equal(summary.chargesConverted, 2);
        assert.deepEqual([...summary.toolsSelling].sort(), ['extract_tables', 'fetch_readable']);
      } finally {
        await db.close();
      }
    });

    it('excludes anything outside the window', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const now = Date.now();
        const longAgo = now - 60 * 24 * 60 * 60 * 1000;
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: 'w1'.repeat(16), at: longAgo })]);
        const summary = await overviewSummary(db, t.id, 30, now);
        assert.equal(summary.chargesOpened, 0);
      } finally {
        await db.close();
      }
    });
  });

  describe('revenueByDay', () => {
    it('returns one row per day with revenue, none for a day with nothing', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const day1 = Date.UTC(2026, 0, 1, 10);
        const day3 = Date.UTC(2026, 0, 3, 10);
        await ingestBatch(db, t.id, [settlement({ chargeRef: 'r1'.repeat(16), status: 'granted', receivedAmount: '10.00', at: day1 })]);
        await ingestBatch(db, t.id, [settlement({ chargeRef: 'r2'.repeat(16), status: 'granted', receivedAmount: '20.00', at: day3 })]);
        // "now" fixed to just after day3, not the real clock, so the fixture
        // dates fall inside the 30-day window regardless of when this runs.
        const rows = await revenueByDay(db, t.id, 30, day3 + 24 * 60 * 60 * 1000);
        assert.equal(rows.length, 2, 'day 2 had nothing and is simply absent, not a zero row');
        assert.equal(rows[0]?.day, '2026-01-01');
        assert.equal(Number(rows[0]?.amount), 10);
        assert.equal(rows[1]?.day, '2026-01-03');
      } finally {
        await db.close();
      }
    });
  });

  describe('settlementOutcomeCounts', () => {
    it('counts each of the four outcomes separately, never folding partial into underpaid or either into a generic failure', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const now = Date.now();
        await ingestBatch(db, t.id, [
          settlement({ chargeRef: 's1'.repeat(16), status: 'granted', at: now }),
          settlement({ chargeRef: 's2'.repeat(16), status: 'partial', at: now }),
          settlement({ chargeRef: 's3'.repeat(16), status: 'underpaid', at: now }),
          settlement({ chargeRef: 's4'.repeat(16), status: 'expired', at: now }),
        ]);
        const counts = await settlementOutcomeCounts(db, t.id, 30, now);
        assert.deepEqual(counts, { granted: 1, partial: 1, underpaid: 1, expired: 1 });
      } finally {
        await db.close();
      }
    });
  });

  describe('recentActivity', () => {
    it('orders by whichever happened most recently, settled or just opened', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: 'a1'.repeat(16), at: 1000 })]);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: 'a2'.repeat(16), at: 2000 })]);
        await ingestBatch(db, t.id, [settlement({ chargeRef: 'a1'.repeat(16), status: 'granted', at: 5000 })]);
        const rows = await recentActivity(db, t.id, 10);
        assert.equal(rows[0]?.chargeRef, 'a1'.repeat(16), 'settled at 5000, most recent');
        assert.equal(rows[0]?.status, 'granted');
        assert.equal(rows[1]?.chargeRef, 'a2'.repeat(16), 'only opened, at 2000');
        assert.equal(rows[1]?.status, null, 'opened but never settled reads as no status, not a fabricated one');
      } finally {
        await db.close();
      }
    });

    it('respects the limit', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(
          db,
          t.id,
          Array.from({ length: 5 }, (_, i) => chargeOpened({ chargeRef: `l${i}`.repeat(16), at: i }))
        );
        const rows = await recentActivity(db, t.id, 3);
        assert.equal(rows.length, 3);
      } finally {
        await db.close();
      }
    });
  });

  describe('reportedPricesAndTools', () => {
    it('is empty for a tenant with no charges', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        assert.deepEqual(await reportedPricesAndTools(db, t.id), []);
      } finally {
        await db.close();
      }
    });

    it('reports one row per distinct (tool, sku), never one per charge', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          chargeOpened({ chargeRef: 'p1'.repeat(16), tool: 'lookup_market_data', sku: 'search', amount: '10.00', at: 1000 }),
          chargeOpened({ chargeRef: 'p2'.repeat(16), tool: 'lookup_market_data', sku: 'search', amount: '10.00', at: 2000 }),
          chargeOpened({ chargeRef: 'p3'.repeat(16), tool: 'summarise_pdf', sku: 'docs', amount: '2.50', at: 1500 }),
        ]);
        const rows = await reportedPricesAndTools(db, t.id);
        assert.deepEqual(
          rows.map((r) => `${r.tool}:${r.sku}`).sort(),
          ['lookup_market_data:search', 'summarise_pdf:docs']
        );
      } finally {
        await db.close();
      }
    });

    it('reports the most recently seen amount for a (tool, sku) pair that repriced', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          chargeOpened({ chargeRef: 'r1'.repeat(16), tool: 'lookup_market_data', sku: 'search', amount: '10.00', at: 1000 }),
          chargeOpened({ chargeRef: 'r2'.repeat(16), tool: 'lookup_market_data', sku: 'search', amount: '12.00', at: 5000 }),
        ]);
        const rows = await reportedPricesAndTools(db, t.id);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.amount, '12.00', 'the later price wins, not the earlier one');
      } finally {
        await db.close();
      }
    });
  });

  describe('recentUnderpaidCharges', () => {
    it('is empty when nothing has ever been underpaid', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          chargeOpened({ chargeRef: 'g1'.repeat(16), at: 1000 }),
          settlement({ chargeRef: 'g1'.repeat(16), status: 'granted', at: 2000 }),
        ]);
        assert.deepEqual(await recentUnderpaidCharges(db, t.id), []);
      } finally {
        await db.close();
      }
    });

    it('lists an underpaid charge, and never a granted or partial one', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          chargeOpened({ chargeRef: 'u1'.repeat(16), tool: 'lookup_market_data', sku: 'search', amount: '10.00', at: 1000 }),
          settlement({
            chargeRef: 'u1'.repeat(16),
            status: 'underpaid',
            amount: '10.00',
            receivedAmount: '0.50',
            receivedFraction: 0.05,
            at: 2000,
          }),
          chargeOpened({ chargeRef: 'g1'.repeat(16), at: 1000 }),
          settlement({ chargeRef: 'g1'.repeat(16), status: 'granted', at: 2000 }),
        ]);
        const rows = await recentUnderpaidCharges(db, t.id);
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.chargeRef, 'u1'.repeat(16));
        assert.equal(rows[0]?.receivedAmount, '0.50');
        assert.equal(rows[0]?.receivedFraction, 0.05);
      } finally {
        await db.close();
      }
    });

    it('most recent first, and respects the limit', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        for (let i = 0; i < 3; i++) {
          await ingestBatch(db, t.id, [
            chargeOpened({ chargeRef: `w${i}`.repeat(16), at: i * 1000 }),
            settlement({
              chargeRef: `w${i}`.repeat(16),
              status: 'underpaid',
              receivedAmount: '0.10',
              receivedFraction: 0.01,
              at: (i + 1) * 1000,
            }),
          ]);
        }
        const rows = await recentUnderpaidCharges(db, t.id, 2);
        assert.equal(rows.length, 2);
        assert.equal(rows[0]?.chargeRef, 'w2'.repeat(16), 'most recently settled first');
      } finally {
        await db.close();
      }
    });
  });
}
