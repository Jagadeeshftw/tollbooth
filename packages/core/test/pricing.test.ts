import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareDecimal, decimalGte, parseDecimal, toFixedScale } from '../src/decimal.js';
import {
  MIN_CREDIT_PACK_AMOUNT,
  definePrice,
  entitlementFromPrice,
  isUsable,
} from '../src/pricing.js';

describe('the three units collapse to one record', () => {
  it('per_call is remaining 1, no expiry', () => {
    const p = definePrice({ sku: 'x', unit: 'per_call', amount: '0.05' });
    const e = entitlementFromPrice({
      price: p,
      subject: 's',
      chargeId: 'c',
      entitlementId: 'e',
      now: 1000,
    });
    assert.equal(e.remaining, 1);
    assert.equal(e.expiresAt, null);
  });

  it('credit_pack is remaining N, no expiry by default', () => {
    const p = definePrice({ sku: 'x', unit: 'credit_pack', amount: '10.00', credits: 250 });
    const e = entitlementFromPrice({
      price: p,
      subject: 's',
      chargeId: 'c',
      entitlementId: 'e',
      now: 1000,
    });
    assert.equal(e.remaining, 250);
    assert.equal(e.expiresAt, null);
  });

  it('time_pass is unlimited with an expiry', () => {
    const p = definePrice({ sku: 'x', unit: 'time_pass', amount: '20.00', ttlMs: 86_400_000 });
    const e = entitlementFromPrice({
      price: p,
      subject: 's',
      chargeId: 'c',
      entitlementId: 'e',
      now: 1000,
    });
    assert.equal(e.remaining, null);
    assert.equal(e.expiresAt, 1000 + 86_400_000);
  });
});

describe('definePrice validation', () => {
  it('rejects a credit pack below the minimum, and names the escape hatch', () => {
    assert.throws(
      () => definePrice({ sku: 'x', unit: 'credit_pack', amount: '1.00', credits: 10 }),
      /below the 5\.00 minimum[\s\S]*allowBelowMinimum/
    );
  });

  it('allows a sub-minimum pack when explicitly acknowledged', () => {
    const p = definePrice({
      sku: 'x',
      unit: 'credit_pack',
      amount: '1.00',
      credits: 10,
      allowBelowMinimum: true,
    });
    assert.equal(p.amount, '1.00');
  });

  it('accepts a pack exactly at the minimum', () => {
    const p = definePrice({
      sku: 'x',
      unit: 'credit_pack',
      amount: MIN_CREDIT_PACK_AMOUNT,
      credits: 100,
    });
    assert.equal(p.credits, 100);
  });

  it('rejects a credit pack with no credit count', () => {
    assert.throws(
      () => definePrice({ sku: 'x', unit: 'credit_pack', amount: '10.00' }),
      /requires an integer credits/
    );
  });

  it('rejects a time pass without a ttl', () => {
    assert.throws(
      () => definePrice({ sku: 'x', unit: 'time_pass', amount: '10.00' }),
      /requires a positive ttlMs/
    );
  });

  it('rejects a time pass that also grants credits', () => {
    assert.throws(
      () =>
        definePrice({ sku: 'x', unit: 'time_pass', amount: '10.00', ttlMs: 1000, credits: 5 }),
      /unlimited calls/
    );
  });

  it('rejects a per_call granting more than one credit', () => {
    assert.throws(
      () => definePrice({ sku: 'x', unit: 'per_call', amount: '1.00', credits: 3 }),
      /exactly 1 credit/
    );
  });

  it('rejects a float amount, because money is never a number', () => {
    assert.throws(
      // @ts-expect-error deliberately passing a number
      () => definePrice({ sku: 'x', unit: 'per_call', amount: 0.05 }),
      /must be strings, not numbers|positive decimal/
    );
  });

  it('rejects zero and negative prices', () => {
    assert.throws(() => definePrice({ sku: 'x', unit: 'per_call', amount: '0' }), /positive/);
    assert.throws(() => definePrice({ sku: 'x', unit: 'per_call', amount: '-1.00' }), /positive/);
  });
});

describe('isUsable', () => {
  const base = {
    id: 'e',
    subject: 's',
    sku: 'k',
    chargeId: 'c',
    createdAt: 0,
    version: 0,
  } as const;

  it('is false at the instant of expiry, not after it', () => {
    const e = { ...base, remaining: null, expiresAt: 1000 };
    assert.equal(isUsable(e, 999), true);
    assert.equal(isUsable(e, 1000), false);
  });

  it('respects cost when checking a balance', () => {
    const e = { ...base, remaining: 2, expiresAt: null };
    assert.equal(isUsable(e, 0, 2), true);
    assert.equal(isUsable(e, 0, 3), false);
  });
});

describe('decimal money', () => {
  it('compares without floating point error', () => {
    assert.equal(compareDecimal('0.1', '0.10'), 0);
    assert.equal(compareDecimal('10.00', '9.999999'), 1);
    assert.equal(compareDecimal('1.0000001', '1.0000002'), -1);
  });

  it('decimalGte underpins the receivedAmount check', () => {
    assert.equal(decimalGte('10.00', '10.00'), true);
    assert.equal(decimalGte('10.000001', '10.00'), true);
    assert.equal(decimalGte('9.999999', '10.00'), false);
  });

  it('parses scale exactly', () => {
    assert.deepEqual(parseDecimal('1.50'), { units: 150n, scale: 2 });
    assert.deepEqual(parseDecimal('42'), { units: 42n, scale: 0 });
  });

  it('refuses to silently truncate precision', () => {
    assert.equal(toFixedScale('1.5', 6), '1.500000');
    assert.throws(() => toFixedScale('1.1234567', 6), /decimal places/);
  });

  it('rejects junk', () => {
    for (const bad of ['', '  ', 'abc', '1.2.3', '1e5', 'NaN', '0x10']) {
      assert.throws(() => parseDecimal(bad), /Invalid decimal/, `should reject ${bad}`);
    }
  });
});
