'use server';

import { issueTenantIngestToken, listTenantIngestTokens, revokeIngestToken } from '@tollbooth/gateway-server';

import { gatewayDb } from '@/lib/db';
import { requireTenant } from '@/lib/auth';

export async function issueTokenAction(): Promise<{ token: string; id: string; createdAt: number }> {
  const tenant = await requireTenant();
  const { token, record } = await issueTenantIngestToken(gatewayDb(), tenant.id);
  return { token, id: record.id, createdAt: record.createdAt };
}

/**
 * `gateway_ingest_tokens` carries no row-level security by design — see
 * migrations.ts — so nothing at the database layer stops one tenant naming
 * another's token id here. This check is the only thing that does: confirm
 * the id is actually one of the signed-in tenant's own before revoking it.
 */
export async function revokeTokenAction(tokenId: string): Promise<void> {
  const tenant = await requireTenant();
  const own = await listTenantIngestTokens(gatewayDb(), tenant.id);
  if (!own.some((t) => t.id === tokenId)) {
    throw new Error('not your token');
  }
  await revokeIngestToken(gatewayDb(), tokenId);
}
