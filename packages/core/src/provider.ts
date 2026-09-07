import type { SubjectRecord } from './subjects.js';
import type { Charge, Price, Sku, Subject } from './types.js';

/**
 * What happened when we asked a payment provider whether a charge settled.
 *
 * Lives in core rather than in a provider package so that the MCP binding can
 * talk about settlement without knowing who takes the money. Adding Stripe
 * means writing a new package that satisfies {@link PaymentProvider}, not
 * touching this file.
 */
export type SettlementOutcome =
  | { status: 'pending'; charge: Charge }
  | { status: 'granted'; charge: Charge; entitlementId: string }
  | { status: 'already_granted'; charge: Charge }
  | { status: 'expired'; charge: Charge }
  /** Short, but worth something. A reduced entitlement was granted. */
  | {
      status: 'partial';
      charge: Charge;
      entitlementId: string;
      expected: string;
      received: string;
      receivedFraction: number;
      credits: number | null;
    }
  /** Too short to be worth anything. Nothing granted; left for the tenant. */
  | {
      status: 'underpaid';
      charge: Charge;
      expected: string;
      received: string;
      receivedFraction: number;
    };

/**
 * The seam every payment provider implements.
 *
 * Deliberately small: open a charge, ask whether it settled, and manage the
 * handle that identifies who owns the credits.
 */
export interface PaymentProvider {
  priceFor(sku: Sku): Price | undefined;

  listPrices(): Price[];

  openCharge(args: {
    sku: Sku;
    subject: Subject;
    toolName?: string;
  }): Promise<{ charge: Charge; checkoutUrl: string }>;

  settleCharge(nonce: string, options?: { force?: boolean }): Promise<SettlementOutcome>;

  issueSubject(boundTo?: string | null): Promise<SubjectRecord>;

  /** Look up a handle so the caller can check it is live and unforged. */
  getSubjectRecord(subject: Subject): Promise<SubjectRecord | undefined>;

  touchSubject(subject: Subject): Promise<void>;
}
