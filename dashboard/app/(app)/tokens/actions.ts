'use server';

import { issueTenantIngestToken, revokeIngestToken } from '@tollbooth/gateway-server';

import { gatewayDb } from '@/lib/db';
import { requireTenant } from '@/lib/auth';

export async function issueTokenAction(): Promise<{ token: string; id: string; createdAt: number }> {
  const tenant = await requireTenant();
  const { token, record } = await issueTenantIngestToken(gatewayDb(), tenant.id);
  return { token, id: record.id, createdAt: record.createdAt };
}

/**
 * `revokeIngestToken` itself is scoped to `tenant.id` — it will not touch a
 * row belonging to a different tenant, and reports back rather than throwing
 * when the id doesn't match, so an id belonging to someone else and an id
 * that never existed look identical from here.
 */
export async function revokeTokenAction(tokenId: string): Promise<void> {
  const tenant = await requireTenant();
  const revoked = await revokeIngestToken(gatewayDb(), tenant.id, tokenId);
  if (!revoked) {
    throw new Error('not your token');
  }
}
