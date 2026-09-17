import type { GatewayDatabase } from './db.js';
import { hashIngestToken, issueIngestToken, verifyIngestToken } from './ingest-tokens.js';

export interface IngestTokenRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly createdAt: number;
  readonly lastUsedAt: number | null;
  readonly revokedAt: number | null;
}

/** Mint a fresh ingest token for a tenant. The plaintext is returned once and never stored. */
export async function issueTenantIngestToken(
  db: GatewayDatabase,
  tenantId: string,
  now: () => number = Date.now
): Promise<{ token: string; record: IngestTokenRecord }> {
  const { token, tokenHash } = issueIngestToken();
  const record: IngestTokenRecord = {
    id: `tbgw_id_${tokenHash.slice(0, 16)}`,
    tenantId,
    createdAt: now(),
    lastUsedAt: null,
    revokedAt: null,
  };
  return db.withoutTenant(async (client) => {
    await client.query(
      'INSERT INTO gateway_ingest_tokens (id, tenant_id, token_hash, created_at) VALUES ($1, $2, $3, $4)',
      [record.id, tenantId, tokenHash, record.createdAt]
    );
    return { token, record };
  });
}

/**
 * Authenticate a presented ingest token. `gateway_ingest_tokens` carries no
 * row-level security — finding which tenant a token belongs to necessarily
 * scans across tenants, before any tenant context can exist. The lookup is
 * by hash equality (a fixed, irreversible digest — safe to index and match
 * directly), and the returned row's hash is then re-checked against a fresh
 * hash of the presented token in constant time, as the last step before
 * trusting it.
 */
export async function authenticateIngestToken(
  db: GatewayDatabase,
  presentedToken: string,
  now: () => number = Date.now
): Promise<{ tenantId: string; tokenId: string } | null> {
  const hash = hashIngestToken(presentedToken);
  return db.withoutTenant(async (client) => {
    const { rows } = await client.query<{ id: string; tenant_id: string; token_hash: string }>(
      'SELECT id, tenant_id, token_hash FROM gateway_ingest_tokens WHERE token_hash = $1 AND revoked_at IS NULL',
      [hash]
    );
    const row = rows[0];
    if (!row || !verifyIngestToken(presentedToken, row.token_hash)) return null;

    await client.query('UPDATE gateway_ingest_tokens SET last_used_at = $1 WHERE id = $2', [now(), row.id]);
    return { tenantId: row.tenant_id, tokenId: row.id };
  });
}

export async function revokeIngestToken(db: GatewayDatabase, tokenId: string, now: () => number = Date.now): Promise<void> {
  await db.withoutTenant(async (client) => {
    await client.query('UPDATE gateway_ingest_tokens SET revoked_at = $1 WHERE id = $2', [now(), tokenId]);
  });
}

export async function listTenantIngestTokens(db: GatewayDatabase, tenantId: string): Promise<IngestTokenRecord[]> {
  return db.withoutTenant(async (client) => {
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
    }>(
      'SELECT id, tenant_id, created_at, last_used_at, revoked_at FROM gateway_ingest_tokens WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      createdAt: Number(row.created_at),
      lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
      revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    }));
  });
}
