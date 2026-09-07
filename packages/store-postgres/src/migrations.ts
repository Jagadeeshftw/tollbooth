/**
 * Schema migrations, applied in order and recorded so they run once.
 *
 * Applied under a Postgres advisory lock, because two instances booting at the
 * same time after a deploy is the normal case, not an edge case.
 */
export interface Migration {
  readonly id: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_initial',
    statements: [
      `CREATE TABLE IF NOT EXISTS tollbooth_entitlements (
         id          TEXT PRIMARY KEY,
         subject     TEXT   NOT NULL,
         sku         TEXT   NOT NULL,
         remaining   BIGINT,           -- NULL means unlimited
         expires_at  BIGINT,           -- NULL means never expires
         charge_id   TEXT   NOT NULL,
         created_at  BIGINT NOT NULL,
         version     BIGINT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS tollbooth_entitlements_subject_sku
         ON tollbooth_entitlements (subject, sku)`,

      `CREATE TABLE IF NOT EXISTS tollbooth_charges (
         nonce           TEXT PRIMARY KEY,
         id              TEXT   NOT NULL,
         subject         TEXT   NOT NULL,
         sku             TEXT   NOT NULL,
         amount          TEXT   NOT NULL,
         status          TEXT   NOT NULL,
         provider_ref    TEXT,
         checkout_url    TEXT,
         created_at      BIGINT NOT NULL,
         expires_at      BIGINT NOT NULL,
         settled_at      BIGINT,
         received_amount TEXT,
         last_polled_at  BIGINT,
         poll_count      BIGINT NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS tollbooth_charges_status
         ON tollbooth_charges (status, created_at)`,
      `CREATE INDEX IF NOT EXISTS tollbooth_charges_subject_sku
         ON tollbooth_charges (subject, sku)`,

      `CREATE TABLE IF NOT EXISTS tollbooth_subjects (
         subject      TEXT PRIMARY KEY,
         created_at   BIGINT NOT NULL,
         last_seen_at BIGINT NOT NULL,
         expires_at   BIGINT NOT NULL,
         bound_to     TEXT
       )`,

      // One row per settled payment, ever. The primary key is the exactly-once
      // guard: a second insert changes nothing and reports it.
      `CREATE TABLE IF NOT EXISTS tollbooth_settlement_claims (
         nonce      TEXT PRIMARY KEY,
         claimed_at BIGINT NOT NULL
       )`,
    ],
  },
];

export const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS tollbooth_migrations (
  id         TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)`;

/** Arbitrary but stable, so only Tollbooth contends for this lock. */
export const MIGRATION_ADVISORY_LOCK = 0x7011b007;
