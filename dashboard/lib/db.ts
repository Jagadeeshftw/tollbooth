import { GatewayDatabase } from '@tollbooth/gateway-server';

import { env } from './env';

/**
 * One pool for the process, not one per request — Next.js route handlers and
 * server components in the same runtime share this. `GatewayDatabase` itself
 * already refuses to boot against a superuser or BYPASSRLS role, so a
 * misconfigured connection string fails loudly here rather than silently
 * granting more access than row-level security should allow.
 */
let instance: GatewayDatabase | undefined;

export function gatewayDb(): GatewayDatabase {
  if (!instance) {
    instance = new GatewayDatabase({ connectionString: env.gatewayDatabaseUrl });
  }
  return instance;
}
