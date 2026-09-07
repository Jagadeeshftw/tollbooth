import assert from 'node:assert/strict';
import { setImmediate as yieldTick } from 'node:timers/promises';
import { after, describe, it } from 'node:test';

import {
  decideSettlement,
  definePrice,
  entitlementFromPrice,
  issueSubjectRecord,
  slideSubject,
} from '@tollbooth/core';
import type { Charge, Entitlement, EntitlementStore, Price } from '@tollbooth/core';

/**
 * The behaviour every {@link EntitlementStore} must have.
 *
 * These are the contracts that lose money when they are wrong, so they are
 * written once and run against every implementation rather than re-derived per
 * package. A store that passes this suite is safe to put in front of payments;
 * one that does not is not, however well its own tests read.
 */

export interface StoreHarness {
  /** Shown in test names. */
  readonly name: string;

  /** A fresh, empty store. */
  create(options?: { now?: () => number }): Promise<EntitlementStore>;

  /**
   * Close `store` and reopen the same underlying storage. Omit for stores that
   * cannot be durable; the durability tests are then skipped rather than faked.
   */
  reopen?(store: EntitlementStore): Promise<EntitlementStore>;

  /**
   * Run one `consume` in a *separate process* against the same storage.
   * Provide this and the cross-process contention test runs; omit it and the
   * suite says so out loud rather than quietly passing.
   */
  spawnConsumers?(args: {
    store: EntitlementStore;
    count: number;
    subject: string;
    sku: string;
  }): Promise<{ ok: boolean }[]>;

  /**
   * A store whose consume yields between reading and writing, so a test can
   * force the interleaving a read-then-write implementation loses to. Stores
   * that get atomicity from a database transaction do not need this.
   */
  createWithForcedInterleaving?(hook: () => Promise<void>): Promise<EntitlementStore>;

  cleanup?(): Promise<void>;
}

const SUBJECT = 'tb_s_conformance';

const PACK: Price = definePrice({
  sku: 'search',
  unit: 'credit_pack',
  amount: '10.00',
  credits: 250,
  label: 'Search — 250 credits',
});

export function entitlement(over: Partial<Entitlement> = {}): Entitlement {
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

export function charge(over: Partial<Charge> = {}): Charge {
  return {
    id: 'tb_c_1',
    nonce: 'nonce-1',
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

/** Barrier that releases once `parties` callers have arrived. */
export function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((r) => (release = r));
  let tripped = false;
  return async () => {
    if (tripped) return;
    if (++arrived >= parties) {
      tripped = true;
      release();
      return;
    }
    await open;
  };
}

export function runStoreConformance(harness: StoreHarness): void {
  const open: EntitlementStore[] = [];
  const track = async (s: EntitlementStore) => {
    open.push(s);
    return s;
  };
  const make = async (options?: { now?: () => number }) => track(await harness.create(options));

  after(async () => {
    for (const s of open) await s.close().catch(() => undefined);
    await harness.cleanup?.();
  });

  // ------------------------------------------------------------ consume

  describe(`${harness.name}: consume across the three pricing units`, () => {
    it('per_call spends once and then refuses', async () => {
      const store = await make({ now: () => 1000 });
      const price = definePrice({ sku: 'once', unit: 'per_call', amount: '0.05' });
      await store.grant(
        entitlementFromPrice({ price, subject: SUBJECT, chargeId: 'c', entitlementId: 'e1', now: 1000 })
      );
      assert.equal((await store.consume(SUBJECT, 'once')).ok, true);
      const second = await store.consume(SUBJECT, 'once');
      assert.equal(second.ok, false);
      assert.equal((second as { reason: string }).reason, 'insufficient_credits');
    });

    it('credit_pack spends N times', async () => {
      const store = await make({ now: () => 1000 });
      const price = definePrice({ sku: 'pack', unit: 'credit_pack', amount: '10.00', credits: 3 });
      await store.grant(
        entitlementFromPrice({ price, subject: SUBJECT, chargeId: 'c', entitlementId: 'e2', now: 1000 })
      );
      for (let i = 0; i < 3; i++) {
        assert.equal((await store.consume(SUBJECT, 'pack')).ok, true, `call ${i}`);
      }
      assert.equal((await store.consume(SUBJECT, 'pack')).ok, false);
    });

    it('time_pass is unlimited until it expires', async () => {
      let now = 1000;
      const store = await make({ now: () => now });
      const price = definePrice({ sku: 'day', unit: 'time_pass', amount: '10.00', ttlMs: 60_000 });
      await store.grant(
        entitlementFromPrice({ price, subject: SUBJECT, chargeId: 'c', entitlementId: 'e3', now })
      );
      for (let i = 0; i < 20; i++) {
        const r = await store.consume(SUBJECT, 'day');
        assert.equal(r.ok, true, `call ${i}`);
        assert.equal((r as { remaining: number | null }).remaining, null);
      }
      now = 1000 + 60_000;
      const lapsed = await store.consume(SUBJECT, 'day');
      assert.equal(lapsed.ok, false);
      assert.equal((lapsed as { reason: string }).reason, 'expired');
    });

    it('cost greater than one is all-or-nothing', async () => {
      const store = await make();
      await store.grant(entitlement({ id: 'e4', remaining: 3 }));
      const tooBig = await store.consume(SUBJECT, 'search', 5);
      assert.equal(tooBig.ok, false);
      const [after1] = await store.listEntitlements(SUBJECT);
      assert.equal(after1?.remaining, 3, 'a rejected consume must not partially spend');
      assert.equal((await store.consume(SUBJECT, 'search', 3)).ok, true);
    });

    it('distinguishes never-bought, spent and lapsed', async () => {
      const store = await make({ now: () => 10_000 });
      assert.equal(
        ((await store.consume(SUBJECT, 'nothing')) as { reason: string }).reason,
        'no_entitlement'
      );
      await store.grant(entitlement({ id: 'spent', sku: 'a', remaining: 0 }));
      assert.equal(
        ((await store.consume(SUBJECT, 'a')) as { reason: string }).reason,
        'insufficient_credits'
      );
      await store.grant(entitlement({ id: 'lapsed', sku: 'b', remaining: 5, expiresAt: 1 }));
      assert.equal(((await store.consume(SUBJECT, 'b')) as { reason: string }).reason, 'expired');
    });

    it('spends a valid pass before a credit pack', async () => {
      const store = await make({ now: () => 1000 });
      await store.grant(entitlement({ id: 'pack', remaining: 5, expiresAt: null }));
      await store.grant(entitlement({ id: 'pass', remaining: null, expiresAt: 50_000 }));
      await store.consume(SUBJECT, 'search');
      const pack = (await store.listEntitlements(SUBJECT)).find((e) => e.id === 'pack');
      assert.equal(pack?.remaining, 5, 'credits must not be burned while a pass is valid');
    });
  });

  // ------------------------------------------------------------ double spend

  describe(`${harness.name}: consume is atomic`, () => {
    it('N concurrent calls against M credits grant exactly M', async () => {
      const RACERS = 40;
      const CREDITS = 10;
      const store = await make();
      await store.grant(entitlement({ id: 'race', remaining: CREDITS }));

      const results = await Promise.all(
        Array.from({ length: RACERS }, async () => {
          await yieldTick();
          return store.consume(SUBJECT, 'search');
        })
      );

      const granted = results.filter((r) => r.ok).length;
      assert.equal(granted, CREDITS, `expected exactly ${CREDITS}, got ${granted}`);
      const [left] = await store.listEntitlements(SUBJECT);
      assert.equal(left?.remaining, 0, 'balance must land on zero, never negative');
    });

    const forced = harness.createWithForcedInterleaving;
    if (forced) {
      it('two calls forced to interleave cannot spend the same credit', async () => {
        const store = await track(await forced(barrier(2)));
        await store.grant(entitlement({ id: 'forced', remaining: 1 }));

        const [a, b] = await Promise.all([
          store.consume(SUBJECT, 'search'),
          store.consume(SUBJECT, 'search'),
        ]);
        assert.equal([a, b].filter((r) => r.ok).length, 1, 'exactly one may succeed');
        const [left] = await store.listEntitlements(SUBJECT);
        assert.equal(left?.remaining, 0);
      });
    }

    const spawn = harness.spawnConsumers;
    if (spawn) {
      it('separate processes competing for M credits grant exactly M', async () => {
        const WORKERS = 12;
        const CREDITS = 4;
        const store = await make();
        await store.grant(entitlement({ id: 'xproc', remaining: CREDITS }));

        const results = await spawn({
          store,
          count: WORKERS,
          subject: SUBJECT,
          sku: 'search',
        });
        const granted = results.filter((r) => r.ok).length;
        const broken = results.filter(
          (r) => !r.ok && (r as { reason?: string }).reason !== 'insufficient_credits'
        );
        assert.deepEqual(
          broken,
          [],
          `no worker may crash; got ${JSON.stringify(broken.slice(0, 3))}`
        );
        assert.equal(
          granted,
          CREDITS,
          `${WORKERS} processes competing for ${CREDITS} credits granted ${granted}`
        );

        const reopened = harness.reopen ? await track(await harness.reopen(store)) : store;
        const [left] = await reopened.listEntitlements(SUBJECT);
        assert.equal(left?.remaining, 0, 'balance must land on exactly zero');
      });
    }
  });

  // ------------------------------------------------------------ exactly once

  describe(`${harness.name}: claimSettlement is exactly-once`, () => {
    it('returns true to the first caller only', async () => {
      const store = await make();
      assert.equal(await store.claimSettlement('n1'), true);
      assert.equal(await store.claimSettlement('n1'), false);
      assert.equal(await store.claimSettlement('n1'), false);
    });

    it('lets exactly one of many concurrent claimants through', async () => {
      const store = await make();
      const claims = await Promise.all(
        Array.from({ length: 32 }, async () => {
          await yieldTick();
          return store.claimSettlement('contended');
        })
      );
      assert.equal(claims.filter(Boolean).length, 1, 'only one observer may grant');
    });

    it('treats distinct nonces independently', async () => {
      const store = await make();
      assert.equal(await store.claimSettlement('a'), true);
      assert.equal(await store.claimSettlement('b'), true);
      assert.equal(await store.claimSettlement('a'), false);
    });
  });

  // ------------------------------------------------------------ charges

  describe(`${harness.name}: charge bookkeeping`, () => {
    it('round-trips and patches only the fields given', async () => {
      const store = await make();
      await store.putCharge(charge());
      assert.equal((await store.getCharge('nonce-1'))?.providerRef, 'pl_1');

      await store.updateCharge('nonce-1', {
        status: 'settled',
        settledAt: 5000,
        receivedAmount: '10.00',
        pollCount: 4,
      });
      const got = await store.getCharge('nonce-1');
      assert.equal(got?.status, 'settled');
      assert.equal(got?.receivedAmount, '10.00');
      assert.equal(got?.pollCount, 4);
      assert.equal(got?.sku, 'search', 'untouched fields survive');
    });

    it('lists only pending charges', async () => {
      const store = await make();
      await store.putCharge(charge({ nonce: 'p1' }));
      await store.putCharge(charge({ nonce: 'p2' }));
      await store.putCharge(charge({ nonce: 's1', status: 'settled' }));
      const pending = await store.pendingCharges();
      assert.deepEqual(pending.map((c) => c.nonce).sort(), ['p1', 'p2']);
    });

    it('sweeps expired pending charges to abandoned', async () => {
      const store = await make();
      await store.putCharge(charge({ nonce: 'old', expiresAt: 1000 }));
      await store.putCharge(charge({ nonce: 'fresh', expiresAt: 9_999_999 }));
      assert.equal(await store.sweepExpired(5000), 1);
      assert.equal((await store.getCharge('old'))?.status, 'abandoned');
      assert.equal((await store.getCharge('fresh'))?.status, 'pending');
    });

    it('returns undefined for a nonce it never saw', async () => {
      const store = await make();
      assert.equal(await store.getCharge('never'), undefined);
    });
  });

  // ------------------------------------------------------------ subjects

  describe(`${harness.name}: subject handles`, () => {
    it('round-trips and slides in place without rewriting creation time', async () => {
      const store = await make();
      const record = issueSubjectRecord({ subject: 'tb_s_x', now: 1000, boundTo: 'user-1' });
      await store.putSubject(record);
      await store.putSubject(slideSubject(record, 5000));

      const got = await store.getSubject('tb_s_x');
      assert.equal(got?.createdAt, 1000);
      assert.equal(got?.lastSeenAt, 5000);
      assert.equal(got?.expiresAt, 5000 + 30 * 24 * 60 * 60 * 1000);
      assert.equal(got?.boundTo, 'user-1');
    });

    it('returns undefined for a handle it never issued', async () => {
      const store = await make();
      assert.equal(await store.getSubject('tb_s_forged'), undefined);
    });
  });

  // ------------------------------------------------------------ settlement zones

  describe(`${harness.name}: underpayment zones persist correctly`, () => {
    /** Apply what MooveProvider would do for a given received amount. */
    async function settle(store: EntitlementStore, received: string, nonce: string) {
      await store.putCharge(charge({ nonce, amount: PACK.amount }));
      const decision = decideSettlement({ expected: PACK.amount, received, price: PACK });
      if (decision.kind === 'reject') {
        await store.updateCharge(nonce, { receivedAmount: received });
        return decision;
      }
      assert.equal(await store.claimSettlement(nonce), true);
      const granted: Price =
        decision.kind === 'full'
          ? PACK
          : { ...PACK, credits: decision.credits, ttlMs: decision.ttlMs };
      await store.grant(
        entitlementFromPrice({
          price: granted,
          subject: SUBJECT,
          chargeId: nonce,
          entitlementId: `e_${nonce}`,
          now: 1000,
        })
      );
      await store.updateCharge(nonce, {
        status: 'settled',
        settledAt: 1000,
        receivedAmount: received,
      });
      return decision;
    }

    it('inside the tolerance band grants the full pack and closes the charge', async () => {
      const store = await make({ now: () => 1000 });
      const d = await settle(store, '9.99', 'z1');
      assert.equal(d.kind, 'full');
      assert.equal((await store.listEntitlements(SUBJECT))[0]?.remaining, 250);
      assert.equal((await store.getCharge('z1'))?.status, 'settled');
    });

    it('below the band grants pro rata and closes the charge', async () => {
      const store = await make({ now: () => 1000 });
      const d = await settle(store, '5.00', 'z2');
      assert.equal(d.kind, 'pro_rata');
      assert.equal((await store.listEntitlements(SUBJECT))[0]?.remaining, 125);
      assert.equal(
        (await store.getCharge('z2'))?.status,
        'settled',
        'a pro-rata settlement must not stay open forever'
      );
    });

    it('below the floor grants nothing and leaves the charge pending', async () => {
      const store = await make({ now: () => 1000 });
      const d = await settle(store, '0.50', 'z3');
      assert.equal(d.kind, 'reject');
      assert.equal((await store.listEntitlements(SUBJECT)).length, 0, 'nothing may be granted');
      assert.equal(
        (await store.getCharge('z3'))?.status,
        'pending',
        'it must keep surfacing for the tenant'
      );
      assert.equal((await store.getCharge('z3'))?.receivedAmount, '0.50');
    });
  });

  // ------------------------------------------------------------ durability

  const reopen = harness.reopen;
  if (reopen) {
    describe(`${harness.name}: survives a restart`, () => {
      it('keeps balances, charges and handles', async () => {
        const first = await make();
        await first.grant(entitlement({ id: 'durable', remaining: 7 }));
        await first.consume(SUBJECT, 'search');
        await first.putCharge(charge({ nonce: 'kept' }));
        await first.putSubject(issueSubjectRecord({ subject: 'tb_s_kept', now: 1000 }));

        const second = await track(await reopen(first));
        const [e] = await second.listEntitlements(SUBJECT);
        assert.equal(e?.remaining, 6, 'a paid-for balance must survive the process that wrote it');
        assert.equal((await second.getCharge('kept'))?.providerRef, 'pl_1');
        assert.equal((await second.getSubject('tb_s_kept'))?.createdAt, 1000);
      });

      it('does not hand out a second claim for an already-granted payment', async () => {
        const first = await make();
        assert.equal(await first.claimSettlement('durable-nonce'), true);
        const second = await track(await reopen(first));
        assert.equal(
          await second.claimSettlement('durable-nonce'),
          false,
          'a restart must not let one payment be granted twice'
        );
      });
    });
  } else {
    describe(`${harness.name}: durability`, () => {
      it('is not claimed by this store', () => {
        assert.equal(harness.reopen, undefined);
      });
    });
  }
}
