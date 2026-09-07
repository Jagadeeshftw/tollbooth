import type {
  Challenge,
  RenderedUserOnly,
  RenderedWithToken,
  TokenBearingRenderer,
  UserOnlyRenderer,
} from './challenge.js';
import { DEFAULT_COPY, resolveCopy } from './copy.js';

/** Revisions whose tool results carry `content` and `structuredContent`. */
export const CLASSIC_REVISIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;

/** The stateless revision, where interim results use `resultType`. */
export const MRTR_REVISION = '2026-07-28';

function userChannel(c: Challenge, message: string): RenderedUserOnly['userChannel'] {
  return { url: c.checkoutUrl, message, consent: 'inline-text' };
}

/**
 * Text in an error result. The universal floor: it works in every client that
 * can display a tool result at all, including those with no elicitation, no
 * MCP Apps and no extensions.
 *
 * Measured 41/43 retries with the token byte-identical.
 */
export function createTextRenderer(copyId: string = DEFAULT_COPY.id): TokenBearingRenderer {
  const copy = resolveCopy(copyId);
  return {
    id: `text:${copy.id}`,
    carriesToken: true,
    revisions: [...CLASSIC_REVISIONS],
    render(challenge: Challenge): RenderedWithToken {
      const message = copy.render(challenge);
      return {
        userChannel: userChannel(challenge, message),
        modelChannel: {
          token: challenge.token,
          argumentName: challenge.argumentName,
          carrier: 'text',
          instruction: message,
        },
        content: [{ type: 'text', text: message }],
      };
    },
  };
}

/**
 * Text plus a machine-readable `structuredContent` payload. The default.
 *
 * Measured 18/18. Emitting structured content alongside the text costs
 * nothing in clients that ignore it and gives agents that parse results
 * something better than prose to work from. No `outputSchema` is required —
 * verified against the SDK on the wire.
 */
export function createStructuredRenderer(copyId: string = DEFAULT_COPY.id): TokenBearingRenderer {
  const copy = resolveCopy(copyId);
  const text = createTextRenderer(copyId);
  return {
    id: `structured:${copy.id}`,
    carriesToken: true,
    revisions: [...CLASSIC_REVISIONS],
    render(challenge: Challenge): RenderedWithToken {
      const base = text.render(challenge);
      return {
        ...base,
        modelChannel: { ...base.modelChannel, carrier: 'structured' },
        structuredContent: {
          status: 'payment_required',
          sku: challenge.sku,
          reason: challenge.reason,
          amount: challenge.amount,
          currency: challenge.currency,
          label: challenge.label,
          checkoutUrl: challenge.checkoutUrl,
          expiresAt: new Date(challenge.expiresAt).toISOString(),
          retry: {
            tool: challenge.toolName,
            argument: challenge.argumentName,
            value: challenge.token,
          },
        },
      };
    },
  };
}

/**
 * URL-mode elicitation. **Not registered, and not shipped.**
 *
 * Kept as the worked example of a {@link UserOnlyRenderer}, and as the reason
 * that type exists. In blind measurement this scored 0/10: Claude Code
 * recognises the `-32042` error, tries to run its own consent flow, and hands
 * the model exactly this and nothing else:
 *
 *     "URL elicitation was canceled by the user. The tool ... could not
 *      complete because it requires the user to open a URL."
 *
 * No URL, no token, no message. And the deeper problem is structural rather
 * than a client gap: `-32042` is a JSON-RPC *error*, so it terminates the call
 * and there is nowhere for a token to ride. Even rendered perfectly it leaves
 * the model unable to retry, which is why it is typed `carriesToken: false`
 * and cannot be used as a set's token bearer.
 *
 * @experimental Never pass this to a paywall on its own; the type forbids it.
 */
export const urlElicitationRenderer: UserOnlyRenderer = {
  id: 'url-elicitation',
  carriesToken: false,
  revisions: ['2025-11-25'],
  render(challenge: Challenge): RenderedUserOnly {
    const message = `Payment required: ${challenge.amount} ${challenge.currency}.`;
    return {
      userChannel: { url: challenge.checkoutUrl, message, consent: 'client-ui' },
      modelChannel: null,
      content: [{ type: 'text', text: message }],
    };
  },
};

/**
 * `InputRequiredResult` for spec revision 2026-07-28. **Not registered.**
 *
 * Under MRTR the server returns `resultType: "input_required"` with an
 * `inputRequests` map, and the client retries the original call carrying
 * `inputResponses` and the server's `requestState`. The token rides in
 * `requestState`, so unlike URL elicitation this *can* close the loop — which
 * is why it is a {@link TokenBearingRenderer}.
 *
 * It is unregistered because nothing can speak it yet: the TypeScript SDK's
 * `LATEST_PROTOCOL_VERSION` is `2025-11-25`, and no surveyed client implements
 * the stateless revision. The path exists so that turning it on later is a
 * registration change rather than a redesign.
 *
 * @experimental Untested against a real client. Do not register in production.
 */
export const inputRequiredRenderer: TokenBearingRenderer = {
  id: 'input-required',
  carriesToken: true,
  revisions: [MRTR_REVISION],
  render(challenge: Challenge): RenderedWithToken {
    const message = DEFAULT_COPY.render(challenge);
    return {
      userChannel: { url: challenge.checkoutUrl, message, consent: 'client-ui' },
      modelChannel: {
        token: challenge.token,
        argumentName: challenge.argumentName,
        carrier: 'request-state',
        instruction: message,
      },
      content: [{ type: 'text', text: message }],
      structuredContent: {
        resultType: 'input_required',
        inputRequests: {
          tollbooth_payment: {
            method: 'elicitation/create',
            params: { mode: 'url', url: challenge.checkoutUrl, message },
          },
        },
        requestState: { tollboothToken: challenge.token, sku: challenge.sku },
      },
    };
  },
};
