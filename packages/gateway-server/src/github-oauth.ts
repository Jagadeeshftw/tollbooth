/**
 * GitHub OAuth, as three pure-ish steps: build the authorize URL, exchange a
 * callback code for an access token, and read back who signed in. No
 * framework, no session handling — that is `session.ts`. `fetch` is
 * injectable throughout so none of this needs the network to test.
 */

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: typeof globalThis.fetch;
}

export interface GithubUser {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export class GithubOAuthError extends Error {
  override readonly name = 'GithubOAuthError';
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

/**
 * Where to send a tenant to sign in. `state` is the caller's to mint and
 * verify on return — this module does not generate or check it, since doing
 * that safely means owning the session, which belongs in `session.ts`.
 */
export function githubAuthorizeUrl(config: Pick<GithubOAuthConfig, 'clientId' | 'redirectUri'>, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  // Only identity is needed — no repo scope, no write scope. This account
  // signs a tenant in; it never touches anything in their GitHub account.
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

/** Exchange the callback's `code` for an access token. Single-use; GitHub rejects a replayed code. */
export async function exchangeGithubCode(config: GithubOAuthConfig, code: string): Promise<string> {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!res.ok) {
    throw new GithubOAuthError(`GitHub token exchange failed: HTTP ${res.status}`, 'HTTP_ERROR');
  }
  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (body.error || !body.access_token) {
    throw new GithubOAuthError(
      body.error_description ?? body.error ?? 'GitHub returned no access token',
      body.error ?? 'NO_TOKEN'
    );
  }
  return body.access_token;
}

/** Who just signed in. Nothing here is stored raw beyond what `tenants.ts` keeps. */
export async function fetchGithubUser(accessToken: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch): Promise<GithubUser> {
  const res = await fetchImpl(USER_URL, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'tollbooth-gateway',
    },
  });
  if (!res.ok) {
    throw new GithubOAuthError(`GitHub user lookup failed: HTTP ${res.status}`, 'HTTP_ERROR');
  }
  const body = (await res.json()) as { id: number; login: string; name: string | null; avatar_url: string | null };
  return { id: body.id, login: body.login, name: body.name, avatarUrl: body.avatar_url };
}
