import type { PoolClient } from 'pg';

import type { WireCallEvent, WireChargeOpenedEvent, WireEvent, WireSettlementEvent } from '@tollbooth/gateway-client';

import type { GatewayDatabase } from './db.js';

export interface IngestResult {
  /** Events that were new and applied. */
  accepted: number;
  /** Events already seen — a retried batch, safely a no-op. */
  duplicate: number;
}

/**
 * Ingest one batch for one tenant, atomically: either the whole batch's new
 * events land, or none do. That makes a retry of a batch that failed partway
 * — for any reason, not only the ones this function anticipates — safe to
 * resend from scratch, on top of the per-event idempotency below.
 */
export async function ingestBatch(
  db: GatewayDatabase,
  tenantId: string,
  events: readonly WireEvent[],
  now: () => number = Date.now
): Promise<IngestResult> {
  return db.withTenant(tenantId, async (client) => {
    let accepted = 0;
    let duplicate = 0;
    for (const event of events) {
      const isNew = await markIngested(client, tenantId, event, now());
      if (!isNew) {
        duplicate++;
        continue;
      }
      await applyEvent(client, tenantId, event);
      accepted++;
    }
    return { accepted, duplicate };
  });
}

/**
 * The idempotency gate. An event id is minted once by
 * `@tollbooth/gateway-client` and never reissued on retry, so a retried batch
 * presents the same ids — the primary key on `(tenant_id, event_id)` is the
 * entire mechanism; nothing downstream needs to know a retry happened.
 */
async function markIngested(client: PoolClient, tenantId: string, event: WireEvent, ingestedAt: number): Promise<boolean> {
  const r = await client.query(
    'INSERT INTO gateway_ingested_events (tenant_id, event_id, kind, ingested_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [tenantId, event.eventId, event.kind, ingestedAt]
  );
  return (r.rowCount ?? 0) === 1;
}

async function applyEvent(client: PoolClient, tenantId: string, event: WireEvent): Promise<void> {
  switch (event.kind) {
    case 'charge_opened':
      return applyChargeOpened(client, tenantId, event);
    case 'call':
      return applyCall(client, tenantId, event);
    case 'settlement':
      return applySettlement(client, tenantId, event);
  }
}

/**
 * `charge_opened` and `settlement` own disjoint column sets on the same row,
 * upserted with `COALESCE(existing, incoming)` — so whichever kind arrives
 * first for a `chargeRef` creates the row, and whichever arrives second
 * fills in its own columns without touching the other's. This is what makes
 * ordering not matter between the two kinds.
 */
async function applyChargeOpened(client: PoolClient, tenantId: string, event: WireChargeOpenedEvent): Promise<void> {
  await client.query(
    `INSERT INTO gateway_charges (tenant_id, charge_ref, tool, sku, amount, currency, opened_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, charge_ref) DO UPDATE SET
       tool      = COALESCE(gateway_charges.tool, EXCLUDED.tool),
       sku       = COALESCE(gateway_charges.sku, EXCLUDED.sku),
       amount    = COALESCE(gateway_charges.amount, EXCLUDED.amount),
       currency  = COALESCE(gateway_charges.currency, EXCLUDED.currency),
       opened_at = COALESCE(gateway_charges.opened_at, EXCLUDED.opened_at)`,
    [tenantId, event.chargeRef, event.tool, event.sku, event.amount, event.currency, event.at]
  );
  await bumpRollup(client, tenantId, event.at, event.sku, { charges_opened: 1 });
}

const SETTLEMENT_ROLLUP_COLUMN = {
  granted: 'charges_granted',
  partial: 'charges_partial',
  underpaid: 'charges_underpaid',
  expired: 'charges_expired',
} as const satisfies Record<WireSettlementEvent['status'], RollupColumn>;

/**
 * A charge can receive more than one genuine settlement observation over
 * time — a short payment leaves the charge pending, and a later poll can see
 * more money arrive and grant it. `settled_at` is the tiebreaker: an
 * incoming observation only supersedes the stored one if it is at least as
 * new, so an out-of-order-arriving *older* observation cannot clobber a
 * newer one that already landed. The rollup counts every observation as it
 * arrives regardless — an underpaid-then-granted charge is two real events
 * worth showing, not one to be silently corrected away.
 */
async function applySettlement(client: PoolClient, tenantId: string, event: WireSettlementEvent): Promise<void> {
  await client.query(
    `INSERT INTO gateway_charges (tenant_id, charge_ref, sku, amount, status, received_amount, received_fraction, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, charge_ref) DO UPDATE SET
       sku               = COALESCE(gateway_charges.sku, EXCLUDED.sku),
       amount            = COALESCE(gateway_charges.amount, EXCLUDED.amount),
       status             = CASE WHEN gateway_charges.settled_at IS NULL OR EXCLUDED.settled_at >= gateway_charges.settled_at
                                  THEN EXCLUDED.status ELSE gateway_charges.status END,
       received_amount    = CASE WHEN gateway_charges.settled_at IS NULL OR EXCLUDED.settled_at >= gateway_charges.settled_at
                                  THEN EXCLUDED.received_amount ELSE gateway_charges.received_amount END,
       received_fraction  = CASE WHEN gateway_charges.settled_at IS NULL OR EXCLUDED.settled_at >= gateway_charges.settled_at
                                  THEN EXCLUDED.received_fraction ELSE gateway_charges.received_fraction END,
       settled_at         = GREATEST(COALESCE(gateway_charges.settled_at, EXCLUDED.settled_at), EXCLUDED.settled_at)`,
    [tenantId, event.chargeRef, event.sku, event.amount, event.status, event.receivedAmount, event.receivedFraction, event.at]
  );

  const revenue = event.status === 'granted' || event.status === 'partial' ? (event.receivedAmount ?? '0') : '0';
  await bumpRollup(client, tenantId, event.at, event.sku, {
    [SETTLEMENT_ROLLUP_COLUMN[event.status]]: 1,
    revenue_amount: revenue,
  });
}

/** Append-only: a call is a fact about one moment, never revised by a later event. */
async function applyCall(client: PoolClient, tenantId: string, event: WireCallEvent): Promise<void> {
  await client.query(
    `INSERT INTO gateway_calls
       (tenant_id, event_id, tool, sku, cost, token_fingerprint, token_presented, token_recognised, outcome, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, event_id) DO NOTHING`,
    [
      tenantId,
      event.eventId,
      event.tool,
      event.sku,
      event.cost,
      event.tokenFingerprint,
      event.tokenPresented,
      event.tokenRecognised,
      event.outcome,
      event.at,
    ]
  );
  await bumpRollup(client, tenantId, event.at, event.sku, {
    [event.outcome === 'authorised' ? 'calls_authorised' : 'calls_challenged']: 1,
  });
}

type RollupColumn =
  | 'charges_opened'
  | 'charges_granted'
  | 'charges_partial'
  | 'charges_underpaid'
  | 'charges_expired'
  | 'calls_authorised'
  | 'calls_challenged';

/** Integer columns increment by 1; `revenue_amount` is a decimal string, added in Postgres as NUMERIC — never as a JS float. */
type RollupDelta = Partial<Record<RollupColumn, 1>> & { revenue_amount?: string };

/**
 * Pre-aggregated so the dashboard never scans raw events. Column names come
 * only from the fixed `RollupColumn` union above, never from event content,
 * so building the SQL column list by name here carries no injection risk.
 */
async function bumpRollup(client: PoolClient, tenantId: string, atMs: number, sku: string, deltas: RollupDelta): Promise<void> {
  const columns = Object.keys(deltas) as (keyof RollupDelta)[];
  if (columns.length === 0) return;
  const day = new Date(atMs).toISOString().slice(0, 10); // UTC calendar day

  const insertColumns = columns.join(', ');
  const insertPlaceholders = columns.map((_, i) => `$${i + 4}`).join(', ');
  // Postgres casts the bound text parameter to NUMERIC for revenue_amount and
  // to INTEGER for the count columns; `+` is ordinary addition either way,
  // done in SQL rather than JS, so a decimal amount never touches a float.
  const setClauses = columns.map((c) => `${c} = gateway_daily_rollups.${c} + EXCLUDED.${c}`).join(', ');

  await client.query(
    `INSERT INTO gateway_daily_rollups (tenant_id, day, sku, ${insertColumns})
     VALUES ($1, $2, $3, ${insertPlaceholders})
     ON CONFLICT (tenant_id, day, sku) DO UPDATE SET ${setClauses}`,
    [tenantId, day, sku, ...columns.map((c) => deltas[c])]
  );
}
