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
import {
  DEFAULT_CHARGE_TTL_MS,
  MAX_DESCRIPTION_LENGTH,
  MIN_CHARGE_TTL_MS,
  MooveProvider,
  NONCE_PREFIX,
  buildChargeDescription,
} from '../src/provider.js';
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
    const description = body['description'] as string;
    assert.ok(
      description.startsWith(`${NONCE_PREFIX}${charge.nonce}`),
      'the nonce leads, because it is the only thing binding a payment to this charge'
    );
    assert.ok(description.includes('search'), 'the sku rides along for dashboard reconciliation');
    assert.ok(description.length <= MAX_DESCRIPTION_LENGTH);

    // No deactivation endpoint exists, so expiry is the only containment.
    assert.ok(typeof body['expirationDate'] === 'string');
    const expiry = Date.parse(body['expirationDate'] as string);
    assert.ok(expiry > 1_000_000, 'expiry must be in the future');
    assert.equal(
      expiry - 1_000_000,
      DEFAULT_CHARGE_TTL_MS,
      'an hour by default: a payer may need to bridge from another chain first'
    );

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

  it('absorbs a shortfall inside the tolerance band and grants in full', async () => {
    const { state, store, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '9.99'; // 0.1% short, inside the 0.5% band

    const outcome = await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(outcome.status, 'granted');
    assert.equal((await store.listEntitlements('tb_s_1'))[0]?.remaining, 250);
  });

  it('grants pro rata below the band, and closes the charge', async () => {
    // There is no refund path, so a payer who sent real money must not end up
    // holding nothing.
    const { state, store, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '5.00'; // half

    const outcome = await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(outcome.status, 'partial');
    assert.equal((outcome as { credits: number }).credits, 125);
    assert.equal((outcome as { received: string }).received, '5.00');

    assert.equal((await store.listEntitlements('tb_s_1'))[0]?.remaining, 125);
    assert.equal(
      (await store.getCharge(charge.nonce))?.status,
      'settled',
      'a pro-rata settlement closes the charge rather than leaving it open forever'
    );
  });

  it('grants nothing below the floor and keeps the charge pending', async () => {
    const { state, store, provider } = setup();
    const { charge } = await provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    state.status = 'completed';
    state.receivedAmount = '0.50'; // 5%, under the 10% floor

    const outcome = await provider.settleCharge(charge.nonce, { force: true });
    assert.equal(outcome.status, 'underpaid');
    assert.equal((outcome as { expected: string }).expected, '10.00');
    assert.equal((await store.listEntitlements('tb_s_1')).length, 0);
    assert.equal(
      (await store.getCharge(charge.nonce))?.status,
      'pending',
      'it stays pending so reconciliation keeps raising it for the tenant'
    );
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

    now += DEFAULT_CHARGE_TTL_MS + 60_000;
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

    now += DEFAULT_CHARGE_TTL_MS + 60_000;
    await provider.reconcile();

    assert.equal((await store.getCharge(stale.charge.nonce))?.status, 'abandoned');
    assert.equal((await store.getCharge(paid.charge.nonce))?.status, 'settled');
  });
});

describe('charge description', () => {
  it('leads with the nonce and adds what a human needs to reconcile', () => {
    const d = buildChargeDescription({
      nonce: 'abc123',
      sku: 'search',
      toolName: 'lookup_market_data',
      label: 'Search — 250 credits',
    });
    assert.ok(d.startsWith('tb_abc123'));
    assert.ok(d.includes('search'));
    assert.ok(d.includes('lookup_market_data'));
    assert.ok(d.includes('250 credits'));
  });

  it('never truncates the nonce, however long the rest is', () => {
    const d = buildChargeDescription({
      nonce: 'n'.repeat(40),
      sku: 'x'.repeat(300),
      toolName: 'y'.repeat(300),
      label: 'z'.repeat(300),
    });
    assert.ok(d.length <= MAX_DESCRIPTION_LENGTH, `length was ${d.length}`);
    assert.ok(d.startsWith(`tb_${'n'.repeat(40)}`), 'the nonce survives intact');
    assert.ok(d.endsWith('…'), 'the tail is visibly cut');
  });

  it('respects a custom limit', () => {
    const d = buildChargeDescription({ nonce: 'abc', sku: 'a'.repeat(80), maxLength: 40 });
    assert.ok(d.length <= 40);
    assert.ok(d.startsWith('tb_abc'));
  });

  it('drops duplicated parts rather than repeating them', () => {
    const d = buildChargeDescription({ nonce: 'abc', sku: 'search', label: 'Search' });
    assert.equal(d.match(/search/gi)?.length, 1);
  });

  it('degrades to the bare nonce when there is nothing else', () => {
    assert.equal(buildChargeDescription({ nonce: 'abc', sku: '' }), 'tb_abc');
  });
});

describe('charge expiry configuration', () => {
  it('defaults to an hour', () => {
    assert.equal(DEFAULT_CHARGE_TTL_MS, 60 * 60 * 1000);
  });

  it('accepts a longer window', async () => {
    const { state, client } = stubMoove();
    const provider = new MooveProvider({
      client,
      store: new MemoryEntitlementStore(),
      prices: [PACK],
      chargeTtlMs: 6 * 60 * 60 * 1000,
      now: () => 0,
    });
    await provider.openCharge({ sku: 'search', subject: 's' });
    assert.equal(Date.parse(state.creates[0]!['expirationDate'] as string), 6 * 60 * 60 * 1000);
  });

  it('refuses a window too short for a payer bridging from another chain', () => {
    const { client } = stubMoove();
    assert.throws(
      () =>
        new MooveProvider({
          client,
          store: new MemoryEntitlementStore(),
          prices: [PACK],
          chargeTtlMs: 5 * 60 * 1000,
        }),
      /at least 900000ms \(15 minutes\)/
    );
    assert.equal(MIN_CHARGE_TTL_MS, 15 * 60 * 1000);
  });
});

describe('subject handles', () => {
  it('issues a server-minted handle and persists its sliding window', async () => {
    let now = 1_000_000;
    const { client } = stubMoove();
    const store = new MemoryEntitlementStore();
    const provider = new MooveProvider({ client, store, prices: [PACK], now: () => now });

    const record = await provider.issueSubject();
    assert.match(record.subject, /^tb_s_/);
    assert.equal(record.expiresAt, now + 30 * 24 * 60 * 60 * 1000);

    now += 10 * 24 * 60 * 60 * 1000;
    await provider.touchSubject(record.subject);
    const slid = await store.getSubject(record.subject);
    assert.equal(slid?.expiresAt, now + 30 * 24 * 60 * 60 * 1000, 'use slides the window forward');
  });

  it('never reuses the Moove link id as a handle', async () => {
    const { provider } = setup();
    const record = await provider.issueSubject();
    const { charge } = await provider.openCharge({ sku: 'search', subject: record.subject });
    assert.notEqual(record.subject, charge.providerRef);
    assert.notEqual(charge.nonce, charge.providerRef);
    assert.ok(!record.subject.includes(String(charge.providerRef)));
  });
});
