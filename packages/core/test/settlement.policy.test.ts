import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { definePrice } from '../src/pricing.js';
import { DEFAULT_SETTLEMENT_POLICY, assertValidPolicy, decideSettlement } from '../src/settlement.js';

const PACK = definePrice({ sku: 'search', unit: 'credit_pack', amount: '100.00', credits: 1000 });
const PASS = definePrice({ sku: 'day', unit: 'time_pass', amount: '100.00', ttlMs: 86_400_000 });

const decide = (received: string | null, price = PACK, policy = undefined) =>
  decideSettlement({ expected: price.amount, received, price, ...(policy ? { policy } : {}) });

describe('settlement zone 1: at or above the asking price', () => {
  it('grants in full on an exact payment', () => {
    assert.equal(decide('100.00').kind, 'full');
  });

  it('grants in full on an overpayment', () => {
    assert.equal(decide('100.01').kind, 'full');
    assert.equal(decide('250.00').kind, 'full');
  });

  it('grants in full when the provider reports no amount', () => {
    // A completed link with no figure to check is not evidence of a shortfall.
    assert.equal(decide(null).kind, 'full');
  });
});

describe('settlement zone 2: inside the tolerance band', () => {
  it('absorbs a shortfall within 0.5%, which covers documented slippage', () => {
    // Moove documents a 0.10% market-quote tolerance; 0.5% covers it with room.
    assert.equal(decide('99.90').kind, 'full', '0.10% short');
    assert.equal(decide('99.60').kind, 'full', '0.40% short');
    assert.equal(decide('99.50').kind, 'full', 'exactly at the 0.5% edge');
  });

  it('drops out of the band just past the edge', () => {
    assert.equal(decide('99.49').kind, 'pro_rata');
  });

  it('honours a configured band', () => {
    const wide = { toleranceFraction: 0.05, minimumFraction: 0.1 };
    assert.equal(decide('96.00', PACK, wide).kind, 'full', '4% short is inside a 5% band');
    const tight = { toleranceFraction: 0.001, minimumFraction: 0.1 };
    assert.equal(decide('99.50', PACK, tight).kind, 'pro_rata', '0.5% short is outside a 0.1% band');
  });
});

describe('settlement zone 3: pro rata', () => {
  it('scales credits to what actually landed', () => {
    const d = decide('50.00');
    assert.equal(d.kind, 'pro_rata');
    assert.equal((d as { credits: number }).credits, 500, 'half the money buys half the credits');
  });

  it('floors rather than rounding in our favour', () => {
    const d = decide('33.33');
    assert.equal((d as { credits: number }).credits, 333);
  });

  it('never grants less than one credit, because there is no refund path', () => {
    const tiny = definePrice({ sku: 't', unit: 'credit_pack', amount: '100.00', credits: 5 });
    const d = decideSettlement({ expected: '100.00', received: '11.00', price: tiny });
    assert.equal(d.kind, 'pro_rata');
    assert.equal((d as { credits: number }).credits, 1, 'floor of one credit, not zero');
  });

  it('scales a time pass by duration instead of credits', () => {
    const d = decide('25.00', PASS);
    assert.equal(d.kind, 'pro_rata');
    assert.equal((d as { credits: number | null }).credits, null, 'a pass stays unlimited');
    assert.equal((d as { ttlMs: number }).ttlMs, 21_600_000, 'a quarter of a day');
  });

  it('reports the fraction actually received', () => {
    const d = decide('40.00');
    assert.ok(Math.abs((d as { receivedFraction: number }).receivedFraction - 0.4) < 1e-9);
  });
});

describe('settlement zone 4: below the floor', () => {
  it('grants nothing under 10% of the asking price', () => {
    assert.equal(decide('9.99').kind, 'reject');
    assert.equal(decide('0.01').kind, 'reject');
  });

  it('grants pro rata at exactly the floor', () => {
    assert.equal(decide('10.00').kind, 'pro_rata');
  });

  it('honours a configured floor', () => {
    const strict = { toleranceFraction: 0.005, minimumFraction: 0.5 };
    assert.equal(decide('40.00', PACK, strict).kind, 'reject');
    assert.equal(decide('60.00', PACK, strict).kind, 'pro_rata');
  });
});

describe('policy validation', () => {
  it('accepts the default', () => {
    assert.doesNotThrow(() => assertValidPolicy(DEFAULT_SETTLEMENT_POLICY));
    assert.equal(DEFAULT_SETTLEMENT_POLICY.toleranceFraction, 0.005);
    assert.equal(DEFAULT_SETTLEMENT_POLICY.minimumFraction, 0.1);
  });

  it('rejects fractions outside 0..1', () => {
    assert.throws(() => assertValidPolicy({ toleranceFraction: -0.1, minimumFraction: 0.1 }), RangeError);
    assert.throws(() => assertValidPolicy({ toleranceFraction: 1.5, minimumFraction: 0.1 }), RangeError);
  });

  it('rejects a floor that overlaps the tolerance band', () => {
    assert.throws(
      () => assertValidPolicy({ toleranceFraction: 0.5, minimumFraction: 0.8 }),
      /leave room below the tolerance band/
    );
  });
});

describe('exactness', () => {
  it('uses no floating point in the decision itself', () => {
    // 0.1 + 0.2 !== 0.3 territory: these must not drift.
    const p = definePrice({ sku: 'x', unit: 'credit_pack', amount: '0.30', credits: 3, allowBelowMinimum: true });
    const d = decideSettlement({ expected: '0.30', received: '0.10', price: p });
    assert.equal(d.kind, 'pro_rata');
    assert.equal((d as { credits: number }).credits, 1);
  });

  it('handles differing decimal scales', () => {
    const p = definePrice({ sku: 'x', unit: 'credit_pack', amount: '10', credits: 100, allowBelowMinimum: true });
    const d = decideSettlement({ expected: '10', received: '5.000000', price: p });
    assert.equal((d as { credits: number }).credits, 50);
  });
});
