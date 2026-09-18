/**
 * Schema migrations for the gateway's own Neon database.
 *
 * This is a *separate* database from any tenant's entitlement store — never
 * the same connection, never the same project. Those are different trust
 * domains: an entitlement store holds what a subject handle can spend: real
 * money. This one holds a hash of a write-only ingest token and a mirror of
 * telemetry a tenant's own server already logs. Sharing a connection would
 * mean a bug in one surface can touch the other; a separate database makes
 * that structurally impossible instead of merely policed.
 *
 * Applied under a Postgres advisory lock, same reasoning as
 * `@tollbooth/store-postgres`: two instances booting after a deploy is normal,
 * not an edge case.
 */
export interface Migration {
  readonly id: string;
  readonly statements: readonly string[];
}

/**
 * Written justification: why `gateway_tenants` and `gateway_ingest_tokens`
 * carry no row-level security, when every other tenant-scoped table does.
 *
 * The reason is structural, not a shortcut. RLS in this schema means
 * `current_setting('app.tenant_id', true)` — a tenant context that has to
 * already exist. `gateway_ingest_tokens` is read by `authenticateIngestToken`
 * to *establish* that context: given only a presented token, the query must
 * find which tenant (if any) it belongs to, which means scanning by hash
 * across all tenants before any `app.tenant_id` can be set. RLS on that table
 * would make the lookup that creates tenant context always return zero rows —
 * it would not fail safe, it would fail total. The same is true of
 * `gateway_tenants`: GitHub sign-in resolves an external identity to a
 * tenant id before that id exists as a session value to scope by.
 *
 * Because there is no RLS backstop, every statement that touches these two
 * tables (`packages/gateway-server/src/tokens.ts`, `tenants.ts`) has been
 * individually audited for tenant scoping instead, and each is one of:
 *
 *   - Scoped by an explicit `WHERE tenant_id = $1` bound to the caller's own,
 *     already-authenticated tenant id (`listTenantIngestTokens`, the insert
 *     in `issueTenantIngestToken`, `revokeIngestToken`).
 *   - Looked up by token hash or GitHub user id — values that are either
 *     cryptographically unguessable (a token hash) or bound to an external,
 *     already-verified identity (a GitHub id from a validated OAuth
 *     callback) — with the row's own hash re-verified in constant time
 *     before anything is trusted (`authenticateIngestToken`).
 *   - An update keyed by a row id taken from that same successful lookup,
 *     never from caller input (`authenticateIngestToken`'s `last_used_at`
 *     touch).
 *
 * `revokeIngestToken` in particular takes both a `tenantId` and a `tokenId`
 * and scopes its `UPDATE` by both, returning whether a row actually matched
 * rather than throwing — so a token id belonging to a different tenant and
 * one that never existed are indistinguishable to the caller. See
 * `test/tokens.test.ts`'s `revokeIngestToken` suite for the cross-tenant
 * case this proves.
 *
 * Row-level security remains the enforced, tested guarantee for the tables
 * that hold a tenant's actual operational data — `gateway_charges`,
 * `gateway_calls`, `gateway_ingested_events` and `gateway_daily_rollups` —
 * which is what the dashboard reads from and what "no tenant can read
 * another's rows" is actually about. `gateway_tenants` and
 * `gateway_ingest_tokens` hold identity and credential metadata, not tenant
 * operational data, and are the two tables whose whole purpose is to be
 * reachable *before* a tenant is known.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_initial',
    statements: [
      `CREATE TABLE IF NOT EXISTS gateway_tenants (
         id             TEXT PRIMARY KEY,
         github_user_id BIGINT NOT NULL UNIQUE,
         github_login   TEXT   NOT NULL,
         created_at     BIGINT NOT NULL
       )`,

      `CREATE TABLE IF NOT EXISTS gateway_ingest_tokens (
         id           TEXT PRIMARY KEY,
         tenant_id    TEXT   NOT NULL REFERENCES gateway_tenants(id),
         token_hash   TEXT   NOT NULL UNIQUE,
         created_at   BIGINT NOT NULL,
         last_used_at BIGINT,
         revoked_at   BIGINT
       )`,
      `CREATE INDEX IF NOT EXISTS gateway_ingest_tokens_tenant
         ON gateway_ingest_tokens (tenant_id)`,

      // The idempotency gate. Every event id this gateway has ever accepted,
      // per tenant — an event id is only unique within one tenant's stream,
      // minted client-side by @tollbooth/gateway-client. A retried batch
      // re-presents the same ids; the primary key alone does the deduping.
      `CREATE TABLE IF NOT EXISTS gateway_ingested_events (
         tenant_id   TEXT   NOT NULL REFERENCES gateway_tenants(id),
         event_id    TEXT   NOT NULL,
         kind        TEXT   NOT NULL,
         ingested_at BIGINT NOT NULL,
         PRIMARY KEY (tenant_id, event_id)
       )`,
      `ALTER TABLE gateway_ingested_events ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE gateway_ingested_events FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY gateway_ingested_events_tenant_isolation ON gateway_ingested_events
         USING (tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,

      // One row per charge, keyed by the one-way chargeRef hash of its nonce
      // — never the nonce, never a handle, never a link id; see
      // @tollbooth/gateway-client. Upserted from whichever event arrives
      // first: a settlement can land before its charge_opened when a batch
      // is retried out of order, so every column here is nullable and the
      // two event kinds each own a disjoint subset of them. See ingest.ts.
      `CREATE TABLE IF NOT EXISTS gateway_charges (
         tenant_id         TEXT             NOT NULL REFERENCES gateway_tenants(id),
         charge_ref        TEXT             NOT NULL,
         tool              TEXT,
         sku               TEXT,
         amount            TEXT,
         currency          TEXT,
         opened_at         BIGINT,
         status            TEXT,
         received_amount   TEXT,
         received_fraction DOUBLE PRECISION,
         settled_at        BIGINT,
         PRIMARY KEY (tenant_id, charge_ref)
       )`,
      `ALTER TABLE gateway_charges ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE gateway_charges FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY gateway_charges_tenant_isolation ON gateway_charges
         USING (tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,

      // Append-only: a call is a call, never revised by a later event.
      `CREATE TABLE IF NOT EXISTS gateway_calls (
         tenant_id         TEXT    NOT NULL REFERENCES gateway_tenants(id),
         event_id          TEXT    NOT NULL,
         tool              TEXT    NOT NULL,
         sku               TEXT    NOT NULL,
         cost              INTEGER NOT NULL,
         token_fingerprint TEXT,
         token_presented   BOOLEAN NOT NULL,
         token_recognised  BOOLEAN NOT NULL,
         outcome           TEXT    NOT NULL,
         at                BIGINT  NOT NULL,
         PRIMARY KEY (tenant_id, event_id)
       )`,
      `ALTER TABLE gateway_calls ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE gateway_calls FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY gateway_calls_tenant_isolation ON gateway_calls
         USING (tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
      `CREATE INDEX IF NOT EXISTS gateway_calls_tenant_at ON gateway_calls (tenant_id, at)`,

      // Pre-aggregated so the dashboard never scans raw events. Incremented
      // transactionally alongside the row it summarises — see ingest.ts —
      // never recomputed from scratch, so it stays cheap at any volume.
      `CREATE TABLE IF NOT EXISTS gateway_daily_rollups (
         tenant_id         TEXT    NOT NULL REFERENCES gateway_tenants(id),
         day               DATE    NOT NULL,
         sku               TEXT    NOT NULL,
         charges_opened    INTEGER NOT NULL DEFAULT 0,
         charges_granted   INTEGER NOT NULL DEFAULT 0,
         charges_partial   INTEGER NOT NULL DEFAULT 0,
         charges_underpaid INTEGER NOT NULL DEFAULT 0,
         charges_expired   INTEGER NOT NULL DEFAULT 0,
         revenue_amount    NUMERIC(20, 6) NOT NULL DEFAULT 0,
         calls_authorised  INTEGER NOT NULL DEFAULT 0,
         calls_challenged  INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (tenant_id, day, sku)
       )`,
      `ALTER TABLE gateway_daily_rollups ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE gateway_daily_rollups FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY gateway_daily_rollups_tenant_isolation ON gateway_daily_rollups
         USING (tenant_id = current_setting('app.tenant_id', true))
         WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
    ],
  },
  {
    id: '0002_credits_and_time_to_pay',
    statements: [
      // Filled in by whichever of charge_opened/settlement arrives SECOND for
      // a charge_ref, once both opened_at and settled_at are known — see
      // ingest.ts. Never recomputed afterward: a charge is settled once.
      `ALTER TABLE gateway_charges ADD COLUMN IF NOT EXISTS time_to_settle_ms BIGINT`,

      // Credits, not dollars: "outstanding" is unspent purchased capacity,
      // which only these two counters together can express. Summed across
      // every day for a tenant+sku, never windowed — a credit bought last
      // month and unspent today is still outstanding today.
      `ALTER TABLE gateway_daily_rollups ADD COLUMN IF NOT EXISTS credits_granted BIGINT NOT NULL DEFAULT 0`,
      `ALTER TABLE gateway_daily_rollups ADD COLUMN IF NOT EXISTS credits_consumed BIGINT NOT NULL DEFAULT 0`,
    ],
  },
];

export const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS gateway_migrations (
  id         TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)`;

/** Arbitrary but stable, and distinct from store-postgres's — a different lock namespace even on the same server. */
export const MIGRATION_ADVISORY_LOCK = 0x7011b008;
