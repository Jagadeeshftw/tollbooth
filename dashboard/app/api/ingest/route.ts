import type { WireEvent } from '@tollbooth/gateway-client';
import { authenticateIngestToken, ingestBatch } from '@tollbooth/gateway-server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { gatewayDb } from '@/lib/db';

/**
 * What `GatewayClient#send` in `@tollbooth/gateway-client` posts to. Bearer
 * token is the tenant's own ingest token — never their Moove key, and never
 * anything this dashboard's own session cookie would grant.
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!token) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }

  const authenticated = await authenticateIngestToken(gatewayDb(), token);
  if (!authenticated) {
    return NextResponse.json({ error: 'invalid or revoked ingest token' }, { status: 401 });
  }

  let body: { events?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'malformed JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.events)) {
    return NextResponse.json({ error: '"events" must be an array' }, { status: 400 });
  }

  const result = await ingestBatch(gatewayDb(), authenticated.tenantId, body.events as WireEvent[]);
  return NextResponse.json(result, { status: 200 });
}
