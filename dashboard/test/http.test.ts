import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

import { chromium } from 'playwright-core';

import type { WireChargeOpenedEvent, WireSettlementEvent } from '@tollbooth/gateway-client';
import {
  GatewayDatabase,
  ingestBatch,
  issueSession,
  issueTenantIngestToken,
  revokeIngestToken,
  setPriceConfig,
  upsertTenantForGithubUser,
} from '@tollbooth/gateway-server';

import { BASE_URL, CONNECTION_STRING, SESSION_SECRET, startDashboardServer, stopDashboardServer } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('dashboard http', () => {
    it(
      'needs TOLLBOOTH_DASHBOARD_TEST_POSTGRES_URL (never DATABASE_URL/GATEWAY_DATABASE_URL - this suite truncates)',
      { skip: 'no connection string' },
      () => {}
    );
  });
} else {
  const TABLES = [
    'gateway_daily_rollups',
    'gateway_calls',
    'gateway_charges',
    'gateway_ingested_events',
    'gateway_ingest_tokens',
    'gateway_tenants',
  ];

  let server: ChildProcess;
  let db: GatewayDatabase;

  before(async () => {
    db = new GatewayDatabase({ connectionString: CONNECTION_STRING });
    await db.ready();
    await db.withoutTenant((client) => client.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`));

    server = await startDashboardServer({
      GATEWAY_DATABASE_URL: CONNECTION_STRING,
      SESSION_SECRET,
      GITHUB_CLIENT_ID: 'test-github-client-id',
      GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      DASHBOARD_BASE_URL: BASE_URL,
    });
  });

  after(async () => {
    await stopDashboardServer(server);
    await db.close();
  });

  async function tenant(login: string) {
    return upsertTenantForGithubUser(db, { id: Math.floor(Math.random() * 1_000_000_000), login, name: null, avatarUrl: null });
  }

  function sessionCookie(tenantId: string): string {
    return `tb_session=${issueSession(tenantId, SESSION_SECRET)}`;
  }

  function chargeOpened(over: Partial<WireChargeOpenedEvent> = {}): WireChargeOpenedEvent {
    return {
      kind: 'charge_opened',
      eventId: randomUUID(),
      at: Date.now(),
      tool: 'lookup_market_data',
      sku: 'search',
      chargeRef: 'a'.repeat(64),
      amount: '10.00',
      currency: 'USDC',
      ...over,
    };
  }

  describe('the tokens page', () => {
    // The list is headed "Active tokens". A revoked token was rejected at
    // ingest but came back in that list on the next visit, so revoking one
    // looked like it had not worked.
    it('lists only active tokens: a revoked token does not come back', async () => {
      const t = await tenant('tokens-page-tenant');
      const active = await issueTenantIngestToken(db, t.id);
      const revoked = await issueTenantIngestToken(db, t.id);
      assert.equal(await revokeIngestToken(db, t.id, revoked.record.id), true);

      const res = await fetch(`${BASE_URL}/tokens`, { redirect: 'manual', headers: { cookie: sessionCookie(t.id) } });
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes(active.record.id), 'the active token is listed');
      assert.ok(!html.includes(revoked.record.id), 'the revoked token is not listed, nor sent to the page');
    });
  });

  describe('the overview, rendered in a real browser', () => {
    // The settlement-outcome bars were inline spans: an inline box ignores
    // width and height, so every tenant saw empty tracks from launch, and no
    // HTML-level test could tell. This measures the drawn bars in Chrome.
    it('draws each outcome bar wide in proportion to its count, and never zero-width for a non-zero count', async () => {
      const t = await tenant('overview-render-tenant');
      const settled = (chargeRef: string, status: WireSettlementEvent['status']): WireSettlementEvent => ({
        kind: 'settlement', eventId: randomUUID(), at: Date.now(), status, sku: 'search', chargeRef, amount: '10.00',
        receivedAmount: status === 'expired' ? null : '10.00', receivedFraction: status === 'expired' ? null : 1, credits: status === 'expired' ? null : 10,
      });
      await ingestBatch(db, t.id, [
        chargeOpened({ chargeRef: 'b'.repeat(64) }), settled('b'.repeat(64), 'granted'),
        chargeOpened({ chargeRef: 'c'.repeat(64) }), settled('c'.repeat(64), 'expired'),
      ]);

      // The installed Chrome, not a downloaded browser: CI's runners ship it.
      const browser = await chromium.launch({ channel: 'chrome', headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const [name, value] = sessionCookie(t.id).split('=');
        await context.addCookies([{ name: name!, value: value!, url: BASE_URL }]);
        const page = await context.newPage();
        const res = await page.goto(`${BASE_URL}/`);
        assert.equal(res?.status(), 200);
        const bars = await page.$$eval('.funnel-row', (rows) =>
          rows.map((r) => ({
            label: r.querySelector('.funnel-label')!.textContent!.trim(),
            count: Number(r.querySelector('.funnel-count')!.textContent),
            fill: r.querySelector('.funnel-fill')!.getBoundingClientRect().width,
            track: r.querySelector('.funnel-track')!.getBoundingClientRect().width,
          }))
        );
        assert.deepEqual(bars.map((b) => [b.label, b.count]), [['Granted', 1], ['Partial', 0], ['Underpaid', 0], ['Expired', 1]]);
        const total = bars.reduce((n, b) => n + b.count, 0);
        for (const b of bars) {
          assert.ok(b.track > 0, `${b.label}: the track itself is laid out`);
          if (b.count > 0) assert.ok(b.fill > 0, `${b.label}: a count of ${b.count} must draw a bar, got width ${b.fill}`);
          else assert.equal(b.fill, 0, `${b.label}: a zero count draws nothing`);
          assert.ok(Math.abs(b.fill - (b.track * b.count) / total) <= 1, `${b.label}: ${b.fill}px of ${b.track}px for ${b.count} of ${total}`);
        }
      } finally {
        await browser.close();
      }
    });
  });

  describe('the auth gate', () => {
    it('redirects an unauthenticated request for / to /login', async () => {
      const res = await fetch(`${BASE_URL}/`, { redirect: 'manual' });
      assert.equal(res.status, 307);
      assert.match(new URL(res.headers.get('location')!, BASE_URL).pathname, /^\/login$/);
    });

    it('redirects an unauthenticated request for /tokens to /login', async () => {
      const res = await fetch(`${BASE_URL}/tokens`, { redirect: 'manual' });
      assert.equal(res.status, 307);
      assert.match(new URL(res.headers.get('location')!, BASE_URL).pathname, /^\/login$/);
    });

    it('redirects a tampered session cookie to /login rather than erroring', async () => {
      const res = await fetch(`${BASE_URL}/`, {
        redirect: 'manual',
        headers: { cookie: 'tb_session=not-a-real-token' },
      });
      assert.equal(res.status, 307);
      assert.match(new URL(res.headers.get('location')!, BASE_URL).pathname, /^\/login$/);
    });

    it('lets a validly signed-in tenant reach / and /tokens', async () => {
      const t = await tenant('auth-gate-tenant');
      const cookie = sessionCookie(t.id);

      const overview = await fetch(`${BASE_URL}/`, { redirect: 'manual', headers: { cookie } });
      assert.equal(overview.status, 200);

      const tokens = await fetch(`${BASE_URL}/tokens`, { redirect: 'manual', headers: { cookie } });
      assert.equal(tokens.status, 200);
    });
  });

  describe('/api/ingest', () => {
    it('rejects a request with no bearer token', async () => {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      assert.equal(res.status, 401);
    });

    it('rejects an invalid or unknown token', async () => {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: 'POST',
        headers: { authorization: 'Bearer tbgw_ingest_not_a_real_token', 'content-type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      assert.equal(res.status, 401);
    });

    it('accepts a valid batch, and reports a byte-for-byte replay as fully duplicate', async () => {
      const t = await tenant('ingest-tenant');
      const { token } = await issueTenantIngestToken(db, t.id);
      const batch = { events: [chargeOpened()] };

      const first = await fetch(`${BASE_URL}/api/ingest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), { accepted: 1, duplicate: 0 });

      // The exact same batch, resent — the retry-after-a-dropped-response case
      // `ingestBatch` is designed for. It must be a no-op, not double-counted.
      const replay = await fetch(`${BASE_URL}/api/ingest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), { accepted: 0, duplicate: 1 });
    });
  });

  describe('/api/config', () => {
    it('rejects a request with no bearer token', async () => {
      const res = await fetch(`${BASE_URL}/api/config`);
      assert.equal(res.status, 401);
    });

    it('rejects an invalid or unknown token', async () => {
      const res = await fetch(`${BASE_URL}/api/config`, {
        headers: { authorization: 'Bearer tbgw_ingest_not_a_real_token' },
      });
      assert.equal(res.status, 401);
    });

    it("serves exactly this tenant's configured prices, and nothing for a sku never configured", async () => {
      const t = await tenant('config-tenant');
      const { token } = await issueTenantIngestToken(db, t.id);
      await ingestBatch(db, t.id, [chargeOpened({ sku: 'search', amount: '10.00' })]);
      await setPriceConfig(db, t.id, 'config-tenant', { sku: 'search', amount: '12.00', credits: 300, label: 'v2' });

      const res = await fetch(`${BASE_URL}/api/config`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { prices: { sku: string; amount: string }[] };
      assert.deepEqual(body.prices, [{ sku: 'search', amount: '12.00', credits: 300, ttlMs: null, label: 'v2' }]);
    });

    it('one tenant\'s ingest token can never read another tenant\'s configured prices', async () => {
      const a = await tenant('config-tenant-a');
      const b = await tenant('config-tenant-b');
      await ingestBatch(db, a.id, [chargeOpened({ sku: 'search', amount: '10.00' })]);
      await setPriceConfig(db, a.id, 'config-tenant-a', { sku: 'search', amount: '99.00' });
      const { token: bToken } = await issueTenantIngestToken(db, b.id);

      const res = await fetch(`${BASE_URL}/api/config`, { headers: { authorization: `Bearer ${bToken}` } });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).prices, []);
    });
  });
}
