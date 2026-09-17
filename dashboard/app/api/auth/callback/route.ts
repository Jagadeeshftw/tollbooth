import {
  GithubOAuthError,
  exchangeGithubCode,
  fetchGithubUser,
  upsertTenantForGithubUser,
} from '@tollbooth/gateway-server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { gatewayDb } from '@/lib/db';
import { env } from '@/lib/env';
import { consumeOAuthState, setSessionCookie } from '@/lib/session';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');

  if (oauthError) {
    return NextResponse.redirect(`${env.baseUrl}/login?error=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !(await consumeOAuthState(state))) {
    return NextResponse.redirect(`${env.baseUrl}/login?error=invalid_state`);
  }

  try {
    const accessToken = await exchangeGithubCode(
      { clientId: env.githubClientId, clientSecret: env.githubClientSecret, redirectUri: `${env.baseUrl}/api/auth/callback` },
      code
    );
    const user = await fetchGithubUser(accessToken);
    const tenant = await upsertTenantForGithubUser(gatewayDb(), user);
    await setSessionCookie(tenant.id);
    return NextResponse.redirect(`${env.baseUrl}/`);
  } catch (error) {
    const reason = error instanceof GithubOAuthError ? error.code : 'sign_in_failed';
    return NextResponse.redirect(`${env.baseUrl}/login?error=${encodeURIComponent(reason)}`);
  }
}
