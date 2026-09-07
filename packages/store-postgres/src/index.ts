import { Pool } from 'pg';
import type { PoolClient, PoolConfig, QueryResultRow } from 'pg';

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

import { MIGRATIONS, MIGRATIONS_TABLE, MIGRATION_ADVISORY_LOCK } from './migrations.js';

export interface PostgresStoreOptions {
  /** Neon pooled connection string. Use the *pooled* host, not the direct one. */
  connectionString: string;
  now?: () => number;
  /** Max pool size. Neon's pooler multiplexes, so this can stay small. */
  max?: number;
  /**
   * Attempts for connection-level failures. Neon suspends an idle branch, so
   * the first query after a quiet period can fail while the compute cold-starts.
   */
  maxRetries?: number;
  /** Base backoff between retries, in ms. */
  retryBaseMs?: number;
  ssl?: PoolConfig['ssl'];
  /** Skip migrations if something else owns the schema. */
  migrate?: boolean;
}

interface EntitlementRow {
  id: string;
  subject: string;
  sku: string;
  remaining: string | null;
  expires_at: string | null;
  charge_id: string;
  created_at: string;
  version: string;
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
  created_at: string;
  expires_at: string;
  settled_at: string | null;
  received_amount: string | null;
  last_polled_at: string | null;
  poll_count: string;
}

interface SubjectRow {
  subject: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  bound_to: string | null;
}

/**
 * Connection-level failures worth retrying.
 *
 * Neon suspends a branch that has been idle, so the first query after a quiet
 * period can arrive while the compute is still starting. That is a transient
 * infrastructure condition, not a bad request — but only a *connection* error
 * qualifies. A constraint violation or a syntax error is retried into the same
 * failure and must surface immediately.
 */
const RETRYABLE_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now — Neon cold start
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '53300', // too_many_connections
  'XX000', // internal_error, which Neon uses for some cold-start failures
]);

const RETRYABLE_MESSAGES = [
  'Connection terminated',
  'connection terminated',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'socket hang up',
  'Client has encountered a connection error',
  'terminating connection',
];

export function isRetryableConnectionError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.code && RETRYABLE_CODES.has(e.code)) return true;
  if (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'EPIPE') return true;
  const message = e.message ?? '';
  return RETRYABLE_MESSAGES.some((m) => message.includes(m));
}

/**
 * Thrown when a transaction's COMMIT itself failed at the connection level.
 *
 * This is the one case that must never be retried automatically: the commit may
 * have been applied before the acknowledgement was lost, and a blind retry
 * would spend the credit twice. Surfacing it lets the caller decide.
 */
export class AmbiguousCommitError extends Error {
  override readonly name = 'AmbiguousCommitError';
  constructor(cause: unknown) {
    super(
      'A Postgres COMMIT failed at the connection level, so it is unknown whether it ' +
        'applied. Not retried: doing so could spend the same credit twice. Re-read the ' +
        'balance before acting.',
      { cause }
    );
  }
}

const n = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Durable {@link EntitlementStore} on Postgres, built for Neon.
 *
 * `consume` runs in a transaction that takes a row lock (`SELECT … FOR UPDATE`)
 * and *also* keeps the optimistic version guard, so it has the same semantics as
 * the SQLite store from either direction. `claimSettlement` is a
 * unique-constraint insert, which makes exactly-once survive both restarts and
 * concurrent workers.
 */
export class PostgresEntitlementStore implements EntitlementStore {
  readonly #pool: Pool;
  readonly #now: () => number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;
  #ready: Promise<void> | undefined;
  readonly #migrate: boolean;

  constructor(options: PostgresStoreOptions) {
    if (!options.connectionString) {
      throw new Error('PostgresEntitlementStore requires a connectionString');
    }
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 5,
      // Neon's pooler closes idle connections; do not hold them long.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
    });
    // A pool-level error on an idle client must not take the process down.
    this.#pool.on('error', () => undefined);
    this.#now = options.now ?? Date.now;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#retryBaseMs = options.retryBaseMs ?? 250;
    this.#migrate = options.migrate ?? true;
  }

  /** Run migrations once. Safe to call concurrently from several instances. */
  async ready(): Promise<void> {
    if (!this.#ready) this.#ready = this.#runMigrations();
    return this.#ready;
  }

  async #runMigrations(): Promise<void> {
    if (!this.#migrate) return;
    await this.#withClient(async (client) => {
      await client.query(MIGRATIONS_TABLE);
      // Serialise concurrent booters. Released when the session ends.
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK]);
      try {
        const { rows } = await client.query<{ id: string }>('SELECT id FROM tollbooth_migrations');
        const applied = new Set(rows.map((r) => r.id));
        for (const migration of MIGRATIONS) {
          if (applied.has(migration.id)) continue;
          await client.query('BEGIN');
          try {
            for (const statement of migration.statements) await client.query(statement);
            await client.query(
              'INSERT INTO tollbooth_migrations (id, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [migration.id, this.#now()]
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK]).catch(
          () => undefined
        );
      }
    });
  }

  /**
   * Acquire a client and run `fn`, retrying connection-level failures with
   * jittered backoff. `fn` must be safe to run again from the start.
   */
  async #withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.#maxRetries; attempt++) {
      let client: PoolClient | undefined;
      try {
        client = await this.#pool.connect();
        return await fn(client);
      } catch (error) {
        lastError = error;
        if (error instanceof AmbiguousCommitError) throw error;
        if (!isRetryableConnectionError(error)) throw error;
        const delay = this.#retryBaseMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay / 2 + Math.random() * delay));
      } finally {
        client?.release();
      }
    }
    throw lastError;
  }

  async #query<T extends QueryResultRow>(sql: string, params: unknown[] = []) {
    await this.ready();
    return this.#withClient((client) => client.query<T>(sql, params));
  }

  // ------------------------------------------------------------ consume

  async consume(subject: Subject, sku: Sku, cost = 1): Promise<ConsumeResult> {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new RangeError(`cost must be a positive integer, received ${cost}`);
    }
    await this.ready();
    const now = this.#now();

    return this.#withClient(async (client) => {
      await client.query('BEGIN');
      let committed = false;
      try {
        // FOR UPDATE serialises competing spenders on this row; the version
        // guard below keeps the same semantics as the SQLite store.
        const { rows } = await client.query<EntitlementRow>(
          `SELECT * FROM tollbooth_entitlements
            WHERE subject = $1 AND sku = $2
              AND (expires_at IS NULL OR expires_at > $3)
              AND (remaining  IS NULL OR remaining >= $4)
            ORDER BY (remaining IS NULL) DESC,
                     COALESCE(expires_at, 9007199254740991) ASC,
                     remaining ASC
            LIMIT 1
            FOR UPDATE`,
          [subject, sku, now, cost]
        );

        const candidate = rows[0];
        if (!candidate) {
          const reason = await this.#failureReason(client, subject, sku, now);
          await client.query('COMMIT');
          committed = true;
          return { ok: false, reason };
        }

        const updated = await client.query(
          `UPDATE tollbooth_entitlements
              SET remaining = CASE WHEN remaining IS NULL THEN NULL ELSE remaining - $1 END,
                  version   = version + 1
            WHERE id = $2 AND version = $3`,
          [cost, candidate.id, candidate.version]
        );

        if (updated.rowCount !== 1) {
          await client.query('ROLLBACK');
          return { ok: false, reason: 'insufficient_credits' };
        }

        try {
          await client.query('COMMIT');
          committed = true;
        } catch (error) {
          // Never retried: it may have applied. See AmbiguousCommitError.
          throw new AmbiguousCommitError(error);
        }

        const remaining = n(candidate.remaining);
        return {
          ok: true,
          entitlementId: candidate.id,
          remaining: remaining === null ? null : remaining - cost,
          expiresAt: n(candidate.expires_at),
        };
      } catch (error) {
        if (!committed) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  async #failureReason(
    client: PoolClient,
    subject: string,
    sku: string,
    now: number
  ): Promise<'no_entitlement' | 'expired' | 'insufficient_credits'> {
    const any = await client.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM tollbooth_entitlements WHERE subject = $1 AND sku = $2',
      [subject, sku]
    );
    if (Number(any.rows[0]?.n ?? '0') === 0) return 'no_entitlement';

    const unexpired = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM tollbooth_entitlements
        WHERE subject = $1 AND sku = $2 AND (expires_at IS NULL OR expires_at > $3)`,
      [subject, sku, now]
    );
    return Number(unexpired.rows[0]?.n ?? '0') > 0 ? 'insufficient_credits' : 'expired';
  }

  // ------------------------------------------------------------ writes

  async grant(e: Entitlement): Promise<void> {
    await this.#query(
      `INSERT INTO tollbooth_entitlements
         (id, subject, sku, remaining, expires_at, charge_id, created_at, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.subject, e.sku, e.remaining, e.expiresAt, e.chargeId, e.createdAt, e.version]
    );
  }

  async claimSettlement(nonce: string): Promise<boolean> {
    const r = await this.#query(
      `INSERT INTO tollbooth_settlement_claims (nonce, claimed_at)
       VALUES ($1, $2) ON CONFLICT (nonce) DO NOTHING`,
      [nonce, this.#now()]
    );
    return r.rowCount === 1;
  }

  async putCharge(c: Charge): Promise<void> {
    await this.#query(
      `INSERT INTO tollbooth_charges
         (nonce, id, subject, sku, amount, status, provider_ref, checkout_url,
          created_at, expires_at, settled_at, received_amount, last_polled_at, poll_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (nonce) DO UPDATE SET
         status = EXCLUDED.status,
         provider_ref = EXCLUDED.provider_ref,
         checkout_url = EXCLUDED.checkout_url`,
      [
        c.nonce, c.id, c.subject, c.sku, c.amount, c.status, c.providerRef, c.checkoutUrl,
        c.createdAt, c.expiresAt, c.settledAt, c.receivedAmount, c.lastPolledAt, c.pollCount,
      ]
    );
  }

  async getCharge(nonce: string): Promise<Charge | undefined> {
    const { rows } = await this.#query<ChargeRow>(
      'SELECT * FROM tollbooth_charges WHERE nonce = $1',
      [nonce]
    );
    return rows[0] ? toCharge(rows[0]) : undefined;
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
        values.push((patch as Record<string, unknown>)[key]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length === 0) return;
    values.push(nonce);
    const r = await this.#query(
      `UPDATE tollbooth_charges SET ${sets.join(', ')} WHERE nonce = $${values.length}`,
      values
    );
    if (r.rowCount === 0) throw new Error(`no charge with nonce ${nonce}`);
  }

  async pendingCharges(before: number = Number.MAX_SAFE_INTEGER): Promise<Charge[]> {
    const { rows } = await this.#query<ChargeRow>(
      `SELECT * FROM tollbooth_charges
        WHERE status = 'pending' AND created_at <= $1
        ORDER BY created_at ASC`,
      [before]
    );
    return rows.map(toCharge);
  }

  async listEntitlements(subject: Subject): Promise<Entitlement[]> {
    const { rows } = await this.#query<EntitlementRow>(
      'SELECT * FROM tollbooth_entitlements WHERE subject = $1',
      [subject]
    );
    return rows.map(toEntitlement);
  }

  async putSubject(record: SubjectRecord): Promise<void> {
    await this.#query(
      `INSERT INTO tollbooth_subjects (subject, created_at, last_seen_at, expires_at, bound_to)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (subject) DO UPDATE SET
         last_seen_at = EXCLUDED.last_seen_at,
         expires_at   = EXCLUDED.expires_at,
         bound_to     = EXCLUDED.bound_to`,
      [record.subject, record.createdAt, record.lastSeenAt, record.expiresAt, record.boundTo]
    );
  }

  async getSubject(subject: Subject): Promise<SubjectRecord | undefined> {
    const { rows } = await this.#query<SubjectRow>(
      'SELECT * FROM tollbooth_subjects WHERE subject = $1',
      [subject]
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      subject: row.subject,
      createdAt: Number(row.created_at),
      lastSeenAt: Number(row.last_seen_at),
      expiresAt: Number(row.expires_at),
      boundTo: row.bound_to,
    };
  }

  async sweepExpired(now: number): Promise<number> {
    const r = await this.#query(
      `UPDATE tollbooth_charges SET status = 'abandoned'
        WHERE status = 'pending' AND expires_at <= $1`,
      [now]
    );
    return r.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return {
    id: row.id,
    subject: row.subject,
    sku: row.sku,
    remaining: n(row.remaining),
    expiresAt: n(row.expires_at),
    chargeId: row.charge_id,
    createdAt: Number(row.created_at),
    version: Number(row.version),
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
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    settledAt: n(row.settled_at),
    receivedAmount: row.received_amount,
    lastPolledAt: n(row.last_polled_at),
    pollCount: Number(row.poll_count),
  };
}

export { MIGRATIONS } from './migrations.js';
