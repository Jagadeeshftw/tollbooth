import { authenticateIngestToken, getPriceConfig } from '@tollbooth/gateway-server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { gatewayDb } from '@/lib/db';

/**
 * What `GatewayClient#syncPrices` pulls from. Same bearer-token auth as
 * `/api/ingest` — the ingest token already scopes to exactly one tenant, so
 * no second credential is needed to read that tenant's own price config back.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
  if (!token) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }

  const authenticated = await authenticateIngestToken(gatewayDb(), token);
  if (!authenticated) {
    return NextResponse.json({ error: 'invalid or revoked ingest token' }, { status: 401 });
  }

  const prices = await getPriceConfig(gatewayDb(), authenticated.tenantId);
  return NextResponse.json({
    prices: prices.map((p) => ({ sku: p.sku, amount: p.amount, credits: p.credits, ttlMs: p.ttlMs, label: p.label })),
  });
}
