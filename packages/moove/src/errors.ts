import { TollboothError } from '@tollbooth/core';

/**
 * Every documented Moove error code, mapped to a typed error carrying its
 * retry semantics.
 *
 * The rule from the API's own guidance: only 429 and 5xx are worth retrying.
 * Retrying a 4xx cannot succeed, still counts against the rate limit, and a
 * retry loop against a revoked key looks like an attack.
 */
export type MooveErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_API_KEY'
  | 'EXPIRED_API_KEY'
  | 'INSUFFICIENT_API_SCOPE'
  | 'CANNOT_FIND_PAYMENT_LINK'
  | 'PAYMENT_LINK_ACCOUNT_NOT_READY'
  | 'INVALID_PAYMENT_LINK_AMOUNT'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CANNOT_CREATE_PAYMENT_LINK'
  | 'UNKNOWN';

export class MooveError extends TollboothError {
  override readonly name: string = 'MooveError';
  constructor(
    message: string,
    readonly status: number,
    readonly code: MooveErrorCode,
    /** Whether retrying this exact request could ever succeed. */
    readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
  }
}

/** 401. The key is missing, wrong, revoked or expired. Never retry. */
export class MooveAuthError extends MooveError {
  override readonly name = 'MooveAuthError';
  constructor(message: string, code: MooveErrorCode) {
    super(message, 401, code, false);
  }
}

/** 403. The key exists but lacks the scope. Scopes are fixed at creation. */
export class MooveScopeError extends MooveError {
  override readonly name = 'MooveScopeError';
  constructor(message: string) {
    super(message, 403, 'INSUFFICIENT_API_SCOPE', false);
  }
}

/** 404. No link with that id. */
export class MooveNotFoundError extends MooveError {
  override readonly name = 'MooveNotFoundError';
  constructor(message: string) {
    super(message, 404, 'CANNOT_FIND_PAYMENT_LINK', false);
  }
}

/**
 * 409. Not a bug and not transient: the account cannot receive payments yet.
 * Surfaced with instructions, because only the tenant can fix it.
 */
export class MooveAccountNotReadyError extends MooveError {
  override readonly name = 'MooveAccountNotReadyError';
  constructor(detail?: string) {
    super(
      'This Moove account is not set up to receive payments yet, so no payment link ' +
        'can be created. The account owner needs to claim a Moove handle and set a ' +
        'default wallet at https://www.moove.xyz/dashboard, then try again. ' +
        'Retrying will not help until that is done.' +
        (detail ? ` (Moove said: ${detail})` : ''),
      409,
      'PAYMENT_LINK_ACCOUNT_NOT_READY',
      false
    );
  }
}

/** 422. Usually more decimal places than the settlement token supports. */
export class MooveAmountError extends MooveError {
  override readonly name = 'MooveAmountError';
  constructor(message: string) {
    super(message, 422, 'INVALID_PAYMENT_LINK_AMOUNT', false);
  }
}

/** 429. The only 4xx worth retrying. */
export class MooveRateLimitError extends MooveError {
  override readonly name = 'MooveRateLimitError';
  constructor(
    message: string,
    /** Seconds, if the response carried Retry-After. Moove is not known to send one. */
    readonly retryAfterSeconds: number | undefined
  ) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', true);
  }
}

/** 5xx. Retry with backoff. */
export class MooveServerError extends MooveError {
  override readonly name = 'MooveServerError';
  constructor(message: string, status: number, code: MooveErrorCode = 'CANNOT_CREATE_PAYMENT_LINK') {
    super(message, status, code, true);
  }
}

/** The body shape every failed Moove request returns. */
interface MooveErrorBody {
  errors?: { message?: string; code?: string }[];
}

/**
 * Turn an HTTP response into the right typed error. Branches on the machine
 * readable `code` where present, and falls back to status, because the docs
 * are explicit that `code` is the stable field and `message` is not.
 */
export function toMooveError(
  status: number,
  body: unknown,
  retryAfterHeader?: string | null
): MooveError {
  const parsed = (body ?? {}) as MooveErrorBody;
  const first = parsed.errors?.[0];
  const code = (first?.code ?? 'UNKNOWN') as MooveErrorCode;
  const message = first?.message ?? `Moove request failed with HTTP ${status}`;

  switch (code) {
    case 'UNAUTHENTICATED':
    case 'INVALID_API_KEY':
    case 'EXPIRED_API_KEY':
      return new MooveAuthError(message, code);
    case 'INSUFFICIENT_API_SCOPE':
      return new MooveScopeError(message);
    case 'CANNOT_FIND_PAYMENT_LINK':
      return new MooveNotFoundError(message);
    case 'PAYMENT_LINK_ACCOUNT_NOT_READY':
      return new MooveAccountNotReadyError(message);
    case 'INVALID_PAYMENT_LINK_AMOUNT':
      return new MooveAmountError(message);
    case 'RATE_LIMIT_EXCEEDED':
      return new MooveRateLimitError(message, parseRetryAfter(retryAfterHeader));
    default:
      break;
  }

  // Unrecognised code: fall back to the status class.
  if (status === 401) return new MooveAuthError(message, 'UNAUTHENTICATED');
  if (status === 403) return new MooveScopeError(message);
  if (status === 404) return new MooveNotFoundError(message);
  if (status === 409) return new MooveAccountNotReadyError(message);
  if (status === 422) return new MooveAmountError(message);
  if (status === 429) return new MooveRateLimitError(message, parseRetryAfter(retryAfterHeader));
  if (status >= 500) return new MooveServerError(message, status, code);
  return new MooveError(message, status, code, false);
}

function parseRetryAfter(header?: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, (date - Date.now()) / 1000);
  return undefined;
}
