import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type { WireCallEvent, WireChargeOpenedEvent, WireSettlementEvent } from '@tollbooth/gateway-client';

import { ingestBatch } from '../src/ingest.js';
import { upsertTenantForGithubUser } from '../src/tenants.js';
import { CONNECTION_STRING, freshDatabase } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('ingest', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  async function tenant(db: Awaited<ReturnType<typeof freshDatabase>>) {
    return upsertTenantForGithubUser(db, { id: 1, login: 'tenant-a', name: null, avatarUrl: null });
  }

  function chargeOpened(over: Partial<WireChargeOpenedEvent> = {}): WireChargeOpenedEvent {
    return {
      kind: 'charge_opened',
      eventId: randomUUID(),
      at: 1000,
      tool: 'lookup_market_data',
      sku: 'search',
      chargeRef: 'a'.repeat(64),
      amount: '10.00',
      currency: 'USDC',
      ...over,
    };
  }

  function settlement(over: Partial<WireSettlementEvent> = {}): WireSettlementEvent {
    return {
      kind: 'settlement',
      eventId: randomUUID(),
      at: 2000,
      status: 'granted',
      sku: 'search',
      chargeRef: 'a'.repeat(64),
      amount: '10.00',
      receivedAmount: '10.00',
      receivedFraction: null,
      // Realistic default: only `granted`/`partial` ever carry a real count
      // (see projectSettlement) — tests that need one override it explicitly.
      credits: null,
      ...over,
    };
  }

  function call(over: Partial<WireCallEvent> = {}): WireCallEvent {
    return {
      kind: 'call',
      eventId: randomUUID(),
      at: 1500,
      tool: 'lookup_market_data',
      sku: 'search',
      cost: 1,
      tokenPresented: true,
      tokenFingerprint: 'tb_s_x7Q..dyA3',
      tokenRecognised: true,
      outcome: 'authorised',
      ...over,
    };
  }

  // Reads go through the database under test, tenant-scoped, not the raw
  // admin pool: row-level security is enforced for real once the connection
  // is an ordinary role (see helpers.ts), so a read with no tenant context
  // set sees nothing, exactly as an unscoped read must.
  async function chargeRow(db: Awaited<ReturnType<typeof freshDatabase>>, tenantId: string, chargeRef: string) {
    return db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query('SELECT * FROM gateway_charges WHERE tenant_id = $1 AND charge_ref = $2', [
        tenantId,
        chargeRef,
      ]);
      return rows[0];
    });
  }

  async function rollupRow(db: Awaited<ReturnType<typeof freshDatabase>>, tenantId: string, day: string, sku: string) {
    return db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM gateway_daily_rollups WHERE tenant_id = $1 AND day = $2 AND sku = $3',
        [tenantId, day, sku]
      );
      return rows[0];
    });
  }

  describe('idempotency: a retried batch cannot double-count', () => {
    it('ingesting the same event twice counts it once', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const event = chargeOpened();

        const first = await ingestBatch(db, t.id, [event]);
        assert.deepEqual(first, { accepted: 1, duplicate: 0 });

        const retry = await ingestBatch(db, t.id, [event]);
        assert.deepEqual(retry, { accepted: 0, duplicate: 1 });

        const row = await rollupRow(db, t.id, '1970-01-01', 'search');
        assert.equal(row.charges_opened, 1, 'the retry must not increment the rollup a second time');
      } finally {
        await db.close();
      }
    });

    it('a batch that mixes a fresh event with an already-seen one only counts the fresh one', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const seen = chargeOpened({ chargeRef: 'b'.repeat(64) });
        await ingestBatch(db, t.id, [seen]);

        const result = await ingestBatch(db, t.id, [seen, chargeOpened({ chargeRef: 'c'.repeat(64) })]);
        assert.deepEqual(result, { accepted: 1, duplicate: 1 });
      } finally {
        await db.close();
      }
    });
  });

  describe('reordering: a settlement can arrive before its charge_opened', () => {
    it('reconciles into one complete row regardless of arrival order', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'd'.repeat(64);

        // Settlement first — the exact scenario a retried, reordered batch produces.
        await ingestBatch(db, t.id, [settlement({ chargeRef: ref, at: 2000 })]);
        let row = await chargeRow(db, t.id, ref);
        assert.equal(row.tool, null, 'not known yet');
        assert.equal(row.status, 'granted');

        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: ref, at: 1000 })]);
        row = await chargeRow(db, t.id, ref);
        assert.equal(row.tool, 'lookup_market_data', 'filled in without disturbing the settlement fields');
        assert.equal(row.status, 'granted', 'the settlement observed first must not be lost');
        assert.equal(row.received_amount, '10.00');
      } finally {
        await db.close();
      }
    });

    it('the ordinary order — opened then settled — also reconciles into one row', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'e'.repeat(64);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: ref })]);
        await ingestBatch(db, t.id, [settlement({ chargeRef: ref })]);
        const row = await chargeRow(db, t.id, ref);
        assert.equal(row.tool, 'lookup_market_data');
        assert.equal(row.status, 'granted');
      } finally {
        await db.close();
      }
    });

    it('a later, newer settlement observation supersedes an earlier one for the same charge', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'f'.repeat(64);
        await ingestBatch(db, t.id, [
          settlement({ chargeRef: ref, status: 'underpaid', receivedAmount: '0.50', at: 1000 }),
        ]);
        await ingestBatch(db, t.id, [
          settlement({ chargeRef: ref, status: 'granted', receivedAmount: '10.00', at: 2000 }),
        ]);
        const row = await chargeRow(db, t.id, ref);
        assert.equal(row.status, 'granted', 'the newer observation must win');
        assert.equal(row.received_amount, '10.00');
      } finally {
        await db.close();
      }
    });

    it('an out-of-order-arriving OLDER settlement observation cannot clobber a newer one already stored', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'a1'.repeat(32);
        await ingestBatch(db, t.id, [
          settlement({ chargeRef: ref, status: 'granted', receivedAmount: '10.00', at: 2000 }),
        ]);
        // Arrives late (network reordering), but is chronologically the OLDER
        // observation — must not overwrite the newer one already stored.
        await ingestBatch(db, t.id, [
          settlement({ chargeRef: ref, status: 'underpaid', receivedAmount: '0.50', at: 1000 }),
        ]);
        const row = await chargeRow(db, t.id, ref);
        assert.equal(row.status, 'granted', 'a stale, late-arriving observation must not win');
        assert.equal(row.received_amount, '10.00');
      } finally {
        await db.close();
      }
    });
  });

  describe('rollups', () => {
    it('accumulates across several events for the same tenant, day and sku', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          chargeOpened({ chargeRef: '1'.repeat(64), at: 1000 }),
          chargeOpened({ chargeRef: '2'.repeat(64), at: 2000 }),
          settlement({ chargeRef: '1'.repeat(64), status: 'granted', receivedAmount: '10.00', at: 3000 }),
          settlement({ chargeRef: '2'.repeat(64), status: 'partial', receivedAmount: '5.00', at: 4000 }),
          call({ outcome: 'authorised', at: 5000 }),
          call({ outcome: 'challenged', at: 6000 }),
        ]);
        const row = await rollupRow(db, t.id, '1970-01-01', 'search');
        assert.equal(row.charges_opened, 2);
        assert.equal(row.charges_granted, 1);
        assert.equal(row.charges_partial, 1);
        assert.equal(Number(row.revenue_amount), 15);
        assert.equal(row.calls_authorised, 1);
        assert.equal(row.calls_challenged, 1);
      } finally {
        await db.close();
      }
    });

    it('does not count revenue for an underpaid or expired settlement', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          settlement({ chargeRef: '3'.repeat(64), status: 'underpaid', receivedAmount: '0.50' }),
          settlement({ chargeRef: '4'.repeat(64), status: 'expired', receivedAmount: null }),
        ]);
        const row = await rollupRow(db, t.id, '1970-01-01', 'search');
        assert.equal(Number(row.revenue_amount), 0);
        assert.equal(row.charges_underpaid, 1);
        assert.equal(row.charges_expired, 1);
      } finally {
        await db.close();
      }
    });

    it('buckets by the event day, in UTC', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const day1 = Date.UTC(2026, 0, 1, 12);
        const day2 = Date.UTC(2026, 0, 2, 12);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: '5'.repeat(64), at: day1 })]);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: '6'.repeat(64), at: day2 })]);
        assert.equal((await rollupRow(db, t.id, '2026-01-01', 'search')).charges_opened, 1);
        assert.equal((await rollupRow(db, t.id, '2026-01-02', 'search')).charges_opened, 1);
      } finally {
        await db.close();
      }
    });
  });

  describe('time to settle', () => {
    it('computes the delta in the ordinary order: opened, then settled', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'b1'.repeat(32);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: ref, at: 1_000 })]);
        await ingestBatch(db, t.id, [settlement({ chargeRef: ref, at: 46_000 })]);
        const row = await chargeRow(db, t.id, ref);
        assert.equal(Number(row.time_to_settle_ms), 45_000);
      } finally {
        await db.close();
      }
    });

    it('computes the same delta when the settlement arrives first', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'b2'.repeat(32);
        await ingestBatch(db, t.id, [settlement({ chargeRef: ref, at: 46_000 })]);
        let row = await chargeRow(db, t.id, ref);
        assert.equal(row.time_to_settle_ms, null, 'not computable until opened_at is known');
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: ref, at: 1_000 })]);
        row = await chargeRow(db, t.id, ref);
        assert.equal(Number(row.time_to_settle_ms), 45_000, 'computed the moment the missing side arrived');
      } finally {
        await db.close();
      }
    });

    it('stays null for a charge that has not settled yet', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        const ref = 'b3'.repeat(32);
        await ingestBatch(db, t.id, [chargeOpened({ chargeRef: ref })]);
        assert.equal((await chargeRow(db, t.id, ref)).time_to_settle_ms, null);
      } finally {
        await db.close();
      }
    });
  });

  describe('credits outstanding', () => {
    it('a granted settlement adds to credits_granted using the wire event\'s own count', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [settlement({ chargeRef: 'c1'.repeat(32), status: 'granted', credits: 250 })]);
        const row = await rollupRow(db, t.id, '1970-01-01', 'search');
        assert.equal(Number(row.credits_granted), 250);
        assert.equal(Number(row.credits_consumed), 0);
      } finally {
        await db.close();
      }
    });

    it('an authorised call adds to credits_consumed by its cost; a challenged call does not', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [
          call({ outcome: 'authorised', cost: 2 }),
          call({ outcome: 'challenged', cost: 1 }),
        ]);
        const row = await rollupRow(db, t.id, '1970-01-01', 'search');
        assert.equal(Number(row.credits_consumed), 2, 'only the authorised call actually spent anything');
      } finally {
        await db.close();
      }
    });

    it('a settlement with no known credits (pre-migration charge) does not touch credits_granted', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [settlement({ chargeRef: 'c2'.repeat(32), status: 'granted', credits: null })]);
        const row = await rollupRow(db, t.id, '1970-01-01', 'search');
        assert.equal(Number(row.credits_granted), 0);
      } finally {
        await db.close();
      }
    });
  });

  describe('atomicity', () => {
    it('a whole batch commits or none of it does', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        // A malformed event (missing a required field) should make the whole
        // batch fail rather than partially apply.
        const bad = { kind: 'call' } as unknown as WireCallEvent;
        await assert.rejects(() => ingestBatch(db, t.id, [chargeOpened({ chargeRef: '7'.repeat(64) }), bad]));
        assert.equal(await chargeRow(db, t.id, '7'.repeat(64)), undefined, 'the good event in the same batch must not have landed either');
      } finally {
        await db.close();
      }
    });
  });
}
