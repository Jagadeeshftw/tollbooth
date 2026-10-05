import {
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

export const PACK: Price = definePrice({
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
export class StubProvider implements PaymentProvider {
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
      price: PACK,
      tool: args.toolName ?? null,
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
