import { getTenant } from '@tollbooth/gateway-server';
import type { Tenant } from '@tollbooth/gateway-server';
import { redirect } from 'next/navigation';

import { gatewayDb } from './db';
import { currentTenantId } from './session';

/** For a server component that requires a signed-in tenant; redirects to /login otherwise. */
export async function requireTenant(): Promise<Tenant> {
  const tenantId = await currentTenantId();
  if (!tenantId) redirect('/login');
  const tenant = await getTenant(gatewayDb(), tenantId);
  if (!tenant) redirect('/login');
  return tenant;
}
