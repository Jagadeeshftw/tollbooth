import type { Subject } from './types.js';

/**
 * The lifetime of the handle an agent carries back as a tool argument.
 *
 * The handle is a bearer credential. It will sit in a model's context window,
 * be written to logs, and end up in transcripts people paste around, so it has
 * to expire. But it is also the only thing that identifies the owner of paid
 * credits: MCP offers no stable caller identity, and there is no account to
 * recover from. A short fixed expiry would strand credits somebody paid for,
 * with no way to get them back.
 *
 * So the window slides. Every successful use pushes it forward. A handle in an
 * abandoned transcript goes dead {@link DEFAULT_SUBJECT_TTL_MS} after it was
 * last used, while somebody actively spending credits never loses them.
 *
 * The charge handle is the opposite case and expires hard: a nonce is tied to
 * one checkout and dies with the link.
 */
export const DEFAULT_SUBJECT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding

/** Below this a sliding window is short enough to strand an ordinary user. */
export const MIN_SUBJECT_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface SubjectRecord {
  readonly subject: Subject;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  /** Slides forward on every use. */
  readonly expiresAt: number;
  /**
   * Optional binding to a verified identity, when the transport supplies one
   * (an OAuth `sub` on authenticated Streamable HTTP). When set, the handle
   * alone is not enough: it must be presented by the same principal.
   */
  readonly boundTo: string | null;
}

export function assertValidSubjectTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < MIN_SUBJECT_TTL_MS) {
    throw new RangeError(
      `subject TTL must be at least ${MIN_SUBJECT_TTL_MS}ms (1 hour); received ${ttlMs}. ` +
        'Shorter windows strand credits that have already been paid for, because MCP ' +
        'gives no identity to recover them with.'
    );
  }
}

export function issueSubjectRecord(args: {
  subject: Subject;
  now: number;
  ttlMs?: number;
  boundTo?: string | null;
}): SubjectRecord {
  const ttlMs = args.ttlMs ?? DEFAULT_SUBJECT_TTL_MS;
  assertValidSubjectTtl(ttlMs);
  return {
    subject: args.subject,
    createdAt: args.now,
    lastSeenAt: args.now,
    expiresAt: args.now + ttlMs,
    boundTo: args.boundTo ?? null,
  };
}

export function isSubjectLive(record: SubjectRecord, now: number): boolean {
  return now < record.expiresAt;
}

/** Slide the window forward. Returns the record to persist. */
export function slideSubject(record: SubjectRecord, now: number, ttlMs?: number): SubjectRecord {
  const window = ttlMs ?? DEFAULT_SUBJECT_TTL_MS;
  assertValidSubjectTtl(window);
  return { ...record, lastSeenAt: now, expiresAt: now + window };
}

/**
 * Whether a presented handle may be used by this caller. A handle bound to a
 * verified principal is refused when presented by anyone else, which limits
 * what a leaked transcript is worth on an authenticated transport.
 */
export function mayUseSubject(
  record: SubjectRecord,
  now: number,
  presentedBy: string | null = null
): boolean {
  if (!isSubjectLive(record, now)) return false;
  if (record.boundTo !== null && record.boundTo !== presentedBy) return false;
  return true;
}
