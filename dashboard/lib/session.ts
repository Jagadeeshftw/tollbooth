import { randomBytes } from 'node:crypto';

import { issueSession, verifySession } from '@tollbooth/gateway-server';
import { cookies } from 'next/headers';

import { env } from './env';

const SESSION_COOKIE = 'tb_session';
const STATE_COOKIE = 'tb_oauth_state';
const isProduction = process.env.NODE_ENV === 'production';

export async function setSessionCookie(tenantId: string): Promise<void> {
  const token = issueSession(tenantId, env.sessionSecret);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** The signed-in tenant's id, or `null` if there is none or the cookie is invalid/expired. */
export async function currentTenantId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = verifySession(token, env.sessionSecret);
  return payload?.tenantId ?? null;
}

/**
 * CSRF protection for the OAuth round trip: a random value set as a cookie
 * before redirecting to GitHub, and compared against the `state` GitHub
 * hands back on the callback. Short-lived — the whole round trip takes
 * seconds, not the session's own 30 days.
 */
export async function issueOAuthState(): Promise<string> {
  const state = randomBytes(16).toString('base64url');
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/', maxAge: 600 });
  return state;
}

export async function consumeOAuthState(presented: string | null): Promise<boolean> {
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  return Boolean(expected) && expected === presented;
}
