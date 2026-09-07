import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryEntitlementStore } from '../src/memory.js';
import type { Charge } from '../src/types.js';

function charge(over: Partial<Charge> = {}): Charge {
  return {
    id: 'tb_c_1',
    nonce: 'abc123',
    subject: 'tb_s_1',
    sku: 'search',
    amount: '10.00',
    status: 'pending',
    providerRef: 'pl_1',
    checkoutUrl: 'https://www.moove.xyz/pay/pl_1',
    createdAt: 0,
    expiresAt: 900_000,
    settledAt: null,
    receivedAmount: null,
    lastPolledAt: null,
    pollCount: 0,
    ...over,
  };
}

describe('claimSettlement exactly-once', () => {
  it('returns true to the first caller and false to every other', async () => {
    const store = new MemoryEntitlementStore();
    assert.equal(await store.claimSettlement('nonce-1'), true);
    assert.equal(await store.claimSettlement('nonce-1'), false);
    assert.equal(await store.claimSettlement('nonce-1'), false);
  });

  it('lets exactly one of many concurrent claimants through', async () => {
    // This is the demand-driven poller racing the background reconciler: both
    // observe the same settled payment, and only one may grant credits for it.
    const store = new MemoryEntitlementStore();
    const claims = await Promise.all(
      Array.from({ length: 64 }, () => store.claimSettlement('contended'))
    );
    assert.equal(claims.filter(Boolean).length, 1, 'exactly one claimant may win');
  });

  it('treats distinct nonces independently', async () => {
    const store = new MemoryEntitlementStore();
    assert.equal(await store.claimSettlement('a'), true);
    assert.equal(await store.claimSettlement('b'), true);
    assert.equal(await store.claimSettlement('a'), false);
  });
});

describe('charge bookkeeping', () => {
  it('round-trips a charge by nonce', async () => {
    const store = new MemoryEntitlementStore();
    await store.putCharge(charge());
    const got = await store.getCharge('abc123');
    assert.equal(got?.providerRef, 'pl_1');
    assert.equal(got?.status, 'pending');
  });

  it('patches only the fields given', async () => {
    const store = new MemoryEntitlementStore();
    await store.putCharge(charge());
    await store.updateCharge('abc123', {
      status: 'settled',
      settledAt: 5_000,
      receivedAmount: '10.00',
    });
    const got = await store.getCharge('abc123');
    assert.equal(got?.status, 'settled');
    assert.equal(got?.receivedAmount, '10.00');
    assert.equal(got?.sku, 'search', 'untouched fields survive a patch');
  });

  it('lists only pending charges', async () => {
    const store = new MemoryEntitlementStore();
    await store.putCharge(charge({ nonce: 'p1' }));
    await store.putCharge(charge({ nonce: 'p2' }));
    await store.putCharge(charge({ nonce: 's1', status: 'settled' }));

    const pending = await store.pendingCharges();
    assert.deepEqual(pending.map((c) => c.nonce).sort(), ['p1', 'p2']);
  });

  it('sweeps expired pending charges to abandoned', async () => {
    const store = new MemoryEntitlementStore();
    await store.putCharge(charge({ nonce: 'old', expiresAt: 1_000 }));
    await store.putCharge(charge({ nonce: 'fresh', expiresAt: 9_999_999 }));

    const swept = await store.sweepExpired(5_000);
    assert.equal(swept, 1);
    assert.equal((await store.getCharge('old'))?.status, 'abandoned');
    assert.equal((await store.getCharge('fresh'))?.status, 'pending');
  });
});
