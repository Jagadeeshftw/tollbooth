'use server';

import { revalidatePath } from 'next/cache';

import { setPriceConfig } from '@tollbooth/gateway-server';

import { gatewayDb } from '@/lib/db';
import { requireTenant } from '@/lib/auth';

export interface UpdatePriceInput {
  sku: string;
  amount: string;
}

/**
 * Basic shape only — never a floor or a business rule, which are the
 * tenant's own `MooveProvider#applyRemoteConfig`'s job, not this form's.
 * Rejecting garbage here is UX, not the trust boundary.
 */
const PLAIN_DECIMAL = /^\d+(\.\d{1,6})?$/;

/**
 * The actor recorded on the audit log is the signed-in tenant's own GitHub
 * login — the same identity `requireTenant` already resolves for every page
 * in this app, not a separate operator-identity system that doesn't exist
 * yet (this dashboard has one signed-in account per tenant today).
 *
 * `revalidatePath('/')` because the price row itself updates from this
 * action's own return value, but the audit log panel below it is a
 * separately server-rendered read of the same edit — without this it would
 * only catch up on the next unrelated navigation, not this one.
 */
export async function updatePriceAction(input: UpdatePriceInput): Promise<{ amount: string }> {
  const tenant = await requireTenant();
  if (!PLAIN_DECIMAL.test(input.amount)) {
    throw new Error('amount must be a plain decimal such as "10.00"');
  }
  const row = await setPriceConfig(gatewayDb(), tenant.id, tenant.githubLogin, { sku: input.sku, amount: input.amount });
  revalidatePath('/');
  return { amount: row.amount };
}
