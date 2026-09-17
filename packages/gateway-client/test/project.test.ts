import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Charge, SettlementOutcome } from '@tollbooth/core';

import type { RawCallEvent, RawChargeOpenedEvent } from '../src/events.js';
import { chargeRefFrom, projectCall, projectChargeOpened, projectSettlement } from '../src/project.js';

/**
 * Maximally identifying raw material: the exact shapes a real handle, nonce,
 * Moove link id and checkout URL take in this codebase (see @tollbooth/core's
 * `mintSubject`/`mintNonce` and @tollbooth/moove's provider).
 */
const SUBJECT = 'tb_s_x7Qk2mP9wZbN4vRtL8hFdA';
const NONCE = 'aB3cD9eF1gH5iJ7kL2mN4oP6';
const PROVIDER_REF = 'pl_9f2a41d0c7b84e15';
const CHECKOUT_URL = `https://www.moove.xyz/pay/${PROVIDER_REF}`;

const BASE_CHARGE: Charge = {
  id: 'tb_c_1',
  nonce: NONCE,
  subject: SUBJECT,
  sku: 'search',
  amount: '10.00',
  price: {
    sku: 'search',
    unit: 'credit_pack',
    amount: '10.00',
    currency: 'USDC',
    credits: 250,
    ttlMs: null,
    label: 'Search — 250 credits',
  },
  status: 'settled',
  providerRef: PROVIDER_REF,
  checkoutUrl: CHECKOUT_URL,
  createdAt: 1_000_000,
  expiresAt: 4_600_000,
  settledAt: 1_005_000,
  receivedAmount: '10.00',
  lastPolledAt: 1_005_000,
  pollCount: 2,
};

/** Every field the wire policy forbids, and every place it could hide. */
const FORBIDDEN_VALUES = [SUBJECT, NONCE, PROVIDER_REF, CHECKOUT_URL];
/** Bare key names too, in case a future field reintroduces one under a new value. */
const FORBIDDEN_KEYS = ['subject', 'nonce', 'providerRef', 'provider_ref', 'checkoutUrl', 'checkout_url'];

function assertClean(projected: unknown, label: string): void {
  const json = JSON.stringify(projected);
  for (const forbidden of FORBIDDEN_VALUES) {
    assert.ok(!json.includes(forbidden), `${label}: leaked a forbidden value (${forbidden}) — ${json}`);
  }
  const keys = Object.keys(projected as Record<string, unknown>);
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.ok(!keys.includes(forbidden), `${label}: carried a forbidden key (${forbidden})`);
  }
}

describe('the wire policy: fingerprints, tool names, skus, amounts and timestamps only', () => {
  describe('projectSettlement — the load-bearing case: SettlementOutcome.charge carries all four', () => {
    const now = 2_000_000;

    it('never leaks the handle, nonce, link id or checkout URL, for every reported status', () => {
      const outcomes: SettlementOutcome[] = [
        { status: 'granted', charge: BASE_CHARGE, entitlementId: 'tb_e_1' },
        {
          status: 'partial',
          charge: BASE_CHARGE,
          entitlementId: 'tb_e_1',
          expected: '10.00',
          received: '5.00',
          receivedFraction: 0.5,
          credits: 125,
        },
        {
          status: 'underpaid',
          charge: BASE_CHARGE,
          expected: '10.00',
          received: '0.50',
          receivedFraction: 0.05,
        },
        { status: 'expired', charge: BASE_CHARGE },
      ];
      for (const outcome of outcomes) {
        const projected = projectSettlement(outcome, now);
        assert.ok(projected, `${outcome.status} must be reported`);
        assertClean(projected, `settlement:${outcome.status}`);
      }
    });

    it('reports nothing for pending or already_granted — no new information for the wire', () => {
      assert.equal(projectSettlement({ status: 'pending', charge: BASE_CHARGE }, now), null);
      assert.equal(projectSettlement({ status: 'already_granted', charge: BASE_CHARGE }, now), null);
    });

    it('carries exactly the allow-listed keys, nothing more', () => {
      const projected = projectSettlement({ status: 'granted', charge: BASE_CHARGE, entitlementId: 'tb_e_1' }, now)!;
      assert.deepEqual(
        Object.keys(projected).sort(),
        ['amount', 'at', 'chargeRef', 'credits', 'eventId', 'kind', 'receivedAmount', 'receivedFraction', 'sku', 'status'].sort()
      );
    });

    describe('credits granted', () => {
      it('granted (full) reads the count from the charge\'s own price snapshot, not the outcome', () => {
        const projected = projectSettlement({ status: 'granted', charge: BASE_CHARGE, entitlementId: 'e' }, now)!;
        assert.equal(projected.credits, BASE_CHARGE.price!.credits);
      });

      it('partial reads the scaled count the outcome already carries', () => {
        const projected = projectSettlement(
          { status: 'partial', charge: BASE_CHARGE, entitlementId: 'e', expected: '10.00', received: '5.00', receivedFraction: 0.5, credits: 125 },
          now
        )!;
        assert.equal(projected.credits, 125);
      });

      it('underpaid and expired granted nothing', () => {
        const underpaid = projectSettlement(
          { status: 'underpaid', charge: BASE_CHARGE, expected: '10.00', received: '0.50', receivedFraction: 0.05 },
          now
        )!;
        const expired = projectSettlement({ status: 'expired', charge: BASE_CHARGE }, now)!;
        assert.equal(underpaid.credits, null);
        assert.equal(expired.credits, null);
      });

      it('a granted settlement with no price snapshot (pre-migration charge) reports unknown, not zero', () => {
        const preMigration = { ...BASE_CHARGE, price: null };
        const projected = projectSettlement({ status: 'granted', charge: preMigration, entitlementId: 'e' }, now)!;
        assert.equal(projected.credits, null);
      });
    });

    it(
      'does not pass through a field nobody allow-listed, however it arrives — the canary for a future ' +
        'field added to Charge or SettlementOutcome and spread through by mistake',
      () => {
        // `as unknown as Charge` stands in for a future field this file's
        // type does not know about yet. If the implementation ever changes
        // to spread `charge` (or the outcome) into the wire event instead of
        // naming each field, this canary rides along and this test catches it
        // immediately — it does not need to predict what the real new field
        // would be called.
        const canaryCharge = {
          ...BASE_CHARGE,
          __leak_canary__: 'LEAK-CANARY-0f3a',
        } as unknown as Charge;
        const canaryOutcome = {
          status: 'granted' as const,
          charge: canaryCharge,
          entitlementId: 'tb_e_1',
          __leak_canary__: 'LEAK-CANARY-TOP-LEVEL',
        } as unknown as SettlementOutcome;

        const projected = projectSettlement(canaryOutcome, now)!;
        const json = JSON.stringify(projected);
        assert.ok(!json.includes('LEAK-CANARY'), `a field nobody allow-listed reached the wire: ${json}`);
        assert.ok(
          !Object.keys(projected).includes('__leak_canary__'),
          'the canary key itself must not appear on the projected event'
        );
      }
    );

    it("chargeRef is a one-way hash — not the nonce, not reversible, not a substring relationship", () => {
      const projected = projectSettlement({ status: 'granted', charge: BASE_CHARGE, entitlementId: 'e' }, now)!;
      assert.equal(projected.chargeRef, chargeRefFrom(NONCE));
      assert.notEqual(projected.chargeRef, NONCE);
      assert.match(projected.chargeRef, /^[0-9a-f]{64}$/, 'sha256 hex digest');
    });

    it('the same charge always yields the same chargeRef, so opened and settled events can be joined', () => {
      const opened = projectChargeOpened({
        tool: 'lookup_market_data',
        sku: 'search',
        nonce: NONCE,
        amount: '10.00',
        currency: 'USDC',
        at: 1_000_000,
      });
      const settled = projectSettlement({ status: 'granted', charge: BASE_CHARGE, entitlementId: 'e' }, now)!;
      assert.equal(opened.chargeRef, settled.chargeRef);
    });
  });

  describe('projectChargeOpened', () => {
    const raw: RawChargeOpenedEvent = {
      tool: 'lookup_market_data',
      sku: 'search',
      nonce: NONCE,
      amount: '10.00',
      currency: 'USDC',
      at: 1_000_000,
    };

    it('never leaks the nonce, and carries only the allow-listed keys', () => {
      const projected = projectChargeOpened(raw);
      assertClean(projected, 'charge_opened');
      assert.deepEqual(
        Object.keys(projected).sort(),
        ['amount', 'at', 'chargeRef', 'currency', 'eventId', 'kind', 'sku', 'tool'].sort()
      );
    });

    it('mints a fresh eventId per projection, for the ingest endpoint to dedupe on', () => {
      const a = projectChargeOpened(raw);
      const b = projectChargeOpened(raw);
      assert.notEqual(a.eventId, b.eventId);
    });
  });

  describe('projectCall', () => {
    const raw: RawCallEvent = {
      tool: 'lookup_market_data',
      sku: 'search',
      cost: 1,
      at: 1_000_000,
      tokenPresented: true,
      // The fingerprint format the paywall itself already produces — first 9
      // and last 4 characters. Explicitly allowed on the wire; the full
      // handle it is derived from is not, and is never passed to this
      // function at all (RawCallEvent has no field for it).
      tokenFingerprint: `${SUBJECT.slice(0, 9)}..${SUBJECT.slice(-4)}`,
      tokenRecognised: true,
      outcome: 'authorised',
    };

    it('passes the fingerprint through — explicitly allowed — and nothing else identifying', () => {
      const projected = projectCall(raw);
      assert.equal(projected.tokenFingerprint, raw.tokenFingerprint);
      // The fingerprint necessarily shares a few characters with the real
      // handle by construction; what must never appear is the handle whole.
      const json = JSON.stringify(projected);
      assert.ok(!json.includes(SUBJECT), 'the full handle must never appear, only its fingerprint');
    });

    it('carries exactly the allow-listed keys', () => {
      const projected = projectCall(raw);
      assert.deepEqual(
        Object.keys(projected).sort(),
        [
          'at',
          'cost',
          'eventId',
          'kind',
          'outcome',
          'sku',
          'tokenFingerprint',
          'tokenPresented',
          'tokenRecognised',
          'tool',
        ].sort()
      );
    });
  });
});
