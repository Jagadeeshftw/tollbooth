import { githubAuthorizeUrl } from '@tollbooth/gateway-server';
import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { issueOAuthState } from '@/lib/session';

export async function GET() {
  const state = await issueOAuthState();
  const url = githubAuthorizeUrl(
    { clientId: env.githubClientId, redirectUri: `${env.baseUrl}/api/auth/callback` },
    state
  );
  return NextResponse.redirect(url);
}
