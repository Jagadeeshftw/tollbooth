import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SettlementOutcome } from '@tollbooth/core';

import { GatewayClient } from '../src/client.js';
import type { RawCallEvent, RawChargeOpenedEvent, WireEvent } from '../src/events.js';

const CALL: RawCallEvent = {
  tool: 'lookup_market_data',
  sku: 'search',
  cost: 1,
  at: 1000,
  tokenPresented: true,
  tokenFingerprint: 'tb_s_x7Q..dyA3',
  tokenRecognised: true,
  outcome: 'authorised',
};

const CHARGE_OPENED: RawChargeOpenedEvent = {
  tool: 'lookup_market_data',
  sku: 'search',
  nonce: 'a-real-looking-nonce',
  amount: '10.00',
  currency: 'USDC',
  at: 1000,
};

/** A fetch stub that records every request and answers from a scripted queue. */
function stubFetch(responses: Array<{ ok: boolean; status: number } | Error>) {
  const requests: { body: { events: WireEvent[] } }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { events: WireEvent[] };
    requests.push({ body });
    const next = responses.shift();
    if (!next) return { ok: true, status: 200 } as Response;
    if (next instanceof Error) throw next;
    return next as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, requests };
}

function client(overrides: Partial<ConstructorParameters<typeof GatewayClient>[0]> = {}) {
  // Only stands in when the caller does not supply its own fetch stub, so a
  // test that does supply one is unambiguously reading its own requests.
  const fallback = overrides.fetch ? undefined : stubFetch([]);
  const dropped: { events: readonly WireEvent[]; error: unknown }[] = [];
  const gw = new GatewayClient({
    endpoint: 'https://gateway.example/ingest',
    ingestToken: 'gw_test_token',
    sleep: async () => {},
    ...(fallback ? { fetch: fallback.fetchImpl } : {}),
    onDropped: (events, error) => dropped.push({ events, error }),
    ...overrides,
  });
  return { gw, requests: fallback?.requests ?? [], dropped };
}

describe('GatewayClient: queueing and idempotent ids', () => {
  it('mints one eventId per raw event, and it survives a retry unchanged', async () => {
    const { fetchImpl, requests } = stubFetch([new Error('network down'), { ok: true, status: 200 }]);
    const { gw } = client({ fetch: fetchImpl, maxAttempts: 3 });

    gw.onCall(CALL);
    assert.equal(gw.queueLength, 1);
    await gw.flush();

    assert.equal(requests.length, 2, 'the failed attempt and the retry that followed it');
    const idFirst = requests[0]!.body.events[0]!.eventId;
    const idRetry = requests[1]!.body.events[0]!.eventId;
    assert.equal(idFirst, idRetry, 'a retry must resend the same event id, not mint a fresh one');
    assert.equal(gw.queueLength, 0);
  });

  it('batches multiple queued events into one request, up to maxBatchSize', async () => {
    const { fetchImpl, requests } = stubFetch([]);
    const { gw } = client({ fetch: fetchImpl, maxBatchSize: 2 });

    gw.onCall(CALL);
    gw.onCall(CALL);
    gw.onCall(CALL);
    await gw.flush();

    assert.equal(requests.length, 2, 'three events at a batch size of two is two requests');
    assert.equal(requests[0]!.body.events.length, 2);
    assert.equal(requests[1]!.body.events.length, 1);
  });

  it('sends the ingest token as a bearer header, never the tenant Moove key', async () => {
    const seen: (string | null)[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)?.['authorization'] ?? null);
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof globalThis.fetch;
    const { gw } = client({ fetch: fetchImpl });

    gw.onCall(CALL);
    await gw.flush();
    assert.equal(seen[0], 'Bearer gw_test_token');
  });
});

describe('GatewayClient: retry and drop', () => {
  it('retries a failed batch with backoff, up to maxAttempts, then reports it dropped', async () => {
    const { fetchImpl, requests } = stubFetch([
      new Error('one'),
      new Error('two'),
      new Error('three'),
    ]);
    const { gw, dropped } = client({ fetch: fetchImpl, maxAttempts: 3 });

    gw.onCall(CALL);
    await gw.flush();

    assert.equal(requests.length, 3, 'exactly maxAttempts tries, no more');
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]!.events.length, 1);
    assert.equal(gw.queueLength, 0, 'a batch that exhausts retries is removed, not retried forever');
  });

  it('does not retry a 4xx — a bad token cannot succeed on a second try', async () => {
    const { fetchImpl, requests } = stubFetch([{ ok: false, status: 401 }]);
    const { gw, dropped } = client({ fetch: fetchImpl, maxAttempts: 4 });

    gw.onCall(CALL);
    await gw.flush();

    assert.equal(requests.length, 1, 'a 401 must fail fast, not spend the full retry budget');
    assert.equal(dropped.length, 1);
  });

  it('retries a 5xx like a network error', async () => {
    const { fetchImpl, requests } = stubFetch([{ ok: false, status: 503 }, { ok: true, status: 200 }]);
    const { gw } = client({ fetch: fetchImpl, maxAttempts: 3 });

    gw.onCall(CALL);
    await gw.flush();
    assert.equal(requests.length, 2);
  });

  it('drops the oldest events once the queue exceeds maxQueueSize', () => {
    const { fetchImpl } = stubFetch([]);
    const { gw, dropped } = client({ fetch: fetchImpl, maxQueueSize: 3 });

    // Enqueued one at a time, as every real call does: each push past the
    // bound trims immediately, so five pushes over a bound of three drop two
    // events across two separate notifications, not one batched one.
    for (let i = 0; i < 5; i++) gw.onCall({ ...CALL, cost: i });
    assert.equal(gw.queueLength, 3, 'never exceeds the bound, even mid-burst');
    const totalDropped = dropped.reduce((n, d) => n + d.events.length, 0);
    assert.equal(totalDropped, 2, 'the two oldest were dropped to make room');
    assert.ok(
      dropped.every((d) => (d.events[0] as { cost: number }).cost < 2),
      'what was dropped is the oldest (lowest cost), never the newest'
    );
  });
});

describe('GatewayClient: the three hooks project correctly and skip uninteresting settlements', () => {
  it('onChargeOpened and onCall each enqueue one event', () => {
    const { gw } = client();
    gw.onChargeOpened(CHARGE_OPENED);
    gw.onCall(CALL);
    assert.equal(gw.queueLength, 2);
  });

  it('onSettlement enqueues nothing for pending or already_granted', () => {
    const { gw } = client();
    const charge = {
      id: 'c',
      nonce: 'n',
      subject: 's',
      sku: 'search',
      amount: '10.00',
      price: null,
      status: 'pending' as const,
      providerRef: null,
      checkoutUrl: null,
      createdAt: 0,
      expiresAt: 1,
      settledAt: null,
      receivedAmount: null,
      lastPolledAt: null,
      pollCount: 0,
    };
    gw.onSettlement({ status: 'pending', charge } satisfies SettlementOutcome);
    gw.onSettlement({ status: 'already_granted', charge } satisfies SettlementOutcome);
    assert.equal(gw.queueLength, 0);

    gw.onSettlement({ status: 'granted', charge, entitlementId: 'e' } satisfies SettlementOutcome);
    assert.equal(gw.queueLength, 1);
  });
});

describe('GatewayClient: lifecycle', () => {
  it('start() is idempotent and stop() flushes what remains', async () => {
    const { fetchImpl, requests } = stubFetch([]);
    const { gw } = client({ fetch: fetchImpl });

    gw.start();
    gw.start(); // must not create a second timer
    gw.onCall(CALL);
    await gw.stop();

    assert.equal(requests.length, 1, 'stop() must flush the queue, not abandon it');
    assert.equal(gw.queueLength, 0);
  });

  it('constructing without an endpoint or ingestToken throws', () => {
    assert.throws(() => new GatewayClient({ endpoint: '', ingestToken: 'x' }), /endpoint/);
    assert.throws(() => new GatewayClient({ endpoint: 'https://x', ingestToken: '' }), /ingestToken/);
  });
});
