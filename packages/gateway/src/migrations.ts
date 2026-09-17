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
 * `gateway_tenants` and `gateway_ingest_tokens` carry no row-level security.
 * Authenticating a presented ingest token means finding *which* tenant it
 * belongs to — the query has to scan across tenants by construction, before
 * any tenant context exists to scope it to. RLS on these two would make that
 * lookup return nothing. Application code filters them by an explicit
 * `WHERE tenant_id = $1` instead, in the handful of narrow queries that touch
 * them post-authentication. Row-level security is the enforced, tested
 * guarantee for the tables that actually hold a tenant's operational data —
 * `gateway_charges`, `gateway_calls`, `gateway_ingested_events` and
 * `gateway_daily_rollups` — which is what the dashboard reads from and what
 * "no tenant can read another's rows" is actually about.
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
];

export const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS gateway_migrations (
  id         TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)`;

/** Arbitrary but stable, and distinct from store-postgres's — a different lock namespace even on the same server. */
export const MIGRATION_ADVISORY_LOCK = 0x7011b008;
