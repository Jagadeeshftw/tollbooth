import type { GatewayDatabase } from './db.js';
import type { GithubUser } from './github-oauth.js';
import { mintTenantId } from './ids.js';

export interface Tenant {
  readonly id: string;
  readonly githubUserId: number;
  readonly githubLogin: string;
  readonly createdAt: number;
}

/**
 * Find or create the tenant for a GitHub identity. `gateway_tenants` carries
 * no row-level security — see `migrations.ts` — so this runs outside any
 * tenant transaction, on the connection's own privileges, filtered by the
 * one column that actually identifies a row here: the GitHub user id.
 */
export async function upsertTenantForGithubUser(
  db: GatewayDatabase,
  user: GithubUser,
  now: () => number = Date.now
): Promise<Tenant> {
  return db.withoutTenant(async (client) => {
    const existing = await client.query<{
      id: string;
      github_user_id: string;
      github_login: string;
      created_at: string;
    }>('SELECT * FROM gateway_tenants WHERE github_user_id = $1', [user.id]);

    if (existing.rows[0]) {
      const row = existing.rows[0];
      // The login can change (a GitHub rename); keep it current.
      if (row.github_login !== user.login) {
        await client.query('UPDATE gateway_tenants SET github_login = $1 WHERE id = $2', [user.login, row.id]);
      }
      return {
        id: row.id,
        githubUserId: Number(row.github_user_id),
        githubLogin: user.login,
        createdAt: Number(row.created_at),
      };
    }

    const tenant: Tenant = {
      id: mintTenantId(),
      githubUserId: user.id,
      githubLogin: user.login,
      createdAt: now(),
    };
    await client.query(
      'INSERT INTO gateway_tenants (id, github_user_id, github_login, created_at) VALUES ($1, $2, $3, $4)',
      [tenant.id, tenant.githubUserId, tenant.githubLogin, tenant.createdAt]
    );
    return tenant;
  });
}

export async function getTenant(db: GatewayDatabase, tenantId: string): Promise<Tenant | undefined> {
  return db.withoutTenant(async (client) => {
    const { rows } = await client.query<{
      id: string;
      github_user_id: string;
      github_login: string;
      created_at: string;
    }>('SELECT * FROM gateway_tenants WHERE id = $1', [tenantId]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      githubUserId: Number(row.github_user_id),
      githubLogin: row.github_login,
      createdAt: Number(row.created_at),
    };
  });
}
