import type { GatewayDatabase } from './db.js';

export interface CreditsOutstanding {
  readonly bySku: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * Unspent purchased capacity: credits granted, minus credits actually
 * consumed by an authorised call, summed across all time — never windowed.
 * A credit bought last month and unspent today is still outstanding today.
 *
 * Nothing else can compute this for a tenant. Revenue is visible in their own
 * Moove dashboard; this is the number only the paywall's own telemetry has.
 */
export async function creditsOutstanding(db: GatewayDatabase, tenantId: string): Promise<CreditsOutstanding> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ sku: string; outstanding: string }>(
      `SELECT sku, (SUM(credits_granted) - SUM(credits_consumed))::text AS outstanding
         FROM gateway_daily_rollups
        WHERE tenant_id = $1
        GROUP BY sku`,
      [tenantId]
    );
    const bySku: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const n = Number(row.outstanding);
      bySku[row.sku] = n;
      total += n;
    }
    return { bySku, total };
  });
}

/**
 * Challenge issued to settlement observed, at the midpoint of the
 * distribution — median rather than mean because a handful of abandoned
 * charges (which never settle at all, and so are excluded here entirely,
 * not counted as an infinite wait) would otherwise pull a mean upward
 * without saying anything about the typical buyer.
 *
 * `null` when nothing has ever settled yet — there is no median of zero
 * observations, and reporting one as `0` would read as "instant," which is
 * a claim, not an absence of data.
 */
export async function medianTimeToPaySeconds(db: GatewayDatabase, tenantId: string): Promise<number | null> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ median_ms: string | null }>(
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY time_to_settle_ms)::text AS median_ms
         FROM gateway_charges
        WHERE tenant_id = $1 AND time_to_settle_ms IS NOT NULL`,
      [tenantId]
    );
    const raw = rows[0]?.median_ms;
    if (raw === null || raw === undefined) return null;
    return Math.round(Number(raw) / 1000);
  });
}
