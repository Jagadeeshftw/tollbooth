import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MemoryEntitlementStore, definePrice } from '@tollbooth/core';
import type { Price } from '@tollbooth/core';

import { MooveClient } from '../src/client.js';
import type { MoovePaymentLink, MoovePaymentLinkStatus } from '../src/client.js';
import {
  MIN_POLL_INTERVAL_MS,
  POLL_JITTER,
  POLL_SCHEDULE_MS,
  isTerminalStatus,
  nextPollDelayMs,
  shouldPoll,
} from '../src/poller.js';
import { NONCE_PREFIX, MooveProvider } from '../src/provider.js';
import { AdaptiveRateLimiter } from '../src/ratelimit.js';

const PACK: Price = definePrice({
  sku: 'search',
  unit: 'credit_pack',
  amount: '10.00',
  credits: 250,
  label: 'Search — 250 credits',
});

/** A stand-in Moove that records creates and serves a settable link status. */
function stubMoove() {
  const state = {
    status: 'active' as MoovePaymentLinkStatus,
    receivedAmount: null as string | null,
    creates: [] as Record<string, unknown>[],
    reads: 0,
  };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === 'POST') {
      state.creates.push(JSON.parse(String(init.body)));
      return json({ id: 'pl_1', url: 'https://www.moove.xyz/pay/pl_1' });
    }
    if (/\/v1\/payment-link\/[^?]+$/.test(u)) {
      state.reads++;
      return json({
        id: 'pl_1',
        userId: 'u_1',
        toAmount: PACK.amount,
        destinationAddress: '0xabc',
        url: 'https://www.moove.xyz/pay/pl_1',
        dateCreated: new Date(0).toISOString(),
        token: {},
        status: state.status,
        description: 'tb_x',
        maxUsage: 1,
        receivedAmount: state.receivedAmount,
      } satisfies Partial<MoovePaymentLink>);
    }
    return json({ data: [], limit: 10, offset: 0, nextOffset: null });
  }) as unknown as typeof globalThis.fetch;

  const client = new MooveClient({
    apiKey: 'mk_live_test',
    fetch: fetchImpl,
    sleep: async () => {},
    keyedLimiter: new AdaptiveRateLimiter({ initialRatePerSecond: 1e6 }),
    publicLimiter: new AdaptiveRateLimiter({ initialRatePerSecond: 1e6 }),
  });
  return { state, client };
}

function json(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function setup(now = () => 1_000_000) {
  const { state, client } = stubMoove();
  const store = new MemoryEntitlementStore();
  const provider = new MooveProvider({ client, store, prices: [PACK], now });
  return { state, store, provider };
}

describe('openCharge', () => {
  it('always creates a single-use link with a short expiry and the nonce in description', async () => {
    const { state, provider } = setup();
    const { charge, checkoutUrl } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });

    const body = state.creates[0]!;
    assert.equal(body['toAmount'], '10.00', 'amount travels as a decimal string');
    assert.equal(body['maxUsage'], 1, 'one link per charge, never shared between buyers');
    assert.equal(
      body['description'],
      `${NONCE_PREFIX}${charge.nonce}`,
      'the nonce is the only thing binding a settled payment back to this charge'
    );

    // No deactivation endpoint exists, so expiry is the only containment.
    assert.ok(typeof body['expirationDate'] === 'string');
    const expiry = Date.parse(body['expirationDate'] as string);
    assert.ok(expiry > 1_000_000, 'expiry must be in the future');
    assert.ok(expiry - 1_000_000 <= 15 * 60 * 1000, 'default expiry stays short');

    assert.equal(checkoutUrl, 'https://www.moove.xyz/pay/pl_1');
    assert.equal(charge.status, 'pending');
  });

  it('mints a distinct unguessable nonce per charge', async () => {
    const { provider } = setup();
    const nonces = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { charge } = await provider.openCharge({ sku: 'search', subject: 's' });
      nonces.add(charge.nonce);
      assert.ok(charge.nonce.length >= 20, 'a nonce must not be guessable');
    }
    assert.equal(nonces.size, 25);
  });

  it('refuses a sku it does not sell', async () => {
    const { provider } = setup();
    await assert.rejects(
      () => provider.openCharge({ sku: 'not-for-sale', subject: 's' }),
      /no price registered/
    );
  });
});

describe('settleCharge', () => {
  it('stays pending while the link is unpaid', async () => {
    const { provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    const outcome = await provider.settleCharge(charge.nonce);
    assert.equal(outcome.status, 'pending');
  });

  it('grants the entitlement once the link completes', async () => {
    const { state, store, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });

    state.status = 'completed';
    state.receivedAmount = '10.00';

    const outcome = await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(outcome.status, 'granted');

    const consumed = await store.consume('tb_s_1', 'search');
    assert.equal(consumed.ok, true);
    assert.equal((consumed as { remaining: number }).remaining, 249);
  });

  it('grants exactly once when the retry path and the reconciler collide', async () => {
    const { state, store, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '10.00';

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => provider.settleCharge(charge.nonce, { force: true }))
    );

    const granted = outcomes.filter((o) => o.status === 'granted');
    assert.equal(granted.length, 1, 'only one observer may grant credit for one payment');
    assert.ok(
      outcomes.every((o) => o.status === 'granted' || o.status === 'already_granted'),
      'every other observer must see already_granted'
    );

    const entitlements = await store.listEntitlements('tb_s_1');
    assert.equal(entitlements.length, 1, 'one payment must not produce two entitlements');
    assert.equal(entitlements[0]?.remaining, 250);
  });

  it('refuses to grant on a short settlement, and keeps surfacing it', async () => {
    // Moove's fee schedule says a payment link delivers the full amount, so
    // this should never fire. Checked anyway; granting paid capability on an
    // unverified number is not a saving worth making.
    const { state, store, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '9.98';

    const outcome = await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(outcome.status, 'underpaid');
    assert.equal((outcome as { expected: string }).expected, '10.00');
    assert.equal((outcome as { received: string }).received, '9.98');

    assert.equal((await store.listEntitlements('tb_s_1')).length, 0, 'nothing may be granted');
    const stored = await store.getCharge(charge.nonce);
    assert.equal(stored?.status, 'pending', 'it stays pending so reconciliation raises it again');
  });

  it('grants when more than asked arrives', async () => {
    const { state, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '10.01';
    assert.equal((await provider.settleCharge(charge.nonce, { force: true })).status, 'granted');
  });

  it('treats an inactive link as expired', async () => {
    const { state, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'inactive';
    const outcome = await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(outcome.status, 'expired');
  });

  it('abandons a charge past its expiry without calling the API', async () => {
    let now = 1_000_000;
    const { state, provider } = setup(() => now);
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    const readsBefore = state.reads;

    now += 16 * 60 * 1000;
    const outcome = await provider.settleCharge(charge.nonce);
    assert.equal(outcome.status, 'expired');
    assert.equal(state.reads, readsBefore, 'an expired charge must not cost an API call');
  });

  it('never re-polls a settled charge', async () => {
    const { state, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '10.00';
    await provider.settleCharge(charge.nonce, { force: true });

    const readsAfterSettle = state.reads;
    await provider.settleCharge(charge.nonce, { force: true });
    await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(state.reads, readsAfterSettle, 'terminal state is cached, not re-fetched');
  });

  it('honours the minimum poll interval however hard the agent retries', async () => {
    let now = 1_000_000;
    const { state, provider } = setup(() => now);
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });

    await provider.settleCharge(charge.nonce);
    const afterFirst = state.reads;
    for (let i = 0; i < 10; i++) await provider.settleCharge(charge.nonce);
    assert.equal(state.reads, afterFirst, 'a retry loop must not become a poll loop');

    now += MIN_POLL_INTERVAL_MS;
    await provider.settleCharge(charge.nonce);
    assert.equal(state.reads, afterFirst + 1, 'polling resumes once the floor has passed');
  });
});

describe('poll schedule', () => {
  it('follows 3s, 6s, 12s, 24s, 48s then 60s', () => {
    const noJitter = () => 0.5;
    const seen = [0, 1, 2, 3, 4, 5, 6, 12].map((n) => nextPollDelayMs(n, noJitter));
    assert.deepEqual(seen.slice(0, 6), [3000, 6000, 12000, 24000, 48000, 60000]);
    assert.equal(seen[6], 60000, 'the last interval repeats');
    assert.equal(seen[7], 60000);
  });

  it('jitters within +/-30% so pending charges do not synchronise', () => {
    for (const [i, base] of POLL_SCHEDULE_MS.entries()) {
      for (const r of [0, 0.25, 0.5, 0.75, 1]) {
        const d = nextPollDelayMs(i, () => r);
        assert.ok(
          d >= base * (1 - POLL_JITTER) - 1 && d <= base * (1 + POLL_JITTER) + 1,
          `delay ${d} outside jitter band for base ${base}`
        );
      }
    }
    const spread = new Set(Array.from({ length: 50 }, () => nextPollDelayMs(0)));
    assert.ok(spread.size > 5, 'jitter must actually vary');
  });

  it('knows which statuses are final', () => {
    assert.equal(isTerminalStatus('completed'), true);
    assert.equal(isTerminalStatus('inactive'), true);
    assert.equal(isTerminalStatus('active'), false);
  });

  it('shouldPoll respects the floor, and force overrides it', () => {
    assert.equal(shouldPoll({ lastPolledAt: null, now: 0 }), true);
    assert.equal(shouldPoll({ lastPolledAt: 1000, now: 1500 }), false);
    assert.equal(shouldPoll({ lastPolledAt: 1000, now: 1000 + MIN_POLL_INTERVAL_MS }), true);
    assert.equal(shouldPoll({ lastPolledAt: 1000, now: 1001, force: true }), true);
  });
});

describe('reconcile', () => {
  it('sweeps expired charges and settles what it can', async () => {
    let now = 1_000_000;
    const { state, store, provider } = setup(() => now);
    const paid = await provider.openCharge({ sku: 'search', subject: 'tb_s_paid' });
    const stale = await provider.openCharge({ sku: 'search', subject: 'tb_s_stale' });

    // Let the paid one settle, and push time past the other's expiry.
    state.status = 'completed';
    state.receivedAmount = '10.00';
    await provider.settleCharge(paid.charge.nonce, { force: true });

    now += 16 * 60 * 1000;
    await provider.reconcile();

    assert.equal((await store.getCharge(stale.charge.nonce))?.status, 'abandoned');
    assert.equal((await store.getCharge(paid.charge.nonce))?.status, 'settled');
  });
});
