import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryEntitlementStore } from '@tollbooth/core';
import type { Charge, Price } from '@tollbooth/core';
import { eventsForCharge, projectChargeOpened, projectSettlement } from '@tollbooth/gateway-client';

import { overviewSummary } from '../src/queries.js';
import { ingestBatch } from '../src/ingest.js';
import { upsertTenantForGithubUser } from '../src/tenants.js';
import { CONNECTION_STRING, freshDatabase } from './helpers.js';

/**
 * `@tollbooth/core` is a devDependency of this package purely for this test:
 * `MemoryEntitlementStore` is the cheapest real, correct `ChargeFeedStore` to
 * build realistic charges against, exercising the actual `chargeFeed` query
 * contract rather than hand-rolling fixtures shaped like one. Nothing in
 * `src/` imports it — `scripts/check-boundaries.mjs` only looks there and at
 * `dependencies`, and this package's runtime code still knows nothing about
 * entitlement stores, live or in memory.
 */

if (!CONNECTION_STRING) {
  describe('backfill: exact revenue reconciliation', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  const PRICE: Price = {
    sku: 'search',
    unit: 'credit_pack',
    amount: '10.00',
    currency: 'USDC',
    credits: 250,
    ttlMs: null,
    label: 'Search — 250 credits',
  };

  /** A fully settled (granted-in-full) charge, built the way `moove`'s `#grant` leaves one. */
  function settledCharge(over: Partial<Charge> & { nonce: string; createdAt: number; settledAt: number }): Charge {
    return {
      id: `tb_c_${over.nonce}`,
      subject: 'tb_s_backfill_test',
      sku: PRICE.sku,
      amount: PRICE.amount,
      price: PRICE,
      tool: 'lookup_market_data',
      status: 'settled',
      providerRef: `pl_${over.nonce}`,
      checkoutUrl: `https://www.moove.xyz/pay/pl_${over.nonce}`,
      expiresAt: over.createdAt + 3_600_000,
      receivedAmount: PRICE.amount,
      lastPolledAt: over.settledAt,
      pollCount: 1,
      ...over,
    };
  }

  describe('backfill: exact revenue reconciliation', () => {
    it('fills a genuine gap exactly, and treats a charge already delivered live as a safe no-op — never double-counted', async () => {
      const db = await freshDatabase();
      try {
        const tenant = await upsertTenantForGithubUser(db, {
          id: 501,
          login: 'backfill-tenant',
          name: null,
          avatarUrl: null,
        });

        const store = new MemoryEntitlementStore({ acknowledgeEphemeral: true });

        // Two charges, both created and settled inside what will become the
        // backfill window — the gap. One of them (DELIVERED) is ingested
        // live, through the real `project*` functions, exactly as
        // `GatewayClient` would have sent it at the time. The other
        // (MISSED) never was: an outage, a dropped queue, anything — that
        // absence is the entire premise of "a gap".
        const delivered = settledCharge({ nonce: 'delivered-1', createdAt: 10_000, settledAt: 10_500 });
        const missed = settledCharge({ nonce: 'missed-1', createdAt: 20_000, settledAt: 20_500 });
        await store.putCharge(delivered);
        await store.putCharge(missed);

        // Simulate the live delivery of `delivered` — through the real wire
        // projection functions a running server would actually call, not a
        // hand-built stand-in — landing before any backfill ever runs.
        const liveOpened = projectChargeOpened({
          tool: delivered.tool!,
          sku: delivered.sku,
          nonce: 'delivered-1',
          amount: delivered.amount,
          currency: delivered.price!.currency,
          at: delivered.createdAt,
        });
        const liveSettled = projectSettlement(
          { status: 'granted', charge: delivered, entitlementId: 'tb_e_live' },
          delivered.settledAt!
        )!;
        const liveResult = await ingestBatch(db, tenant.id, [liveOpened, liveSettled]);
        assert.deepEqual(liveResult, { accepted: 2, duplicate: 0 }, 'the live delivery itself must land cleanly');

        const before = await overviewSummary(db, tenant.id, 3650, 100_000);
        assert.equal(before.revenueAmount, '10.000000', 'only the live-delivered charge has landed so far');

        // Now the backfill: read the store's own charge feed for a window
        // that covers BOTH charges — the overlap the gap-overlap case
        // demands — and reconstruct wire events from durable storage alone,
        // the same way an operator running this after an outage would.
        const feed = await store.chargeFeed(0, 30_000);
        assert.equal(feed.length, 2, 'the feed must see both charges — the whole point of scanning by window, not by delivery status');

        const backfillEvents = feed.flatMap((c) => eventsForCharge(c));
        assert.equal(backfillEvents.length, 4, 'two events per charge: charge_opened and settlement');

        // The critical assertion: `delivered`'s reconstructed ids must be
        // byte-identical to what the live path actually sent — not merely
        // internally consistent with themselves. If they diverged, ingest's
        // dedup would never catch them, and this whole test would prove
        // nothing.
        const deliveredReconstructed = eventsForCharge(delivered);
        assert.equal(deliveredReconstructed[0]!.eventId, liveOpened.eventId, 'reconstructed charge_opened id must match the live one');
        assert.equal(deliveredReconstructed[1]!.eventId, liveSettled.eventId, 'reconstructed settlement id must match the live one');

        const backfillResult = await ingestBatch(db, tenant.id, backfillEvents);
        assert.deepEqual(
          backfillResult,
          { accepted: 2, duplicate: 2 },
          '`missed`\'s two events are genuinely new; `delivered`\'s two are recognised as duplicates, not reprocessed'
        );

        // Exact, not approximate: two charges' worth of revenue, not three.
        const after = await overviewSummary(db, tenant.id, 3650, 100_000);
        assert.equal(after.revenueAmount, '20.000000', 'delivered ($10) + missed ($10) — exactly once each, not $30');
        assert.equal(after.chargesOpened, 2, 'charges_opened must not have doubled for the already-delivered charge');
        assert.equal(after.chargesConverted, 2);

        // Running the exact same backfill again — an operator re-running it,
        // or a second, overlapping backfill window — must still be a no-op.
        const rerun = await ingestBatch(db, tenant.id, eventsForCharge(delivered).concat(eventsForCharge(missed)));
        assert.deepEqual(rerun, { accepted: 0, duplicate: 4 });
        const stillAfter = await overviewSummary(db, tenant.id, 3650, 100_000);
        assert.equal(stillAfter.revenueAmount, '20.000000', 'idempotent under repetition, not just under a single overlap');
      } finally {
        await db.close();
      }
    });

    it('reconstructs an underpaid observation, still pending, without inventing a settlement it does not have', async () => {
      const db = await freshDatabase();
      try {
        const tenant = await upsertTenantForGithubUser(db, {
          id: 502,
          login: 'backfill-underpaid-tenant',
          name: null,
          avatarUrl: null,
        });
        const store = new MemoryEntitlementStore({ acknowledgeEphemeral: true });

        const charge = settledCharge({
          nonce: 'underpaid-1',
          createdAt: 10_000,
          settledAt: 0, // unused for this case
        });
        // Underpaid, per moove's own `#grant`: stays pending, receivedAmount set.
        const underpaidCharge: Charge = { ...charge, status: 'pending', settledAt: null, receivedAmount: '0.50', lastPolledAt: 15_000 };
        await store.putCharge(underpaidCharge);

        const feed = await store.chargeFeed(0, 20_000);
        const events = feed.flatMap((c) => eventsForCharge(c));
        // charge_opened, plus one underpaid settlement observation — no
        // "granted" ever invented for a charge that never actually settled.
        assert.equal(events.length, 2);
        assert.equal(events.find((e) => e.kind === 'settlement')?.status, 'underpaid');

        const result = await ingestBatch(db, tenant.id, events);
        assert.deepEqual(result, { accepted: 2, duplicate: 0 });

        const summary = await overviewSummary(db, tenant.id, 3650, 100_000);
        assert.equal(summary.revenueAmount, '0.000000', 'underpaid grants no revenue');
        assert.equal(summary.chargesConverted, 0, 'underpaid does not count as converted');
      } finally {
        await db.close();
      }
    });
  });
}
