import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

import type { WireChargeOpenedEvent } from '@tollbooth/gateway-client';
import { GatewayDatabase, issueSession, issueTenantIngestToken, upsertTenantForGithubUser } from '@tollbooth/gateway-server';

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
}
