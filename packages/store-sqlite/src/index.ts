import Database from 'better-sqlite3';

import type {
  Charge,
  ChargeStatus,
  ConsumeResult,
  Entitlement,
  EntitlementStore,
  Sku,
  Subject,
  SubjectRecord,
} from '@tollbooth/core';

export interface SqliteStoreOptions {
  /** File path, or `:memory:` for a throwaway database. */
  path: string;
  /** Injected clock, for tests. */
  now?: () => number;
  /** How long to wait on a locked database before giving up. Default 5000ms. */
  busyTimeoutMs?: number;
}

interface EntitlementRow {
  id: string;
  subject: string;
  sku: string;
  remaining: number | null;
  expires_at: number | null;
  charge_id: string;
  created_at: number;
  version: number;
}

interface SubjectRow {
  subject: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  bound_to: string | null;
}

interface ChargeRow {
  nonce: string;
  id: string;
  subject: string;
  sku: string;
  amount: string;
  status: string;
  provider_ref: string | null;
  checkout_url: string | null;
  created_at: number;
  expires_at: number;
  settled_at: number | null;
  received_amount: string | null;
  last_polled_at: number | null;
  poll_count: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entitlements (
  id          TEXT PRIMARY KEY,
  subject     TEXT    NOT NULL,
  sku         TEXT    NOT NULL,
  remaining   INTEGER,            -- NULL means unlimited
  expires_at  INTEGER,            -- NULL means never expires
  charge_id   TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  version     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entitlements_subject_sku ON entitlements (subject, sku);

CREATE TABLE IF NOT EXISTS charges (
  nonce           TEXT PRIMARY KEY,
  id              TEXT    NOT NULL,
  subject         TEXT    NOT NULL,
  sku             TEXT    NOT NULL,
  amount          TEXT    NOT NULL,
  status          TEXT    NOT NULL,
  provider_ref    TEXT,
  checkout_url    TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  settled_at      INTEGER,
  received_amount TEXT,
  last_polled_at  INTEGER,
  poll_count      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_charges_status ON charges (status, created_at);

CREATE TABLE IF NOT EXISTS subjects (
  subject     TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  bound_to    TEXT
);

-- One row per settled payment, ever. The primary key is the exactly-once guard.
CREATE TABLE IF NOT EXISTS settlement_claims (
  nonce      TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);
`;

/**
 * Durable {@link EntitlementStore} on SQLite. This is the store to use in
 * production: entitlements people have paid for survive a restart.
 *
 * `consume` runs inside an IMMEDIATE transaction *and* swaps on the row
 * version, so it is safe both against concurrent calls in one process and
 * against a second process holding its own connection to the same file.
 */
export class SqliteEntitlementStore implements EntitlementStore {
  readonly #db: Database.Database;
  readonly #now: () => number;

  constructor(options: SqliteStoreOptions) {
    this.#now = options.now ?? Date.now;
    this.#db = new Database(options.path);
    // WAL lets a reader and a writer coexist, which matters once a background
    // reconciler polls while tool calls are still being served.
    this.#db.pragma('journal_mode = WAL');
    this.#db.pragma('foreign_keys = ON');
    this.#db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
    // Opening the database runs the schema DDL, and several processes booting
    // together all run it at once. Under WAL that can come back SQLITE_BUSY
    // even with a busy_timeout set, because DDL needs an exclusive lock the
    // timeout does not always cover. Retry briefly rather than failing a boot.
    let lastError: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        this.#db.exec(SCHEMA);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const code = (error as { code?: string }).code ?? '';
        if (!code.startsWith('SQLITE_BUSY') && !code.startsWith('SQLITE_LOCKED')) throw error;
        const until = Date.now() + 25 * (attempt + 1);
        while (Date.now() < until) {
          /* brief synchronous pause: better-sqlite3 has no async path here */
        }
      }
    }
    if (lastError) throw lastError;
  }

  async consume(subject: Subject, sku: Sku, cost = 1): Promise<ConsumeResult> {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new RangeError(`cost must be a positive integer, received ${cost}`);
    }
    const now = this.#now();

    // IMMEDIATE takes the write lock up front rather than upgrading mid-way,
    // which is what avoids SQLITE_BUSY between two writing processes.
    const run = this.#db.transaction((): ConsumeResult => {
      const candidate = this.#db
        .prepare<[string, string, number, number], EntitlementRow>(
          `SELECT * FROM entitlements
            WHERE subject = ? AND sku = ?
              AND (expires_at IS NULL OR expires_at > ?)
              AND (remaining  IS NULL OR remaining >= ?)
            ORDER BY (remaining IS NULL) DESC,
                     COALESCE(expires_at, 9007199254740991) ASC,
                     remaining ASC
            LIMIT 1`
        )
        .get(subject, sku, now, cost);

      if (!candidate) return { ok: false, reason: this.#failureReason(subject, sku, now) };

      const result = this.#db
        .prepare(
          `UPDATE entitlements
              SET remaining = CASE WHEN remaining IS NULL THEN NULL ELSE remaining - ? END,
                  version   = version + 1
            WHERE id = ? AND version = ?`
        )
        .run(cost, candidate.id, candidate.version);

      if (result.changes !== 1) {
        // Version moved under us. Inside a transaction this should be
        // unreachable; treat it as a lost race rather than a silent success.
        return { ok: false, reason: 'insufficient_credits' };
      }

      return {
        ok: true,
        entitlementId: candidate.id,
        remaining: candidate.remaining === null ? null : candidate.remaining - cost,
        expiresAt: candidate.expires_at,
      };
    });

    return run.immediate();
  }

  #failureReason(subject: string, sku: string, now: number): 'no_entitlement' | 'expired' | 'insufficient_credits' {
    const any = this.#db
      .prepare<[string, string], { n: number }>(
        'SELECT COUNT(*) AS n FROM entitlements WHERE subject = ? AND sku = ?'
      )
      .get(subject, sku);
    if (!any || any.n === 0) return 'no_entitlement';

    const unexpired = this.#db
      .prepare<[string, string, number], { n: number }>(
        `SELECT COUNT(*) AS n FROM entitlements
          WHERE subject = ? AND sku = ? AND (expires_at IS NULL OR expires_at > ?)`
      )
      .get(subject, sku, now);
    return unexpired && unexpired.n > 0 ? 'insufficient_credits' : 'expired';
  }

  async grant(e: Entitlement): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO entitlements (id, subject, sku, remaining, expires_at, charge_id, created_at, version)
         VALUES (@id, @subject, @sku, @remaining, @expiresAt, @chargeId, @createdAt, @version)
         ON CONFLICT(id) DO NOTHING`
      )
      .run({
        id: e.id,
        subject: e.subject,
        sku: e.sku,
        remaining: e.remaining,
        expiresAt: e.expiresAt,
        chargeId: e.chargeId,
        createdAt: e.createdAt,
        version: e.version,
      });
  }

  async claimSettlement(nonce: string): Promise<boolean> {
    // The primary key does the work: a second insert simply changes nothing.
    const r = this.#db
      .prepare('INSERT OR IGNORE INTO settlement_claims (nonce, claimed_at) VALUES (?, ?)')
      .run(nonce, this.#now());
    return r.changes === 1;
  }

  async putCharge(c: Charge): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO charges
           (nonce, id, subject, sku, amount, status, provider_ref, checkout_url,
            created_at, expires_at, settled_at, received_amount, last_polled_at, poll_count)
         VALUES
           (@nonce, @id, @subject, @sku, @amount, @status, @providerRef, @checkoutUrl,
            @createdAt, @expiresAt, @settledAt, @receivedAmount, @lastPolledAt, @pollCount)
         ON CONFLICT(nonce) DO UPDATE SET
           status = excluded.status,
           provider_ref = excluded.provider_ref,
           checkout_url = excluded.checkout_url`
      )
      .run({
        nonce: c.nonce,
        id: c.id,
        subject: c.subject,
        sku: c.sku,
        amount: c.amount,
        status: c.status,
        providerRef: c.providerRef,
        checkoutUrl: c.checkoutUrl,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
        settledAt: c.settledAt,
        receivedAmount: c.receivedAmount,
        lastPolledAt: c.lastPolledAt,
        pollCount: c.pollCount,
      });
  }

  async getCharge(nonce: string): Promise<Charge | undefined> {
    const row = this.#db
      .prepare<[string], ChargeRow>('SELECT * FROM charges WHERE nonce = ?')
      .get(nonce);
    return row ? toCharge(row) : undefined;
  }

  async updateCharge(nonce: string, patch: Partial<Charge>): Promise<void> {
    const columns: Record<string, string> = {
      status: 'status',
      providerRef: 'provider_ref',
      checkoutUrl: 'checkout_url',
      settledAt: 'settled_at',
      receivedAmount: 'received_amount',
      lastPolledAt: 'last_polled_at',
      pollCount: 'poll_count',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (key in patch) {
        sets.push(`${column} = ?`);
        values.push((patch as Record<string, unknown>)[key]);
      }
    }
    if (sets.length === 0) return;
    values.push(nonce);
    const r = this.#db.prepare(`UPDATE charges SET ${sets.join(', ')} WHERE nonce = ?`).run(...(values as never[]));
    if (r.changes === 0) throw new Error(`no charge with nonce ${nonce}`);
  }

  async pendingCharges(before: number = Number.MAX_SAFE_INTEGER): Promise<Charge[]> {
    return this.#db
      .prepare<[number], ChargeRow>(
        `SELECT * FROM charges WHERE status = 'pending' AND created_at <= ? ORDER BY created_at ASC`
      )
      .all(before)
      .map(toCharge);
  }

  async listEntitlements(subject: Subject): Promise<Entitlement[]> {
    return this.#db
      .prepare<[string], EntitlementRow>('SELECT * FROM entitlements WHERE subject = ?')
      .all(subject)
      .map(toEntitlement);
  }

  async putSubject(record: SubjectRecord): Promise<void> {
    this.#db
      .prepare(
        `INSERT INTO subjects (subject, created_at, last_seen_at, expires_at, bound_to)
         VALUES (@subject, @createdAt, @lastSeenAt, @expiresAt, @boundTo)
         ON CONFLICT(subject) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           expires_at   = excluded.expires_at,
           bound_to     = excluded.bound_to`
      )
      .run({
        subject: record.subject,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt,
        expiresAt: record.expiresAt,
        boundTo: record.boundTo,
      });
  }

  async getSubject(subject: Subject): Promise<SubjectRecord | undefined> {
    const row = this.#db
      .prepare<[string], SubjectRow>('SELECT * FROM subjects WHERE subject = ?')
      .get(subject);
    if (!row) return undefined;
    return {
      subject: row.subject,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      boundTo: row.bound_to,
    };
  }

  async sweepExpired(now: number): Promise<number> {
    const r = this.#db
      .prepare(`UPDATE charges SET status = 'abandoned' WHERE status = 'pending' AND expires_at <= ?`)
      .run(now);
    return r.changes;
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return {
    id: row.id,
    subject: row.subject,
    sku: row.sku,
    remaining: row.remaining,
    expiresAt: row.expires_at,
    chargeId: row.charge_id,
    createdAt: row.created_at,
    version: row.version,
  };
}

function toCharge(row: ChargeRow): Charge {
  return {
    id: row.id,
    nonce: row.nonce,
    subject: row.subject,
    sku: row.sku,
    amount: row.amount,
    status: row.status as ChargeStatus,
    providerRef: row.provider_ref,
    checkoutUrl: row.checkout_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    settledAt: row.settled_at,
    receivedAmount: row.received_amount,
    lastPolledAt: row.last_polled_at,
    pollCount: row.poll_count,
  };
}
