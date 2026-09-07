/**
 * Base for every error Tollbooth raises deliberately, so a caller can
 * distinguish "the library rejected this" from "something else went wrong".
 */
export class TollboothError extends Error {
  override readonly name: string = 'TollboothError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A tool was called without usable credit. Carries the reason so the caller can
 * decide between opening a checkout and telling the user their pass has lapsed.
 */
export class PaymentRequiredError extends TollboothError {
  override readonly name = 'PaymentRequiredError';
  constructor(
    readonly sku: string,
    readonly reason: 'no_entitlement' | 'expired' | 'insufficient_credits',
    message?: string
  ) {
    super(message ?? `payment required for ${sku} (${reason})`);
  }
}
