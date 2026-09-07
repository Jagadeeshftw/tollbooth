import assert from 'node:assert/strict';
import { setImmediate as yieldTick } from 'node:timers/promises';
import { describe, it } from 'node:test';

import { MemoryEntitlementStore } from '../src/memory.js';
import { definePrice, entitlementFromPrice } from '../src/pricing.js';
import type { Entitlement } from '../src/types.js';

const SUBJECT = 'tb_s_test';

function entitlement(over: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'tb_e_1',
    subject: SUBJECT,
    sku: 'search',
    remaining: 1,
    expiresAt: null,
    chargeId: 'tb_c_1',
    createdAt: 0,
    version: 0,
    ...over,
  };
}

/**
 * A barrier that releases once `parties` callers have arrived. Used to force
 * every racer to finish *reading* before any of them writes — the interleaving
 * a read-then-write implementation loses to, and which a single-threaded event
 * loop would otherwise hide.
 */
function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let tripped = false;
  return async () => {
    if (tripped) return;
    if (++arrived >= parties) {
      tripped = true;
      release();
      return;
    }
    await open;
  };
}

describe('consume atomicity', () => {
  it('two simultaneous calls cannot spend the same single credit', async () => {
    const store = new MemoryEntitlementStore({ _beforeSwap: barrier(2) });
    await store.grant(entitlement({ remaining: 1 }));

    // Both read while remaining === 1, then both attempt to swap.
    const [a, b] = await Promise.all([
      store.consume(SUBJECT, 'search'),
      store.consume(SUBJECT, 'search'),
    ]);

    const wins = [a, b].filter((r) => r.ok);
    assert.equal(wins.length, 1, 'exactly one consume may succeed');

    const loser = [a, b].find((r) => !r.ok);
    assert.equal(loser?.ok, false);
    assert.equal(
      (loser as { reason: string }).reason,
      'insufficient_credits',
      'the loser must be told it has no credit, not silently succeed'
    );

    const [left] = await store.listEntitlements(SUBJECT);
    assert.equal(left?.remaining, 0);
  });

  it('N concurrent calls against M credits grant exactly M', async () => {
    const RACERS = 50;
    const CREDITS = 10;
    // Yield on every swap so the racers genuinely interleave.
    const store = new MemoryEntitlementStore({ _beforeSwap: () => yieldTick() });
    await store.grant(entitlement({ remaining: CREDITS }));

    const results = await Promise.all(
      Array.from({ length: RACERS }, () => store.consume(SUBJECT, 'search'))
    );

    const granted = results.filter((r) => r.ok).length;
    assert.equal(granted, CREDITS, `expected exactly ${CREDITS} successes, got ${granted}`);

    const [left] = await store.listEntitlements(SUBJECT);
    assert.equal(left?.remaining, 0, 'balance must land exactly on zero, never negative');
    assert.equal(left?.version, CREDITS, 'every successful spend bumps the version once');
  });

  it('cost > 1 is all-or-nothing', async () => {
    const store = new MemoryEntitlementStore();
    await store.grant(entitlement({ remaining: 3 }));

    const tooBig = await store.consume(SUBJECT, 'search', 5);
    assert.equal(tooBig.ok, false);
    assert.equal((tooBig as { reason: string }).reason, 'insufficient_credits');

    const [untouched] = await store.listEntitlements(SUBJECT);
    assert.equal(untouched?.remaining, 3, 'a rejected consume must not partially spend');

    const fits = await store.consume(SUBJECT, 'search', 3);
    assert.equal(fits.ok, true);
    assert.equal((fits as { remaining: number }).remaining, 0);
  });
});

describe('the concurrency harness itself', () => {
  /**
   * Negative control. A concurrency test is worthless unless it fails against
   * the bug it claims to catch, so this asserts that the same barrier makes a
   * naive read-then-write store double-spend. If this ever stops double-spending,
   * the barrier has stopped forcing an interleaving and the tests above have
   * quietly become decorative.
   */
  it('makes a naive read-then-write store double-spend', async () => {
    const trip = barrier(2);
    let remaining = 1;

    const naiveConsume = async (): Promise<boolean> => {
      const snapshot = remaining; // read
      await trip(); // yield, exactly where MemoryEntitlementStore swaps
      if (snapshot < 1) return false;
      remaining = snapshot - 1; // write, ignoring what happened in between
      return true;
    };

    const [a, b] = await Promise.all([naiveConsume(), naiveConsume()]);
    assert.equal(
      [a, b].filter(Boolean).length,
      2,
      'the naive store must double-spend here, or the harness proves nothing'
    );
  });
});

describe('consume across the three pricing units', () => {
  it('per_call spends its single credit and then refuses', async () => {
    const store = new MemoryEntitlementStore();
    const price = definePrice({ sku: 'once', unit: 'per_call', amount: '0.05' });
    await store.grant(
      entitlementFromPrice({
        price,
        subject: SUBJECT,
        chargeId: 'c',
        entitlementId: 'e',
        now: 1000,
      })
    );

    assert.equal((await store.consume(SUBJECT, 'once')).ok, true);
    const second = await store.consume(SUBJECT, 'once');
    assert.equal(second.ok, false);
    assert.equal((second as { reason: string }).reason, 'insufficient_credits');
  });

  it('time_pass is unlimited until it expires, then refuses', async () => {
    let now = 1000;
    const store = new MemoryEntitlementStore({ now: () => now });
    const price = definePrice({
      sku: 'day',
      unit: 'time_pass',
      amount: '10.00',
      ttlMs: 60_000,
    });
    await store.grant(
      entitlementFromPrice({ price, subject: SUBJECT, chargeId: 'c', entitlementId: 'e', now })
    );

    for (let i = 0; i < 25; i++) {
      const r = await store.consume(SUBJECT, 'day');
      assert.equal(r.ok, true, `call ${i} should be free under a pass`);
      assert.equal((r as { remaining: number | null }).remaining, null, 'a pass stays unlimited');
    }

    now = 1000 + 60_000; // exactly at expiry
    const lapsed = await store.consume(SUBJECT, 'day');
    assert.equal(lapsed.ok, false);
    assert.equal((lapsed as { reason: string }).reason, 'expired');
  });

  it('a valid pass is spent before a credit pack, so credits are not wasted', async () => {
    const store = new MemoryEntitlementStore({ now: () => 1000 });
    await store.grant(
      entitlement({ id: 'pack', sku: 'search', remaining: 5, expiresAt: null })
    );
    await store.grant(
      entitlement({ id: 'pass', sku: 'search', remaining: null, expiresAt: 50_000 })
    );

    await store.consume(SUBJECT, 'search');

    const all = await store.listEntitlements(SUBJECT);
    const pack = all.find((e) => e.id === 'pack');
    assert.equal(pack?.remaining, 5, 'the credit pack must be left alone while a pass is valid');
  });

  it('reports expired rather than insufficient when everything has lapsed', async () => {
    const store = new MemoryEntitlementStore({ now: () => 10_000 });
    await store.grant(entitlement({ remaining: 5, expiresAt: 1_000 }));

    const r = await store.consume(SUBJECT, 'search');
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'expired');
  });

  it('reports no_entitlement when nothing was ever bought', async () => {
    const store = new MemoryEntitlementStore();
    const r = await store.consume(SUBJECT, 'never-bought');
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'no_entitlement');
  });
});
