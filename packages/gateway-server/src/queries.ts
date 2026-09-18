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

export interface OverviewSummary {
  /** USDC received across granted + partial settlements in the window. */
  readonly revenueAmount: string;
  readonly chargesOpened: number;
  /** granted + partial — the numerator for a conversion rate; the caller divides. */
  readonly chargesConverted: number;
  /** Distinct tools that opened at least one charge in the window. */
  readonly toolsSelling: readonly string[];
}

/** The window is always "now minus `days`", read at call time — never a stored, staleness-prone range. */
export async function overviewSummary(db: GatewayDatabase, tenantId: string, days = 30, now = Date.now()): Promise<OverviewSummary> {
  const since = now - days * 24 * 60 * 60 * 1000;
  return db.withTenant(tenantId, async (client) => {
    const rollups = await client.query<{ revenue: string | null; opened: string | null; converted: string | null }>(
      `SELECT
         COALESCE(SUM(revenue_amount), 0)::text AS revenue,
         COALESCE(SUM(charges_opened), 0)::text AS opened,
         COALESCE(SUM(charges_granted) + SUM(charges_partial), 0)::text AS converted
       FROM gateway_daily_rollups
       WHERE tenant_id = $1 AND day >= to_timestamp($2 / 1000.0)::date`,
      [tenantId, since]
    );
    const tools = await client.query<{ tool: string }>(
      `SELECT DISTINCT tool FROM gateway_charges WHERE tenant_id = $1 AND opened_at >= $2 AND tool IS NOT NULL ORDER BY tool`,
      [tenantId, since]
    );
    const row = rollups.rows[0];
    return {
      revenueAmount: row?.revenue ?? '0',
      chargesOpened: Number(row?.opened ?? 0),
      chargesConverted: Number(row?.converted ?? 0),
      toolsSelling: tools.rows.map((r) => r.tool),
    };
  });
}

export interface DailyRevenue {
  readonly day: string; // YYYY-MM-DD, UTC
  readonly amount: string;
}

/** One row per day that had any revenue, granted + partial, within the window — days with none are simply absent. */
export async function revenueByDay(db: GatewayDatabase, tenantId: string, days = 30, now = Date.now()): Promise<DailyRevenue[]> {
  const since = now - days * 24 * 60 * 60 * 1000;
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ day: string; amount: string }>(
      `SELECT day::text AS day, SUM(revenue_amount)::text AS amount
         FROM gateway_daily_rollups
        WHERE tenant_id = $1 AND day >= to_timestamp($2 / 1000.0)::date
        GROUP BY day
        ORDER BY day ASC`,
      [tenantId, since]
    );
    return rows;
  });
}

export interface OutcomeCounts {
  readonly granted: number;
  readonly partial: number;
  readonly underpaid: number;
  readonly expired: number;
}

export async function settlementOutcomeCounts(db: GatewayDatabase, tenantId: string, days = 30, now = Date.now()): Promise<OutcomeCounts> {
  const since = now - days * 24 * 60 * 60 * 1000;
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ granted: string; partial: string; underpaid: string; expired: string }>(
      `SELECT
         COALESCE(SUM(charges_granted), 0)::text AS granted,
         COALESCE(SUM(charges_partial), 0)::text AS partial,
         COALESCE(SUM(charges_underpaid), 0)::text AS underpaid,
         COALESCE(SUM(charges_expired), 0)::text AS expired
       FROM gateway_daily_rollups
       WHERE tenant_id = $1 AND day >= to_timestamp($2 / 1000.0)::date`,
      [tenantId, since]
    );
    const row = rows[0];
    return {
      granted: Number(row?.granted ?? 0),
      partial: Number(row?.partial ?? 0),
      underpaid: Number(row?.underpaid ?? 0),
      expired: Number(row?.expired ?? 0),
    };
  });
}

export interface ActivityRow {
  /** The one-way chargeRef hash, never a nonce or link id — safe to display as-is. */
  readonly chargeRef: string;
  readonly tool: string | null;
  readonly sku: string;
  readonly amount: string | null;
  /** `null` means opened but not yet observed as settled — a pending charge, not a status this schema names explicitly. */
  readonly status: string | null;
  readonly at: number;
}

/** Most recently active charges first — settled ones by when they settled, still-open ones by when they opened. */
export async function recentActivity(db: GatewayDatabase, tenantId: string, limit = 20): Promise<ActivityRow[]> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      charge_ref: string;
      tool: string | null;
      sku: string;
      amount: string | null;
      status: string | null;
      at: string;
    }>(
      `SELECT charge_ref, tool, sku, COALESCE(received_amount, amount) AS amount, status,
              COALESCE(settled_at, opened_at)::text AS at
         FROM gateway_charges
        WHERE tenant_id = $1
        ORDER BY COALESCE(settled_at, opened_at) DESC NULLS LAST
        LIMIT $2`,
      [tenantId, limit]
    );
    return rows.map((r) => ({ chargeRef: r.charge_ref, tool: r.tool, sku: r.sku, amount: r.amount, status: r.status, at: Number(r.at) }));
  });
}

export interface PriceCatalogEntry {
  readonly tool: string;
  readonly sku: string;
  readonly amount: string;
  readonly currency: string;
  /** When this (tool, sku) pair was last seen opening a charge. */
  readonly lastSeenAt: number;
}

/**
 * Read-only: what this tenant's own server has actually charged for, derived
 * from `charge_opened` events already ingested — never configured here, and
 * never fed back to the tenant's server. A `(tool, sku)` pair can reprice
 * over time; this reports whatever amount was most recently seen, not a
 * history of every price it has ever had.
 */
export async function reportedPricesAndTools(db: GatewayDatabase, tenantId: string): Promise<PriceCatalogEntry[]> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      tool: string;
      sku: string;
      amount: string;
      currency: string;
      last_seen_at: string;
    }>(
      `SELECT DISTINCT ON (tool, sku) tool, sku, amount, currency, opened_at AS last_seen_at
         FROM gateway_charges
        WHERE tenant_id = $1 AND tool IS NOT NULL
        ORDER BY tool, sku, opened_at DESC`,
      [tenantId]
    );
    return rows.map((r) => ({
      tool: r.tool,
      sku: r.sku,
      amount: r.amount,
      currency: r.currency,
      lastSeenAt: Number(r.last_seen_at),
    }));
  });
}

export interface UnderpaidChargeRow {
  readonly chargeRef: string;
  readonly tool: string | null;
  readonly sku: string;
  readonly amount: string | null;
  readonly receivedAmount: string | null;
  readonly receivedFraction: number | null;
  readonly at: number;
}

/** Most recent underpaid settlements first — money that arrived short of the ask and was never granted. */
export async function recentUnderpaidCharges(
  db: GatewayDatabase,
  tenantId: string,
  limit = 20
): Promise<UnderpaidChargeRow[]> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      charge_ref: string;
      tool: string | null;
      sku: string;
      amount: string | null;
      received_amount: string | null;
      received_fraction: string | null;
      at: string;
    }>(
      `SELECT charge_ref, tool, sku, amount, received_amount, received_fraction,
              COALESCE(settled_at, opened_at)::text AS at
         FROM gateway_charges
        WHERE tenant_id = $1 AND status = 'underpaid'
        ORDER BY COALESCE(settled_at, opened_at) DESC NULLS LAST
        LIMIT $2`,
      [tenantId, limit]
    );
    return rows.map((r) => ({
      chargeRef: r.charge_ref,
      tool: r.tool,
      sku: r.sku,
      amount: r.amount,
      receivedAmount: r.received_amount,
      receivedFraction: r.received_fraction === null ? null : Number(r.received_fraction),
      at: Number(r.at),
    }));
  });
}
