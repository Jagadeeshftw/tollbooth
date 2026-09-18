import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GatewayClient } from '../src/client.js';
import type { RemoteConfigApplyResult, RemotePriceUpdate } from '../src/remote-config.js';
import { isRemoteConfigurable } from '../src/remote-config.js';

/** A stand-in provider recording every call, answering with a scripted result. */
function stubProvider(result: RemoteConfigApplyResult = { applied: [], rejected: [], ignored: [] }) {
  const calls: RemotePriceUpdate[][] = [];
  return {
    calls,
    applyRemoteConfig(updates: readonly RemotePriceUpdate[]): RemoteConfigApplyResult {
      calls.push([...updates]);
      return result;
    },
  };
}

function stubConfigFetch(responses: Array<{ prices: RemotePriceUpdate[] } | { status: number } | Error>) {
  const requests: { url: string; authorization: string | null }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    requests.push({ url: String(url), authorization: (init?.headers as Record<string, string> | undefined)?.['authorization'] ?? null });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next && 'status' in next) {
      return { ok: false, status: next.status } as Response;
    }
    return { ok: true, status: 200, json: async () => next ?? { prices: [] } } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, requests };
}

describe('isRemoteConfigurable', () => {
  it('is true for anything with an applyRemoteConfig method, false otherwise', () => {
    assert.equal(isRemoteConfigurable(stubProvider()), true);
    assert.equal(isRemoteConfigurable({}), false);
    assert.equal(isRemoteConfigurable(null), false);
    assert.equal(isRemoteConfigurable('applyRemoteConfig'), false);
  });
});

describe('GatewayClient#syncPricesOnce', () => {
  it('fetches configEndpoint with the ingest token, and applies the result to the provider', async () => {
    const update: RemotePriceUpdate = { sku: 'search', amount: '12.00', credits: 300, ttlMs: null, label: 'v2' };
    const { fetchImpl, requests } = stubConfigFetch([{ prices: [update] }]);
    const gw = new GatewayClient({ endpoint: 'https://gw.example/api/ingest', ingestToken: 'gw_test_token', fetch: fetchImpl });
    const provider = stubProvider();

    await gw.syncPricesOnce(provider);

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'https://gw.example/api/config', 'derived by swapping /ingest for /config');
    assert.equal(requests[0]?.authorization, 'Bearer gw_test_token');
    assert.deepEqual(provider.calls, [[update]]);
  });

  it('honours an explicit configEndpoint instead of deriving one', async () => {
    const { fetchImpl, requests } = stubConfigFetch([{ prices: [] }]);
    const gw = new GatewayClient({
      endpoint: 'https://gw.example/api/ingest',
      configEndpoint: 'https://gw.example/api/v2/config',
      ingestToken: 'gw_test_token',
      fetch: fetchImpl,
    });
    await gw.syncPricesOnce(stubProvider());
    assert.equal(requests[0]?.url, 'https://gw.example/api/v2/config');
  });

  it('reports the apply result via onConfigApplied, including a rejection — never silent', async () => {
    const { fetchImpl } = stubConfigFetch([{ prices: [{ sku: 'search', amount: '0.01', credits: 1, ttlMs: null, label: 'x' }] }]);
    const results: RemoteConfigApplyResult[] = [];
    const gw = new GatewayClient({
      endpoint: 'https://gw.example/api/ingest',
      ingestToken: 'gw_test_token',
      fetch: fetchImpl,
      onConfigApplied: (r) => results.push(r),
    });
    const rejected = { applied: [], rejected: [{ sku: 'search', reason: 'below the floor' }], ignored: [] };
    await gw.syncPricesOnce(stubProvider(rejected));
    assert.deepEqual(results, [rejected]);
  });

  it('on a fetch failure, calls onConfigSyncError and never touches the provider', async () => {
    const { fetchImpl } = stubConfigFetch([new Error('network down')]);
    let syncError: unknown;
    const gw = new GatewayClient({
      endpoint: 'https://gw.example/api/ingest',
      ingestToken: 'gw_test_token',
      fetch: fetchImpl,
      onConfigSyncError: (e) => (syncError = e),
    });
    const provider = stubProvider();

    await gw.syncPricesOnce(provider);

    assert.match(String(syncError), /network down/);
    assert.deepEqual(provider.calls, [], 'a fetch failure must never call applyRemoteConfig with anything, half-formed or otherwise');
  });

  it('on an HTTP error status, also reports via onConfigSyncError rather than throwing', async () => {
    const { fetchImpl } = stubConfigFetch([{ status: 500 }]);
    let syncError: unknown;
    const gw = new GatewayClient({
      endpoint: 'https://gw.example/api/ingest',
      ingestToken: 'gw_test_token',
      fetch: fetchImpl,
      onConfigSyncError: (e) => (syncError = e),
    });
    await gw.syncPricesOnce(stubProvider());
    assert.match(String(syncError), /500/);
  });

  it('the provider keeps whatever it last had — a failed sync is a no-op, not a reset', async () => {
    // First tick succeeds and applies a price; second tick's fetch fails.
    // The provider itself already embodies "last known good" — this proves
    // syncPricesOnce never calls it with anything on a failed tick, so
    // there is nothing here that could reset it even if it wanted to.
    const { fetchImpl } = stubConfigFetch([{ prices: [{ sku: 'search', amount: '12.00', credits: 300, ttlMs: null, label: 'v2' }] }, new Error('outage')]);
    const gw = new GatewayClient({ endpoint: 'https://gw.example/api/ingest', ingestToken: 'gw_test_token', fetch: fetchImpl });
    const provider = stubProvider();

    await gw.syncPricesOnce(provider);
    await gw.syncPricesOnce(provider);

    assert.equal(provider.calls.length, 1, 'the outage tick never called applyRemoteConfig at all');
  });
});

describe('GatewayClient#startConfigSync / stopConfigSync', () => {
  it('syncs immediately on start, and is idempotent', async () => {
    const { fetchImpl, requests } = stubConfigFetch([{ prices: [] }, { prices: [] }]);
    const gw = new GatewayClient({ endpoint: 'https://gw.example/api/ingest', ingestToken: 'gw_test_token', fetch: fetchImpl });
    const provider = stubProvider();

    gw.startConfigSync(provider, { intervalMs: 3_600_000 });
    gw.startConfigSync(provider, { intervalMs: 3_600_000 }); // must not start a second timer
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget immediate sync settle

    assert.equal(requests.length, 1, 'one immediate sync, not two, even though start was called twice');
    gw.stopConfigSync();
  });

  it('stopConfigSync stops future ticks', async () => {
    const { fetchImpl, requests } = stubConfigFetch([{ prices: [] }]);
    const gw = new GatewayClient({ endpoint: 'https://gw.example/api/ingest', ingestToken: 'gw_test_token', fetch: fetchImpl });
    gw.startConfigSync(stubProvider(), { intervalMs: 5 });
    await new Promise((r) => setTimeout(r, 0));
    gw.stopConfigSync();
    const countAtStop = requests.length;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(requests.length, countAtStop, 'no further ticks after stop, however long we wait');
  });
});
