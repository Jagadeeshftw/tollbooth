import { randomUUID } from 'node:crypto';

import type { GatewayDatabase } from './db.js';
import { reportedPricesAndTools } from './queries.js';

export interface PriceConfigRow {
  readonly sku: string;
  readonly amount: string;
  readonly credits: number | null;
  readonly ttlMs: number | null;
  readonly label: string;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

/** What a tenant's own server should pull and apply — see migrations.ts. Never touched by ingest. */
export async function getPriceConfig(db: GatewayDatabase, tenantId: string): Promise<PriceConfigRow[]> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      sku: string;
      amount: string;
      credits: string | null;
      ttl_ms: string | null;
      label: string;
      updated_at: string;
      updated_by: string;
    }>(
      `SELECT sku, amount, credits, ttl_ms, label, updated_at, updated_by
         FROM gateway_price_config
        WHERE tenant_id = $1
        ORDER BY sku`,
      [tenantId]
    );
    return rows.map((r) => ({
      sku: r.sku,
      amount: r.amount,
      credits: r.credits === null ? null : Number(r.credits),
      ttlMs: r.ttl_ms === null ? null : Number(r.ttl_ms),
      label: r.label,
      updatedAt: Number(r.updated_at),
      updatedBy: r.updated_by,
    }));
  });
}

/**
 * The price an operator would see as "current" for a sku right now: an
 * explicit config edit if one has ever been made, otherwise whatever the
 * tenant's own server has actually been reporting charges at. Never a third,
 * invented value — editing a sku with neither of these is refused by
 * `setPriceConfig`, the same "cannot invent a sku" rule
 * `MooveProvider#applyRemoteConfig` enforces independently on the tenant's
 * own side.
 */
async function effectivePrice(
  db: GatewayDatabase,
  tenantId: string,
  sku: string
): Promise<{ amount: string; credits: number | null; ttlMs: number | null; label: string } | undefined> {
  const configured = await getPriceConfig(db, tenantId);
  const row = configured.find((r) => r.sku === sku);
  if (row) return { amount: row.amount, credits: row.credits, ttlMs: row.ttlMs, label: row.label };

  const reported = await reportedPricesAndTools(db, tenantId);
  const charged = reported.find((r) => r.sku === sku);
  if (!charged) return undefined;
  // reportedPricesAndTools has no credits/ttlMs/label — those are never on
  // the wire for charge_opened — so a sku configured for the first time
  // starts from its amount alone; an operator sets the rest explicitly. The
  // tool name is a reasonable starting label, better than leaving it blank.
  return { amount: charged.amount, credits: null, ttlMs: null, label: charged.tool };
}

export interface EffectivePriceRow {
  readonly tool: string;
  readonly sku: string;
  readonly amount: string;
  readonly credits: number | null;
  readonly label: string | null;
  /** Whether an operator has ever edited this sku, vs. it only reflecting what's been charged. */
  readonly configured: boolean;
}

/**
 * Every (tool, sku) the tenant's server has ever reported, with any explicit
 * config edit overlaid on top — what the dashboard's price editor actually
 * shows and edits against. A sku never configured shows exactly what
 * `reportedPricesAndTools` already reports; the whole point of this seam is
 * that editing one doesn't require the tenant to have configured it before.
 */
export async function effectivePriceCatalog(db: GatewayDatabase, tenantId: string): Promise<EffectivePriceRow[]> {
  const [reported, configured] = await Promise.all([reportedPricesAndTools(db, tenantId), getPriceConfig(db, tenantId)]);
  const bySku = new Map(configured.map((c) => [c.sku, c]));
  return reported.map((r) => {
    const c = bySku.get(r.sku);
    return {
      tool: r.tool,
      sku: r.sku,
      amount: c?.amount ?? r.amount,
      credits: c?.credits ?? null,
      label: c?.label ?? null,
      configured: c !== undefined,
    };
  });
}

export interface PriceConfigEdit {
  readonly sku: string;
  readonly amount?: string;
  readonly credits?: number | null;
  readonly ttlMs?: number | null;
  readonly label?: string;
}

const AUDITED_FIELDS = ['amount', 'credits', 'ttlMs', 'label'] as const;

/**
 * Apply an edit and record it. Refuses a sku with no baseline at all — see
 * `effectivePrice` — rather than inventing one from nothing: the same "never
 * invent a sku" rule the tenant's own `applyRemoteConfig` enforces
 * independently, so a hostile or buggy dashboard action can't introduce a
 * sku the tenant's server would then reject anyway, silently, at the other
 * end.
 */
export async function setPriceConfig(
  db: GatewayDatabase,
  tenantId: string,
  actor: string,
  edit: PriceConfigEdit,
  now: () => number = Date.now
): Promise<PriceConfigRow> {
  const before = await effectivePrice(db, tenantId, edit.sku);
  if (!before) {
    throw new Error(
      `cannot configure a price for sku ${JSON.stringify(edit.sku)}: it has never been charged for and has no existing config`
    );
  }

  const after = {
    amount: edit.amount ?? before.amount,
    credits: edit.credits !== undefined ? edit.credits : before.credits,
    ttlMs: edit.ttlMs !== undefined ? edit.ttlMs : before.ttlMs,
    label: edit.label ?? before.label,
  };
  const changedAt = now();

  return db.withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO gateway_price_config (tenant_id, sku, amount, credits, ttl_ms, label, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, sku) DO UPDATE SET
         amount = EXCLUDED.amount, credits = EXCLUDED.credits, ttl_ms = EXCLUDED.ttl_ms,
         label = EXCLUDED.label, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [tenantId, edit.sku, after.amount, after.credits, after.ttlMs, after.label, changedAt, actor]
    );

    for (const field of AUDITED_FIELDS) {
      const oldValue = before[field];
      const newValue = after[field];
      if (oldValue === newValue) continue;
      await client.query(
        `INSERT INTO gateway_config_audit (id, tenant_id, sku, actor, field, old_value, new_value, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), tenantId, edit.sku, actor, field, oldValue === null ? null : String(oldValue), newValue === null ? null : String(newValue), changedAt]
      );
    }

    return { sku: edit.sku, ...after, updatedAt: changedAt, updatedBy: actor };
  });
}

export interface ConfigAuditEntry {
  readonly id: string;
  readonly sku: string;
  readonly actor: string;
  readonly field: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
  readonly changedAt: number;
}

/** Most recent edits first. A business record: who changed what, and when — see migrations.ts. */
export async function configAuditLog(db: GatewayDatabase, tenantId: string, limit = 50): Promise<ConfigAuditEntry[]> {
  return db.withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      sku: string;
      actor: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      changed_at: string;
    }>(
      `SELECT id, sku, actor, field, old_value, new_value, changed_at
         FROM gateway_config_audit
        WHERE tenant_id = $1
        ORDER BY changed_at DESC
        LIMIT $2`,
      [tenantId, limit]
    );
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      actor: r.actor,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      changedAt: Number(r.changed_at),
    }));
  });
}
