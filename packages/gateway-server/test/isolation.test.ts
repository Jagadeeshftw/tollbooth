import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type { WireCallEvent, WireChargeOpenedEvent } from '@tollbooth/gateway-client';

import { ingestBatch } from '../src/ingest.js';
import { upsertTenantForGithubUser } from '../src/tenants.js';
import { admin, CONNECTION_STRING, freshDatabase } from './helpers.js';

/**
 * Proves the isolation, rather than asserting the policy exists. Every test
 * here uses a *raw* client on the admin pool — the same role that owns the
 * tables, with `FORCE ROW LEVEL SECURITY` so even that role is restricted —
 * and deliberately tries the thing a tenant-isolation bug would let happen:
 * reading or writing another tenant's rows. `ingestBatch`'s own `withTenant`
 * always sets the *correct* tenant, so it could never catch a regression
 * here; these tests bypass it on purpose.
 */
if (!CONNECTION_STRING) {
  describe('row-level security', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  function chargeOpened(over: Partial<WireChargeOpenedEvent> = {}): WireChargeOpenedEvent {
    return {
      kind: 'charge_opened',
      eventId: randomUUID(),
      at: 1000,
      tool: 'lookup_market_data',
      sku: 'search',
      chargeRef: randomUUID().replace(/-/g, ''),
      amount: '10.00',
      currency: 'USDC',
      ...over,
    };
  }

  /** Run `sql` on a fresh connection with `app.tenant_id` set to `asTenantId` for one statement's duration. */
  async function queryAs(asTenantId: string | null, sql: string, params: unknown[] = []) {
    const client = await admin!.connect();
    try {
      await client.query('BEGIN');
      if (asTenantId !== null) {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', asTenantId]);
      }
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  function call(over: Partial<WireCallEvent> = {}): WireCallEvent {
    return {
      kind: 'call',
      eventId: randomUUID(),
      at: 1000,
      tool: 'lookup_market_data',
      sku: 'search',
      cost: 1,
      tokenPresented: true,
      tokenFingerprint: 'tb_s_x7Q..dyA3',
      tokenRecognised: true,
      outcome: 'authorised',
      ...over,
    };
  }

  /** Populates all four tenant-scoped tables, so every isolation test below has real rows to try to read. */
  async function twoTenantsWithData() {
    const db = await freshDatabase();
    const a = await upsertTenantForGithubUser(db, { id: 1, login: 'tenant-a', name: null, avatarUrl: null });
    const b = await upsertTenantForGithubUser(db, { id: 2, login: 'tenant-b', name: null, avatarUrl: null });
    await ingestBatch(db, a.id, [chargeOpened({ tool: 'a-tool' }), call({ tool: 'a-tool' })]);
    await ingestBatch(db, b.id, [chargeOpened({ tool: 'b-tool' }), call({ tool: 'b-tool' })]);
    return { db, a, b };
  }

  const TENANT_TABLES = ['gateway_charges', 'gateway_calls', 'gateway_ingested_events', 'gateway_daily_rollups'];

  describe('reading as the wrong tenant returns nothing, for every tenant-scoped table', () => {
    for (const table of TENANT_TABLES) {
      it(`${table}: tenant A's session sees zero of tenant B's rows, even asking for them by id`, async () => {
        const { db, a, b } = await twoTenantsWithData();
        try {
          const asA = await queryAs(a.id, `SELECT * FROM ${table} WHERE tenant_id = $1`, [b.id]);
          assert.equal(asA.rowCount, 0, `RLS must hide tenant B's rows in ${table} from a session scoped to tenant A`);

          const own = await queryAs(a.id, `SELECT * FROM ${table} WHERE tenant_id = $1`, [a.id]);
          assert.ok(
            (own.rowCount ?? 0) > 0,
            `sanity check: tenant A must still see its own rows in ${table} — otherwise this test would pass by accident`
          );
        } finally {
          await db.close();
        }
      });

      it(`${table}: an unscoped session (no app.tenant_id set at all) sees nothing`, async () => {
        const { db, a } = await twoTenantsWithData();
        try {
          const unscoped = await queryAs(null, `SELECT * FROM ${table}`);
          assert.equal(unscoped.rowCount, 0, `a query with no tenant context must not fall through to "see everything" in ${table}`);
          const scoped = await queryAs(a.id, `SELECT * FROM ${table}`);
          assert.ok((scoped.rowCount ?? 0) > 0, `sanity check that the table genuinely has rows once scoped`);
        } finally {
          await db.close();
        }
      });
    }
  });

  describe('writing as the wrong tenant is refused, not silently redirected', () => {
    it('cannot insert a row claiming to belong to tenant B while scoped to tenant A', async () => {
      const { db, a, b } = await twoTenantsWithData();
      try {
        await assert.rejects(
          () =>
            queryAs(
              a.id,
              `INSERT INTO gateway_charges (tenant_id, charge_ref, tool, sku, amount, currency, opened_at)
               VALUES ($1, $2, 'x', 'x', '1.00', 'USDC', 0)`,
              [b.id, randomUUID()]
            ),
          /row-level security/i,
          'the WITH CHECK clause must refuse a row whose tenant_id does not match the session'
        );
      } finally {
        await db.close();
      }
    });

    it('can insert a row for its own tenant', async () => {
      const { db, a } = await twoTenantsWithData();
      try {
        const ref = randomUUID();
        await queryAs(
          a.id,
          `INSERT INTO gateway_charges (tenant_id, charge_ref, tool, sku, amount, currency, opened_at)
           VALUES ($1, $2, 'x', 'x', '1.00', 'USDC', 0)`,
          [a.id, ref]
        );
        const { rowCount } = await queryAs(a.id, 'SELECT 1 FROM gateway_charges WHERE tenant_id = $1 AND charge_ref = $2', [a.id, ref]);
        assert.equal(rowCount, 1);
      } finally {
        await db.close();
      }
    });
  });

  describe('the auth tables are reachable without a tenant context, by design', () => {
    it('gateway_tenants and gateway_ingest_tokens carry no RLS — they are how a tenant context gets established', async () => {
      const { db, a } = await twoTenantsWithData();
      try {
        const tenants = await queryAs(null, 'SELECT id FROM gateway_tenants WHERE id = $1', [a.id]);
        assert.equal(tenants.rowCount, 1, 'the tenant lookup that establishes context must work with no context yet set');
      } finally {
        await db.close();
      }
    });
  });
}
