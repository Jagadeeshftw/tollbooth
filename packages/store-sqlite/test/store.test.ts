import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { definePrice, entitlementFromPrice, issueSubjectRecord, slideSubject } from '@tollbooth/core';
import type { Charge, Entitlement } from '@tollbooth/core';

import { SqliteEntitlementStore } from '../src/index.js';

const execFileAsync = promisify(execFile);
const SUBJECT = 'tb_s_test';
const dirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tollbooth-'));
  dirs.push(dir);
  return join(dir, 'tollbooth.sqlite');
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function entitlement(over: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'tb_e_1',
    subject: SUBJECT,
    sku: 'search',
    remaining: 1,
    expiresAt: null,
    chargeId: 'tb_c_1',
    createdAt: 0,
    version: 0,
    ...over,
  };
}

function charge(over: Partial<Charge> = {}): Charge {
  return {
    id: 'tb_c_1',
    nonce: 'abc123',
    subject: SUBJECT,
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

describe('SqliteEntitlementStore behaviour', () => {
  it('matches the model across all three pricing units', async () => {
    const store = new SqliteEntitlementStore({ path: ':memory:', now: () => 1000 });

    const perCall = definePrice({ sku: 'once', unit: 'per_call', amount: '0.05' });
    const pack = definePrice({ sku: 'pack', unit: 'credit_pack', amount: '10.00', credits: 3 });
    const pass = definePrice({ sku: 'pass', unit: 'time_pass', amount: '20.00', ttlMs: 60_000 });

    for (const [i, price] of [perCall, pack, pass].entries()) {
      await store.grant(
        entitlementFromPrice({
          price,
          subject: SUBJECT,
          chargeId: `c${i}`,
          entitlementId: `e${i}`,
          now: 1000,
        })
      );
    }

    assert.equal((await store.consume(SUBJECT, 'once')).ok, true);
    assert.equal((await store.consume(SUBJECT, 'once')).ok, false);

    for (let i = 0; i < 3; i++) {
      assert.equal((await store.consume(SUBJECT, 'pack')).ok, true, `pack call ${i}`);
    }
    assert.equal((await store.consume(SUBJECT, 'pack')).ok, false);

    for (let i = 0; i < 20; i++) {
      const r = await store.consume(SUBJECT, 'pass');
      assert.equal(r.ok, true);
      assert.equal((r as { remaining: number | null }).remaining, null);
    }
    await store.close();
  });

  it('distinguishes expired from insufficient from never-bought', async () => {
    let now = 10_000;
    const store = new SqliteEntitlementStore({ path: ':memory:', now: () => now });

    const missing = await store.consume(SUBJECT, 'nothing');
    assert.equal((missing as { reason: string }).reason, 'no_entitlement');

    await store.grant(entitlement({ id: 'spent', remaining: 0, expiresAt: null }));
    const spent = await store.consume(SUBJECT, 'search');
    assert.equal((spent as { reason: string }).reason, 'insufficient_credits');

    await store.grant(entitlement({ id: 'lapsed', sku: 'other', remaining: 5, expiresAt: 1 }));
    const lapsed = await store.consume(SUBJECT, 'other');
    assert.equal((lapsed as { reason: string }).reason, 'expired');
    await store.close();
  });

  it('spends a valid pass before a credit pack', async () => {
    const store = new SqliteEntitlementStore({ path: ':memory:', now: () => 1000 });
    await store.grant(entitlement({ id: 'pack', remaining: 5, expiresAt: null }));
    await store.grant(entitlement({ id: 'pass', remaining: null, expiresAt: 50_000 }));

    await store.consume(SUBJECT, 'search');

    const pack = (await store.listEntitlements(SUBJECT)).find((e) => e.id === 'pack');
    assert.equal(pack?.remaining, 5);
    await store.close();
  });

  it('survives a restart, which is the whole point', async () => {
    const path = tempDb();
    const first = new SqliteEntitlementStore({ path });
    await first.grant(entitlement({ remaining: 7 }));
    await first.consume(SUBJECT, 'search');
    await first.putCharge(charge());
    await first.close();

    const second = new SqliteEntitlementStore({ path });
    const [e] = await second.listEntitlements(SUBJECT);
    assert.equal(e?.remaining, 6, 'balance survives the process that wrote it');
    assert.equal((await second.getCharge('abc123'))?.providerRef, 'pl_1');
    await second.close();
  });

  it('claimSettlement is exactly-once and durable', async () => {
    const path = tempDb();
    const first = new SqliteEntitlementStore({ path });
    assert.equal(await first.claimSettlement('n1'), true);
    assert.equal(await first.claimSettlement('n1'), false);
    await first.close();

    // A restart must not hand out a second claim for a payment already granted.
    const second = new SqliteEntitlementStore({ path });
    assert.equal(await second.claimSettlement('n1'), false);
    await second.close();
  });

  it('persists subject handles and their sliding window across a restart', async () => {
    const path = tempDb();
    const first = new SqliteEntitlementStore({ path });
    const record = issueSubjectRecord({ subject: 'tb_s_x', now: 1000, boundTo: 'user-1' });
    await first.putSubject(record);
    await first.putSubject(slideSubject(record, 5000));
    await first.close();

    const second = new SqliteEntitlementStore({ path });
    const got = await second.getSubject('tb_s_x');
    assert.equal(got?.createdAt, 1000, 'creation time is not rewritten by a slide');
    assert.equal(got?.lastSeenAt, 5000);
    assert.equal(got?.expiresAt, 5000 + 30 * 24 * 60 * 60 * 1000);
    assert.equal(got?.boundTo, 'user-1');
    assert.equal(await second.getSubject('tb_s_never'), undefined);
    await second.close();
  });

  it('sweeps expired pending charges', async () => {
    const store = new SqliteEntitlementStore({ path: ':memory:' });
    await store.putCharge(charge({ nonce: 'old', expiresAt: 1000 }));
    await store.putCharge(charge({ nonce: 'fresh', expiresAt: 9_999_999 }));
    assert.equal(await store.sweepExpired(5000), 1);
    assert.equal((await store.getCharge('old'))?.status, 'abandoned');
    await store.close();
  });

  it('patches only the fields given', async () => {
    const store = new SqliteEntitlementStore({ path: ':memory:' });
    await store.putCharge(charge());
    await store.updateCharge('abc123', { status: 'settled', receivedAmount: '10.00', pollCount: 4 });
    const got = await store.getCharge('abc123');
    assert.equal(got?.status, 'settled');
    assert.equal(got?.receivedAmount, '10.00');
    assert.equal(got?.pollCount, 4);
    assert.equal(got?.amount, '10.00');
    await store.close();
  });
});

describe('SqliteEntitlementStore under real cross-process contention', () => {
  it('grants exactly M credits to N competing processes', async () => {
    const WORKERS = 12;
    const CREDITS = 4;
    const path = tempDb();

    const seed = new SqliteEntitlementStore({ path });
    await seed.grant(entitlement({ remaining: CREDITS }));
    await seed.close();

    // Give every worker the same start instant so they contend for real.
    const startAt = Date.now() + 700;
    const worker = new URL('./worker-consume.mjs', import.meta.url).pathname;

    const outputs = await Promise.all(
      Array.from({ length: WORKERS }, () =>
        execFileAsync(process.execPath, [worker, path, SUBJECT, 'search', String(startAt)])
          .then((r) => r.stdout)
          .catch((e) => String(e.stdout ?? `{"ok":false,"reason":"spawn-failed"}`))
      )
    );

    const parsed = outputs.map((o) => JSON.parse(o) as { ok: boolean; reason?: string });
    const granted = parsed.filter((r) => r.ok).length;
    const threw = parsed.filter((r) => r.reason === 'threw');

    assert.deepEqual(threw, [], 'no worker may crash on a locked database');
    assert.equal(
      granted,
      CREDITS,
      `${WORKERS} processes competing for ${CREDITS} credits granted ${granted}`
    );

    const check = new SqliteEntitlementStore({ path });
    const [e] = await check.listEntitlements(SUBJECT);
    assert.equal(e?.remaining, 0, 'balance must land on exactly zero, never negative');
    assert.equal(e?.version, CREDITS);
    await check.close();
  });
});
