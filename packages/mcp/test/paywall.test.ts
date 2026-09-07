import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MemoryEntitlementStore,
  definePrice,
  entitlementFromPrice,
  issueSubjectRecord,
  mintChargeId,
  mintEntitlementId,
  mintNonce,
  mintSubject,
  slideSubject,
} from '@tollbooth/core';
import type {
  Charge,
  EntitlementStore,
  PaymentProvider,
  Price,
  SettlementOutcome,
  Sku,
  Subject,
  SubjectRecord,
} from '@tollbooth/core';

import type { ChallengeResult } from '../src/challenge.js';
import { Paywall, withPaywall } from '../src/paywall.js';
import type { RegisterableServer } from '../src/paywall.js';

const PACK: Price = definePrice({
  sku: 'search',
  unit: 'credit_pack',
  amount: '10.00',
  credits: 250,
  label: 'Search — 250 credits',
});

/**
 * A provider with no network in it. Exercises the paywall against the seam
 * rather than against Moove, which is the point of the seam existing.
 */
class StubProvider implements PaymentProvider {
  paid = false;
  charges = 0;
  constructor(
    readonly store: EntitlementStore,
    private now: () => number = () => 1_000_000
  ) {}

  priceFor(sku: Sku) {
    return sku === PACK.sku ? PACK : undefined;
  }
  listPrices() {
    return [PACK];
  }
  async issueSubject(boundTo: string | null = null): Promise<SubjectRecord> {
    const record = issueSubjectRecord({ subject: mintSubject(), now: this.now(), boundTo });
    await this.store.putSubject(record);
    return record;
  }
  async getSubjectRecord(subject: Subject) {
    return this.store.getSubject(subject);
  }
  async touchSubject(subject: Subject) {
    const r = await this.store.getSubject(subject);
    if (r) await this.store.putSubject(slideSubject(r, this.now()));
  }
  async openCharge(args: { sku: Sku; subject: Subject; toolName?: string }) {
    this.charges++;
    const charge: Charge = {
      id: mintChargeId(),
      nonce: mintNonce(),
      subject: args.subject,
      sku: args.sku,
      amount: PACK.amount,
      status: 'pending',
      providerRef: 'pl_stub',
      checkoutUrl: 'https://www.moove.xyz/pay/pl_stub',
      createdAt: this.now(),
      expiresAt: this.now() + 3_600_000,
      settledAt: null,
      receivedAmount: null,
      lastPolledAt: null,
      pollCount: 0,
    };
    await this.store.putCharge(charge);
    return { charge, checkoutUrl: charge.checkoutUrl! };
  }
  async settleCharge(nonce: string): Promise<SettlementOutcome> {
    const charge = await this.store.getCharge(nonce);
    if (!charge) throw new Error('no charge');
    if (!this.paid) return { status: 'pending', charge };
    if (!(await this.store.claimSettlement(nonce))) return { status: 'already_granted', charge };
    const entitlement = entitlementFromPrice({
      price: PACK,
      subject: charge.subject,
      chargeId: charge.id,
      entitlementId: mintEntitlementId(),
      now: this.now(),
    });
    await this.store.grant(entitlement);
    await this.store.updateCharge(nonce, { status: 'settled', settledAt: this.now() });
    return { status: 'granted', charge, entitlementId: entitlement.id };
  }
}

function setup() {
  const store = new MemoryEntitlementStore();
  const provider = new StubProvider(store);
  const gate = new Paywall({ provider, store }, 'tollboothToken', () => 1_000_000);
  return { store, provider, gate };
}

const call = { sku: 'search', cost: 1, toolName: 'lookup_market_data' };

type Decision = { ok: true } | { ok: false; result: ChallengeResult };

/** Assert a decision was a challenge, and hand back its result. */
function challengeOf(decision: Decision): ChallengeResult {
  assert.equal(decision.ok, false, 'expected a payment challenge');
  return (decision as { ok: false; result: ChallengeResult }).result;
}

function tokenFrom(result: ChallengeResult): string {
  const meta = result._meta?.['xyz.tollbooth/challenge'] as Record<string, unknown>;
  const sc = result.structuredContent as { retry?: { value?: string } } | undefined;
  const token = sc?.retry?.value;
  assert.ok(typeof token === 'string', 'the challenge must carry a token');
  assert.ok(meta['checkoutUrl'], 'and a checkout URL');
  return token;
}

describe('the challenge-and-retry loop', () => {
  it('challenges an unpaid first call and opens exactly one charge', async () => {
    const { gate, provider } = setup();
    const first = await gate.authorise({ ...call, token: undefined });
    assert.equal(first.ok, false);
    assert.equal(provider.charges, 1);
    const token = tokenFrom(challengeOf(first));
    assert.match(token, /^tb_s_/);
  });

  it('re-challenges with the same charge and token while unpaid', async () => {
    const { gate, provider } = setup();
    const first = await gate.authorise({ ...call, token: undefined });
    const token = tokenFrom(challengeOf(first));

    const second = await gate.authorise({ ...call, token });
    assert.equal(second.ok, false);
    assert.equal(
      tokenFrom(challengeOf(second)),
      token,
      'a retry must not mint a second handle'
    );
    assert.equal(provider.charges, 1, 'nor open a second checkout for the same purchase');
  });

  it('settles and runs the tool once the human has paid', async () => {
    const { gate, provider } = setup();
    const first = await gate.authorise({ ...call, token: undefined });
    const token = tokenFrom(challengeOf(first));

    provider.paid = true;
    const after = await gate.authorise({ ...call, token });
    assert.equal(after.ok, true, 'the retry after payment must be authorised');
  });

  it('spends one credit per call and challenges again when exhausted', async () => {
    const { gate, provider, store } = setup();
    const first = await gate.authorise({ ...call, token: undefined });
    const token = tokenFrom(challengeOf(first));
    provider.paid = true;

    for (let i = 0; i < 250; i++) {
      assert.equal((await gate.authorise({ ...call, token })).ok, true, `call ${i}`);
    }
    const [e] = await store.listEntitlements(token);
    assert.equal(e?.remaining, 0);

    provider.paid = false;
    const exhausted = await gate.authorise({ ...call, token });
    assert.equal(exhausted.ok, false, 'a spent pack must challenge again');
  });

  it('charges the configured cost for an expensive tool', async () => {
    const { gate, provider, store } = setup();
    const first = await gate.authorise({ ...call, token: undefined });
    const token = tokenFrom(challengeOf(first));
    provider.paid = true;

    await gate.authorise({ ...call, token, cost: 25 });
    const [e] = await store.listEntitlements(token);
    assert.equal(e?.remaining, 225);
  });

  it('slides the handle forward on every successful call', async () => {
    const { gate, provider, store } = setup();
    const first = await gate.authorise({ ...call, token: undefined });
    const token = tokenFrom(challengeOf(first));
    provider.paid = true;

    const before = (await store.getSubject(token))!.expiresAt;
    await gate.authorise({ ...call, token });
    const after = (await store.getSubject(token))!.expiresAt;
    assert.ok(after >= before, 'use extends the window');
  });
});

describe('handle handling', () => {
  it('issues a fresh handle when an unknown one is presented', async () => {
    const { gate } = setup();
    const result = await gate.authorise({ ...call, token: 'tb_s_forged_or_expired' });
    assert.equal(result.ok, false);
    const token = tokenFrom(challengeOf(result));
    assert.notEqual(token, 'tb_s_forged_or_expired', 'a forged handle buys nothing');
  });

  it('refuses a bound handle presented by a different principal', async () => {
    const store = new MemoryEntitlementStore();
    const provider = new StubProvider(store);
    const gate = new Paywall({ provider, store }, 'tollboothToken', () => 1_000_000);

    const first = await gate.authorise({ ...call, token: undefined, principal: 'user-a' });
    const token = tokenFrom(challengeOf(first));
    provider.paid = true;

    // The rightful owner can spend.
    assert.equal((await gate.authorise({ ...call, token, principal: 'user-a' })).ok, true);
    // Somebody who found the handle in a transcript cannot.
    const stolen = await gate.authorise({ ...call, token, principal: 'user-b' });
    assert.equal(stolen.ok, false, 'a bound handle is worthless to anyone else');
  });

  it('does not leak the handle of one caller to another', async () => {
    const { gate } = setup();
    const a = tokenFrom(challengeOf(await gate.authorise({ ...call, token: undefined })));
    const b = tokenFrom(challengeOf(await gate.authorise({ ...call, token: undefined })));
    assert.notEqual(a, b);
  });
});

describe('withPaywall registration', () => {
  class FakeServer implements RegisterableServer {
    tools: { name: string; config: Record<string, unknown>; handler: Function }[] = [];
    registerTool(name: string, config: Record<string, unknown>, handler: Function) {
      this.tools.push({ name, config, handler });
      return { name };
    }
  }

  it('adds the token argument and marks the tool as paid', () => {
    const store = new MemoryEntitlementStore();
    const provider = new StubProvider(store);
    const server = withPaywall(new FakeServer(), { provider, store, now: () => 1_000_000 });
    server.paidTool('search_web', 'Search the web', 'search', {}, {}, async () => ({}));

    const tool = (server as unknown as FakeServer).tools[0]!;
    assert.ok('tollboothToken' in (tool.config['inputSchema'] as object));
    const annotations = tool.config['annotations'] as Record<string, unknown>;
    assert.equal(annotations['xyz.tollbooth/paid'], true);
    assert.equal(annotations['xyz.tollbooth/sku'], 'search');
  });

  it('refuses to register a tool for a sku nobody sells', () => {
    const store = new MemoryEntitlementStore();
    const provider = new StubProvider(store);
    const server = withPaywall(new FakeServer(), { provider, store, now: () => 1_000_000 });
    assert.throws(
      () => server.paidTool('x', 'y', 'not-for-sale', {}, {}, async () => ({})),
      /does not sell/
    );
  });

  it('never invokes the handler on an unpaid call, and strips the token when it does', async () => {
    const store = new MemoryEntitlementStore();
    const provider = new StubProvider(store);
    const server = withPaywall(new FakeServer(), { provider, store, now: () => 1_000_000 });

    let seen: Record<string, unknown> | undefined;
    server.paidTool('search_web', 'Search', 'search', {}, {}, async (args) => {
      seen = args;
      return { content: [] };
    });
    const handler = (server as unknown as FakeServer).tools[0]!.handler;

    const challenge = (await handler({ query: 'hello' }, {})) as ChallengeResult;
    assert.equal(challenge.isError, true);
    assert.equal(seen, undefined, 'the handler must not run for an unpaid call');

    const token = tokenFrom(challenge);
    provider.paid = true;
    await handler({ query: 'hello', tollboothToken: token }, {});
    assert.deepEqual(seen, { query: 'hello' }, 'the token is not passed through to the tool');
  });
});
