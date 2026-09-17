import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GithubOAuthError,
  exchangeGithubCode,
  fetchGithubUser,
  githubAuthorizeUrl,
} from '../src/github-oauth.js';

const CONFIG = { clientId: 'client_123', clientSecret: 'secret_abc', redirectUri: 'https://app.tollbooth.0xo.in/callback' };

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('githubAuthorizeUrl', () => {
  it('carries the client id, redirect, state and a read-only scope', () => {
    const url = new URL(githubAuthorizeUrl(CONFIG, 'state-xyz'));
    assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client_123');
    assert.equal(url.searchParams.get('redirect_uri'), CONFIG.redirectUri);
    assert.equal(url.searchParams.get('state'), 'state-xyz');
    assert.equal(url.searchParams.get('scope'), 'read:user', 'identity only — never repo or write scope');
  });
});

describe('exchangeGithubCode', () => {
  it('posts the code and returns the access token', async () => {
    let seenBody: Record<string, unknown> | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenBody = JSON.parse(String(init?.body));
      return json(200, { access_token: 'gho_realtoken', token_type: 'bearer' });
    }) as unknown as typeof globalThis.fetch;

    const token = await exchangeGithubCode({ ...CONFIG, fetch: fetchImpl }, 'the-callback-code');
    assert.equal(token, 'gho_realtoken');
    assert.equal(seenBody?.['code'], 'the-callback-code');
    assert.equal(seenBody?.['client_secret'], 'secret_abc');
  });

  it('throws with the reason when GitHub reports an OAuth error', async () => {
    const fetchImpl = (async () =>
      json(200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' })) as unknown as typeof globalThis.fetch;

    await assert.rejects(
      () => exchangeGithubCode({ ...CONFIG, fetch: fetchImpl }, 'stale-code'),
      (e: unknown) => e instanceof GithubOAuthError && e.code === 'bad_verification_code'
    );
  });

  it('throws on a transport-level failure', async () => {
    const fetchImpl = (async () => json(502, {})) as unknown as typeof globalThis.fetch;
    await assert.rejects(() => exchangeGithubCode({ ...CONFIG, fetch: fetchImpl }, 'x'), GithubOAuthError);
  });
});

describe('fetchGithubUser', () => {
  it('sends the token as a bearer header and maps the GitHub shape', async () => {
    let seenAuth: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seenAuth = (init?.headers as Record<string, string>)?.['authorization'] ?? null;
      return json(200, { id: 42, login: 'octocat', name: 'The Octocat', avatar_url: 'https://example/a.png' });
    }) as unknown as typeof globalThis.fetch;

    const user = await fetchGithubUser('gho_realtoken', fetchImpl);
    assert.equal(seenAuth, 'Bearer gho_realtoken');
    assert.deepEqual(user, { id: 42, login: 'octocat', name: 'The Octocat', avatarUrl: 'https://example/a.png' });
  });

  it('throws on a rejected token', async () => {
    const fetchImpl = (async () => json(401, {})) as unknown as typeof globalThis.fetch;
    await assert.rejects(() => fetchGithubUser('bad-token', fetchImpl), GithubOAuthError);
  });
});
