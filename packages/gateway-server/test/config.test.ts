import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type { WireChargeOpenedEvent } from '@tollbooth/gateway-client';

import { configAuditLog, effectivePriceCatalog, getPriceConfig, setPriceConfig } from '../src/config.js';
import { ingestBatch } from '../src/ingest.js';
import { upsertTenantForGithubUser } from '../src/tenants.js';
import { CONNECTION_STRING, freshDatabase } from './helpers.js';

if (!CONNECTION_STRING) {
  describe('config', () => {
    it('needs TOLLBOOTH_GATEWAY_TEST_POSTGRES_URL (never DATABASE_URL - this suite truncates)', { skip: 'no connection string' }, () => {});
  });
} else {
  async function tenant(db: Awaited<ReturnType<typeof freshDatabase>>) {
    return upsertTenantForGithubUser(db, { id: 1, login: 'operator-a', name: null, avatarUrl: null });
  }

  function chargeOpened(over: Partial<WireChargeOpenedEvent> = {}): WireChargeOpenedEvent {
    return {
      kind: 'charge_opened', eventId: randomUUID(), at: 1000, tool: 'lookup_market_data', sku: 'search',
      chargeRef: randomUUID().replace(/-/g, ''), amount: '10.00', currency: 'USDC', ...over,
    };
  }

  describe('setPriceConfig', () => {
    it('refuses to configure a sku that has never been charged for and has no existing config', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await assert.rejects(
          () => setPriceConfig(db, t.id, 'operator-a', { sku: 'never-charged', amount: '1.00' }),
          /never been charged for/
        );
      } finally {
        await db.close();
      }
    });

    it('starts from the most recently reported price when a sku is configured for the first time', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);

        const row = await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '12.00' }, () => 5000);
        assert.equal(row.amount, '12.00');
        assert.equal(row.updatedBy, 'operator-a');

        const [stored] = await getPriceConfig(db, t.id);
        assert.equal(stored?.amount, '12.00');
      } finally {
        await db.close();
      }
    });

    it('only changes the fields given, leaving the rest as they were', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '10.00', credits: 250, label: 'v1' });

        const updated = await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '15.00' });
        assert.equal(updated.amount, '15.00');
        assert.equal(updated.credits, 250, 'credits untouched by an edit that only named amount');
        assert.equal(updated.label, 'v1', 'label untouched too');
      } finally {
        await db.close();
      }
    });

    it('records one audit row per field that actually changed, and none for fields left alone', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '10.00', credits: 250, label: 'v1' }, () => 1000);

        await setPriceConfig(db, t.id, 'operator-b', { sku: 'search', amount: '12.00' }, () => 2000);

        const log = await configAuditLog(db, t.id);
        const forThisEdit = log.filter((e) => e.changedAt === 2000);
        assert.equal(forThisEdit.length, 1, 'only amount changed on the second edit — one row, not four');
        assert.equal(forThisEdit[0]?.field, 'amount');
        assert.equal(forThisEdit[0]?.oldValue, '10.00');
        assert.equal(forThisEdit[0]?.newValue, '12.00');
        assert.equal(forThisEdit[0]?.actor, 'operator-b');
      } finally {
        await db.close();
      }
    });

    it('records nothing when an edit changes nothing', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '10.00' }, () => 1000);

        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '10.00' }, () => 2000);

        assert.equal((await configAuditLog(db, t.id)).length, 0, 'the amount never actually moved — nothing to record');
      } finally {
        await db.close();
      }
    });

    it('most recent edits first', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '11.00' }, () => 1000);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '12.00' }, () => 2000);

        const log = await configAuditLog(db, t.id);
        assert.equal(log[0]?.newValue, '12.00');
        assert.equal(log[1]?.newValue, '11.00');
      } finally {
        await db.close();
      }
    });
  });

  describe('the audit log is a business record, not a payment record', () => {
    it('has no column that could carry a subject handle, nonce, link id or wallet address', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '12.00' });

        const [entry] = await configAuditLog(db, t.id);
        assert.deepEqual(
          Object.keys(entry!).sort(),
          ['actor', 'changedAt', 'field', 'id', 'newValue', 'oldValue', 'sku'].sort(),
          'exactly the allow-listed shape — nothing else made it onto the record'
        );
      } finally {
        await db.close();
      }
    });

    it('carries tenant identity via the actor field — a GitHub login, not a payer handle', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '12.00' });

        const [entry] = await configAuditLog(db, t.id);
        assert.equal(entry?.actor, 'operator-a');
      } finally {
        await db.close();
      }
    });
  });

  describe('effectivePriceCatalog', () => {
    it('shows the reported price, unconfigured, for a sku nobody has ever edited', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ tool: 'lookup_market_data', sku: 'search', amount: '10.00' })]);

        const [row] = await effectivePriceCatalog(db, t.id);
        assert.equal(row?.amount, '10.00');
        assert.equal(row?.configured, false);
      } finally {
        await db.close();
      }
    });

    it('overlays a config edit on top of the reported price', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ tool: 'lookup_market_data', sku: 'search', amount: '10.00' })]);
        await setPriceConfig(db, t.id, 'operator-a', { sku: 'search', amount: '12.00', credits: 300, label: 'v2' });

        const [row] = await effectivePriceCatalog(db, t.id);
        assert.equal(row?.amount, '12.00', 'the edit wins over what was last charged');
        assert.equal(row?.credits, 300);
        assert.equal(row?.label, 'v2');
        assert.equal(row?.configured, true);
      } finally {
        await db.close();
      }
    });
  });

  describe('getPriceConfig', () => {
    it('is empty until an operator has made at least one edit', async () => {
      const db = await freshDatabase();
      try {
        const t = await tenant(db);
        await ingestBatch(db, t.id, [chargeOpened({ amount: '10.00' })]);
        assert.deepEqual(await getPriceConfig(db, t.id), []);
      } finally {
        await db.close();
      }
    });

    it('one tenant cannot read another tenant\'s configured prices', async () => {
      const db = await freshDatabase();
      try {
        const a = await tenant(db);
        const b = await upsertTenantForGithubUser(db, { id: 2, login: 'operator-b', name: null, avatarUrl: null });
        await ingestBatch(db, a.id, [chargeOpened({ amount: '10.00' })]);
        await setPriceConfig(db, a.id, 'operator-a', { sku: 'search', amount: '12.00' });

        assert.deepEqual(await getPriceConfig(db, b.id), []);
      } finally {
        await db.close();
      }
    });
  });
}
