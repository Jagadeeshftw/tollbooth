/**
 * @tollbooth/core — the entitlement model.
 *
 * This package deliberately has no dependency on any payment provider and no
 * dependency on MCP. That seam is enforced in CI by scripts/check-boundaries.mjs,
 * because it is what lets a second provider be added without touching the model.
 */

export {
  InvalidDecimalError,
  compareDecimal,
  decimalGte,
  decimalScale,
  isPositiveDecimal,
  parseDecimal,
  toFixedScale,
} from './decimal.js';
export type { Decimal } from './decimal.js';

export { PaymentRequiredError, TollboothError } from './errors.js';

export {
  handlesEqual,
  mintChargeId,
  mintEntitlementId,
  mintNonce,
  mintSubject,
} from './ids.js';

export {
  InvalidPriceError,
  MIN_CREDIT_PACK_AMOUNT,
  definePrice,
  entitlementFromPrice,
  isUsable,
} from './pricing.js';
export type { DefinePriceInput } from './pricing.js';

export type { EntitlementStore } from './store.js';

export type {
  Charge,
  ChargeStatus,
  ConsumeFailure,
  ConsumeResult,
  Entitlement,
  Price,
  PricingUnit,
  Sku,
  Subject,
} from './types.js';
