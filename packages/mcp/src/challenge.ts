import type { ConsumeFailure, Sku } from '@tollbooth/core';

/** Everything a renderer needs to put a paywall in front of a caller. */
export interface Challenge {
  readonly sku: Sku;
  readonly toolName: string;
  readonly amount: string;
  readonly currency: string;
  readonly label: string;
  readonly checkoutUrl: string;
  /** The handle the agent must carry back. */
  readonly token: string;
  /** The tool argument it goes in. */
  readonly argumentName: string;
  readonly reason: ConsumeFailure;
  readonly expiresAt: number;
}

/**
 * The half of a challenge a human acts on.
 *
 * `client-ui` means the client is expected to render its own consent surface
 * (an open-this-URL prompt). `inline-text` means the URL is in the message and
 * the user clicks or copies it themselves.
 */
export interface UserChannel {
  readonly url: string;
  readonly message: string;
  readonly consent: 'client-ui' | 'inline-text';
}

/**
 * The half of a challenge the *model* acts on: the token it must send back,
 * and the instruction telling it to.
 *
 * This is the half that decides whether the loop can close. A mechanism that
 * shows a user a URL but leaves the model with no handle cannot be retried,
 * which is why {@link UserOnlyRenderer} exists as a distinct type.
 */
export interface ModelChannel {
  readonly token: string;
  readonly argumentName: string;
  readonly carrier: 'structured' | 'text' | 'request-state';
  readonly instruction: string;
}

export interface ContentBlock {
  readonly type: 'text';
  readonly text: string;
}

interface RenderedBase {
  readonly userChannel: UserChannel;
  readonly content: ContentBlock[];
  readonly structuredContent?: Record<string, unknown>;
}

/** What a token-bearing renderer produces. */
export interface RenderedWithToken extends RenderedBase {
  readonly modelChannel: ModelChannel;
}

/** What a user-only renderer produces. Note `modelChannel: null`. */
export interface RenderedUserOnly extends RenderedBase {
  readonly modelChannel: null;
}

export type RenderedChallenge = RenderedWithToken | RenderedUserOnly;

/**
 * A renderer that gets the token back to the model. Only these can close the
 * challenge-and-retry loop on their own.
 */
export interface TokenBearingRenderer {
  readonly id: string;
  readonly carriesToken: true;
  /** Spec revisions this renderer is valid for. */
  readonly revisions: readonly string[];
  render(challenge: Challenge): RenderedWithToken;
}

/**
 * A renderer that reaches the user but leaves the model with nothing.
 *
 * URL-mode elicitation is the worked example: in measurement it delivered no
 * URL, no token and no message to the model, so a challenge built from one of
 * these alone is unretryable. The type keeps that from being a matter of
 * discipline — {@link RendererSet} will not accept one in the token-bearing
 * slot, so it is a compile error rather than a runtime surprise.
 */
export interface UserOnlyRenderer {
  readonly id: string;
  readonly carriesToken: false;
  readonly revisions: readonly string[];
  render(challenge: Challenge): RenderedUserOnly;
}

export type ChallengeRenderer = TokenBearingRenderer | UserOnlyRenderer;

/**
 * The renderers used for one challenge.
 *
 * `tokenBearer` is required and its type admits only a
 * {@link TokenBearingRenderer}. That is the constraint: there is no way to
 * assemble a challenge out of user-only renderers, because the only slot that
 * makes a set valid refuses them.
 */
export interface RendererSet {
  readonly tokenBearer: TokenBearingRenderer;
  /** Extras that add a user-facing surface. Never sufficient alone. */
  readonly userOnly?: readonly UserOnlyRenderer[];
}

/** The tool result shape Tollbooth returns for an unpaid call. */
export interface ChallengeResult {
  readonly isError: true;
  readonly content: ContentBlock[];
  readonly structuredContent?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

/**
 * Merge a renderer set into one tool result.
 *
 * The token-bearing renderer supplies the content and structured payload; any
 * user-only renderers may add to the user-facing surface but can never be the
 * reason a challenge is retryable.
 */
export function composeChallenge(set: RendererSet, challenge: Challenge): ChallengeResult {
  const primary = set.tokenBearer.render(challenge);

  const content = [...primary.content];
  for (const extra of set.userOnly ?? []) {
    content.push(...extra.render(challenge).content);
  }

  return {
    isError: true,
    content,
    ...(primary.structuredContent ? { structuredContent: primary.structuredContent } : {}),
    _meta: {
      'xyz.tollbooth/challenge': {
        renderer: set.tokenBearer.id,
        sku: challenge.sku,
        amount: challenge.amount,
        currency: challenge.currency,
        checkoutUrl: challenge.checkoutUrl,
        argumentName: challenge.argumentName,
        expiresAt: challenge.expiresAt,
      },
    },
  };
}
