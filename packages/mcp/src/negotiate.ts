import type { RendererSet, TokenBearingRenderer } from './challenge.js';
import { DEFAULT_COPY } from './copy.js';
import { CLASSIC_REVISIONS, createStructuredRenderer, createTextRenderer } from './renderers.js';

export interface ClientProfile {
  /** From `clientInfo.name`, when the transport supplies one. */
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  /** Negotiated protocol revision, when known. */
  readonly protocolVersion?: string | undefined;
}

export interface NegotiateOptions {
  readonly copyId?: string;
  /**
   * Renderers permitted beyond the default. Deny-by-default means an id that
   * is not on this list is never selected, however capable the client claims
   * to be.
   */
  readonly allow?: readonly string[];
}

/**
 * Choose how to render a challenge for a given client.
 *
 * **Deny-by-default.** Every client — named, unnamed, or unrecognised — gets
 * structured content plus text. Nothing is selected on the strength of a
 * capability a client advertises.
 *
 * That is a safety property, not a conservatism. The SDK does not gate
 * mechanism on capability: a server can throw a `-32042` URL elicitation at a
 * client that has never heard of one, and the client will surface a raw
 * protocol error to a user who is trying to pay. Choosing the mechanism is the
 * library's job, so the library makes the safe choice unless told otherwise in
 * writing.
 */
export function negotiate(
  client: ClientProfile = {},
  options: NegotiateOptions = {}
): RendererSet {
  const copyId = options.copyId ?? DEFAULT_COPY.id;
  const structured = createStructuredRenderer(copyId);

  // An explicit allow-list can pick a different bearer, but only from
  // renderers that carry the token — the type of `tokenBearer` sees to that.
  const allowed = options.allow ?? [];
  if (allowed.length > 0) {
    const candidates: TokenBearingRenderer[] = [structured, createTextRenderer(copyId)];
    const picked = candidates.find(
      (r) => allowed.includes(r.id) || allowed.includes(r.id.split(':')[0] ?? '')
    );
    if (picked && supportsRevision(picked, client.protocolVersion)) {
      return { tokenBearer: picked };
    }
  }

  if (!supportsRevision(structured, client.protocolVersion)) {
    // An unknown or newer revision still gets the universal floor rather than
    // nothing: a plain text result is the one thing every client can show.
    return { tokenBearer: createTextRenderer(copyId) };
  }

  return { tokenBearer: structured };
}

function supportsRevision(renderer: TokenBearingRenderer, revision?: string): boolean {
  if (!revision) return true; // stdio often reports none; assume the classic shape
  return renderer.revisions.includes(revision);
}

/** Revisions the shipped renderers were built against. */
export const SUPPORTED_REVISIONS = [...CLASSIC_REVISIONS] as const;
