import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { MemoryEntitlementStore, definePrice } from '@tollbooth/core';
import type { Price } from '@tollbooth/core';

import { MooveClient } from '../src/client.js';
import type { MoovePaymentLink, MoovePaymentLinkStatus } from '../src/client.js';
import { DEFAULT_CHARGE_TTL_MS, MooveProvider } from '../src/provider.js';
import {
  DEFAULT_TOLERANCE_SECONDS,
  nonceFromDescription,
  parseWebhookEvent,
  verifyWebhookSignature,
} from '../src/webhook.js';
import type { MooveWebhookEvent } from '../src/webhook.js';

const SECRET = 'whsec_test_not_a_real_secret';

const PACK: Price = definePrice({
  sku: 'search',
  unit: 'credit_pack',
  amount: '10.00',
  credits: 250,
  label: 'Search — 250 credits',
});

/** Sign exactly as Moove documents: hex HMAC-SHA256 over `{timestamp}.{body}`. */
function sign(body: string, timestamp: string, secret = SECRET): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

describe('webhook signature verification', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'payment_link.completed' });
  const now = 1_800_000_000_000;
  const timestamp = String(Math.floor(now / 1000));

  it('accepts a correctly signed, fresh delivery', () => {
    assert.equal(
      verifyWebhookSignature({
        rawBody: body,
        signature: sign(body, timestamp),
        timestamp,
        secret: SECRET,
        now: () => now,
      }),
      true
    );
  });

  it('rejects a body altered after signing', () => {
    const signature = sign(body, timestamp);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'payment_link.completed', extra: 1 });
    assert.equal(
      verifyWebhookSignature({ rawBody: tampered, signature, timestamp, secret: SECRET, now: () => now }),
      false
    );
  });

  it('rejects a signature made with a different secret', () => {
    assert.equal(
      verifyWebhookSignature({
        rawBody: body,
        signature: sign(body, timestamp, 'whsec_someone_else'),
        timestamp,
        secret: SECRET,
        now: () => now,
      }),
      false
    );
  });

  it('rejects an unsigned request outright', () => {
    assert.equal(
      verifyWebhookSignature({ rawBody: body, signature: undefined, timestamp, secret: SECRET, now: () => now }),
      false
    );
    assert.equal(
      verifyWebhookSignature({ rawBody: body, signature: '', timestamp, secret: SECRET, now: () => now }),
      false
    );
  });

  it('rejects a captured delivery replayed after the tolerance window', () => {
    const old = String(Math.floor(now / 1000) - DEFAULT_TOLERANCE_SECONDS - 1);
    // Correctly signed for its own timestamp — this is a genuine past delivery,
    // replayed. Only staleness can catch it.
    assert.equal(
      verifyWebhookSignature({ rawBody: body, signature: sign(body, old), timestamp: old, secret: SECRET, now: () => now }),
      false
    );
  });

  it('rejects a timestamp swapped for a fresh one, because it is inside the signed message', () => {
    const old = String(Math.floor(now / 1000) - 3600);
    const signature = sign(body, old);
    const fresh = String(Math.floor(now / 1000));
    assert.equal(
      verifyWebhookSignature({ rawBody: body, signature, timestamp: fresh, secret: SECRET, now: () => now }),
      false
    );
  });

  it('rejects a non-numeric timestamp without throwing', () => {
    assert.equal(
      verifyWebhookSignature({ rawBody: body, signature: sign(body, 'abc'), timestamp: 'abc', secret: SECRET, now: () => now }),
      false
    );
  });

  it('verifies the bytes, not a re-serialisation of them', () => {
    // Same JSON, different key order and spacing: a handler that re-stringifies
    // a parsed body before verifying would accept this. This must not.
    const raw = '{"id":"evt_1","type":"payment_link.completed"}';
    const signature = sign(raw, timestamp);
    const reserialised = JSON.stringify(JSON.parse(raw), ['type', 'id']);
    assert.notEqual(reserialised, raw);
    assert.equal(
      verifyWebhookSignature({ rawBody: reserialised, signature, timestamp, secret: SECRET, now: () => now }),
      false
    );
  });
});

describe('parseWebhookEvent', () => {
  it('returns null for anything that is not an event', () => {
    for (const bad of ['', 'not json', '[]', '{}', '{"id":"e"}', '{"id":"e","type":"t"}', 'null']) {
      assert.equal(parseWebhookEvent(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  it('parses a delivery', () => {
    const event = parseWebhookEvent(
      JSON.stringify({ id: 'evt_1', type: 'payment_link.completed', createdAt: 'x', data: { paymentLinkId: 'lnk_1' } })
    );
    assert.equal(event?.data.paymentLinkId, 'lnk_1');
  });
});

describe('nonceFromDescription', () => {
  it('reads the nonce the description was built with', () => {
    assert.equal(nonceFromDescription('tb_AbCd1234_-xyzAbCd12 · search · fetch'), 'AbCd1234_-xyzAbCd12');
  });

  it('returns null when there is nothing to read', () => {
    for (const d of [null, undefined, '', 'an invoice reference', 'tb_short']) {
      assert.equal(nonceFromDescription(d), null, `should find no nonce in ${JSON.stringify(d)}`);
    }
  });
});

/** A stand-in Moove that serves one link and counts reads. */
function stubMoove(now: () => number) {
  const state = { status: 'active' as MoovePaymentLinkStatus, receivedAmount: null as string | null, reads: 0, id: 'lnk_1' };
  const client = new MooveClient({
    apiKey: 'mk_test',
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { description?: string };
        state.description = body.description;
        return new Response(JSON.stringify({ id: state.id, url: `https://pay.moove.xyz/${state.id}` }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      state.reads += 1;
      const link: MoovePaymentLink = {
        id: state.id,
        userId: 'u',
        toAmount: '10.00',
        destinationAddress: '0xAf3B000000000000000000000000000000000cbAd',
        url: `https://pay.moove.xyz/${state.id}`,
        dateCreated: new Date(now()).toISOString(),
        token: {
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
          logo: null,
          isNative: false,
          isStablecoin: true,
          currencyCode: 'USD',
          commodityCode: null,
          chain: { id: '8453', name: 'Base', symbol: 'ETH', chainType: 'EVM', logo: '' },
        },
        status: state.status,
        ...(state.receivedAmount !== null ? { receivedAmount: state.receivedAmount } : {}),
      };
      void url;
      return new Response(JSON.stringify(link), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch,
  });
  return { state: state as typeof state & { description?: string }, client };
}

function setup(nowRef: { value: number }) {
  const now = () => nowRef.value;
  const { state, client } = stubMoove(now);
  const store = new MemoryEntitlementStore();
  const provider = new MooveProvider({ client, store, prices: [PACK], now });
  return { state, store, provider };
}

const event = (args: {
  type: MooveWebhookEvent['type'];
  paymentLinkId: string;
  description: string | null;
  id?: string;
}): MooveWebhookEvent => ({
  id: args.id ?? `evt_${Math.random().toString(36).slice(2)}`,
  type: args.type,
  createdAt: new Date().toISOString(),
  data: {
    paymentLinkId: args.paymentLinkId,
    status: 'completed',
    amount: '10.00',
    // Deliberately a lie in some tests below: nothing may be decided from it.
    receivedAmount: '0.01',
    currentUsage: 1,
    maxUsage: 1,
    chainId: '8453',
    tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    description: args.description,
    ...(args.type === 'payment_link.transaction.succeeded'
      ? {
          transaction: {
            id: 'tx_1',
            status: 'settled',
            amount: '10.00',
            tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
            chainId: '8453',
            sourceTransaction: '0xabc',
            dateCreated: new Date().toISOString(),
          },
        }
      : {}),
  },
});

describe('settleFromWebhook', () => {
  const opened = async (nowRef: { value: number }) => {
    const ctx = setup(nowRef);
    const { charge } = await ctx.provider.openCharge({ sku: 'search', subject: 'tb_s_1' });
    return { ...ctx, charge, description: ctx.state.description ?? null };
  };

  it('grants on transaction.succeeded, reading the link rather than the payload', async () => {
    const nowRef = { value: 1_000_000 };
    const { provider, state, charge, description } = await opened(nowRef);
    state.status = 'completed';
    state.receivedAmount = '10.00';

    const result = await provider.settleFromWebhook(
      event({ type: 'payment_link.transaction.succeeded', paymentLinkId: charge.providerRef!, description })
    );
    assert.equal(result.handled, true);
    assert.equal(result.handled && result.outcome.status, 'granted');
    assert.ok(state.reads > 0, 'must ask Moove rather than trust the event body');
  });

  it('is exactly-once across both events in either order, and duplicates of each', async () => {
    for (const order of [
      ['payment_link.transaction.succeeded', 'payment_link.completed'],
      ['payment_link.completed', 'payment_link.transaction.succeeded'],
    ] as const) {
      const nowRef = { value: 1_000_000 };
      const { provider, store, state, charge, description } = await opened(nowRef);
      state.status = 'completed';
      state.receivedAmount = '10.00';

      const deliveries = [order[0], order[0], order[1], order[1]]; // each delivered twice
      const outcomes = [];
      for (const type of deliveries) {
        const result = await provider.settleFromWebhook(
          event({ type, paymentLinkId: charge.providerRef!, description })
        );
        assert.equal(result.handled, true);
        if (result.handled) outcomes.push(result.outcome.status);
      }

      const granted = outcomes.filter((s) => s === 'granted' || s === 'partial');
      assert.equal(granted.length, 1, `exactly one grant for order ${order.join(' then ')}, got ${outcomes.join(', ')}`);
      assert.deepEqual(
        outcomes.slice(1),
        ['already_granted', 'already_granted', 'already_granted'],
        'every later delivery is a no-op'
      );

      const entitlements = await store.listEntitlements(charge.subject);
      assert.equal(entitlements.length, 1, 'one entitlement, however many deliveries arrived');
      assert.equal(entitlements[0]?.remaining, 250, 'one pack of credits, not four');
    }
  });

  it('honours a payment that settled after our own expiry — the charge is revived, not abandoned', async () => {
    const nowRef = { value: 1_000_000 };
    const { provider, state, charge, description } = await opened(nowRef);

    // The hour runs out and the sweep closes the charge, as it always did.
    nowRef.value += DEFAULT_CHARGE_TTL_MS + 60_000;
    const swept = await provider.settleCharge(charge.nonce);
    assert.equal(swept.status, 'expired');

    // Then Moove says it was paid. The money is real and cannot be refunded.
    state.status = 'completed';
    state.receivedAmount = '10.00';
    const result = await provider.settleFromWebhook(
      event({ type: 'payment_link.transaction.succeeded', paymentLinkId: charge.providerRef!, description })
    );

    assert.equal(result.handled, true);
    assert.equal(result.handled && result.outcome.status, 'granted', 'a paid charge must not stay abandoned');
  });

  it('still abandons an expired charge the sweep finds, without an API call', async () => {
    const nowRef = { value: 1_000_000 };
    const { provider, state, charge } = await opened(nowRef);
    const before = state.reads;
    nowRef.value += DEFAULT_CHARGE_TTL_MS + 60_000;

    const outcome = await provider.settleCharge(charge.nonce);
    assert.equal(outcome.status, 'expired');
    assert.equal(state.reads, before, 'no evidence, no API call');
  });

  it('ignores an event for a link this process does not know', async () => {
    const nowRef = { value: 1_000_000 };
    const { provider, charge, description } = await opened(nowRef);

    const unknown = await provider.settleFromWebhook(
      event({ type: 'payment_link.completed', paymentLinkId: 'lnk_someone_else', description })
    );
    assert.equal(unknown.handled, false);
    assert.equal(unknown.handled === false && unknown.reason, 'link-mismatch');

    const noNonce = await provider.settleFromWebhook(
      event({ type: 'payment_link.completed', paymentLinkId: charge.providerRef!, description: 'an invoice reference' })
    );
    assert.equal(noNonce.handled, false);
    assert.equal(noNonce.handled === false && noNonce.reason, 'no-nonce');

    const foreign = await provider.settleFromWebhook(
      event({ type: 'payment_link.completed', paymentLinkId: charge.providerRef!, description: 'tb_AAAAAAAAAAAAAAAAAAAAAA' })
    );
    assert.equal(foreign.handled, false);
    assert.equal(foreign.handled === false && foreign.reason, 'unknown-charge');
  });

  it('does nothing when the link is not terminal yet', async () => {
    const nowRef = { value: 1_000_000 };
    const { provider, charge, description } = await opened(nowRef);
    const result = await provider.settleFromWebhook(
      event({ type: 'payment_link.transaction.succeeded', paymentLinkId: charge.providerRef!, description })
    );
    assert.equal(result.handled, true);
    assert.equal(result.handled && result.outcome.status, 'pending');
  });
});
