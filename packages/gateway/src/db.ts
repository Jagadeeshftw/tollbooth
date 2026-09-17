import { Pool } from 'pg';
import type { PoolClient, PoolConfig } from 'pg';

import { MIGRATIONS, MIGRATIONS_TABLE, MIGRATION_ADVISORY_LOCK } from './migrations.js';

export interface GatewayDatabaseOptions {
  /** The gateway's own Neon connection string — never a tenant's entitlement-store URL. */
  connectionString: string;
  now?: () => number;
  max?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  ssl?: PoolConfig['ssl'];
  migrate?: boolean;
}

/**
 * Connection-level failures worth retrying. Duplicated from
 * `@tollbooth/store-postgres` rather than shared: this package does not
 * depend on that one, deliberately — a bug in the gateway's schema code must
 * never be able to reach a tenant's entitlement store through a shared
 * import, any more than through a shared connection.
 */
const RETRYABLE_CODES = new Set([
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '53300',
  'XX000',
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

function isRetryableConnectionError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | undefined;
  if (!e) return false;
  if (e.code && RETRYABLE_CODES.has(e.code)) return true;
  const message = e.message ?? '';
  return RETRYABLE_MESSAGES.some((m) => message.includes(m));
}

/**
 * The gateway's own database. Every tenant-scoped read or write goes through
 * {@link withTenant}, which sets `app.tenant_id` for the transaction and
 * nothing outside it — row-level security policies in `migrations.ts` do the
 * actual enforcement; this is just the one place that GUC is ever set.
 */
export class GatewayDatabase {
  readonly #pool: Pool;
  readonly #now: () => number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;
  readonly #migrate: boolean;
  #ready: Promise<void> | undefined;

  constructor(options: GatewayDatabaseOptions) {
    if (!options.connectionString) {
      throw new Error('GatewayDatabase requires a connectionString');
    }
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
    });
    this.#pool.on('error', () => undefined);
    this.#now = options.now ?? Date.now;
    this.#maxRetries = options.maxRetries ?? 5;
    this.#retryBaseMs = options.retryBaseMs ?? 250;
    this.#migrate = options.migrate ?? true;
  }

  async ready(): Promise<void> {
    if (!this.#ready) this.#ready = this.#boot();
    return this.#ready;
  }

  async #boot(): Promise<void> {
    await this.#assertNotSuperuser();
    await this.#runMigrations();
  }

  /**
   * Postgres exempts superusers and any role with BYPASSRLS from row-level
   * security unconditionally — `FORCE ROW LEVEL SECURITY` does not override
   * it. A connection string that resolves to such a role would make every
   * tenant-isolation policy in this schema silently do nothing, with no
   * error and no symptom until a real cross-tenant read happened. Refusing
   * to boot against one is cheap insurance for exactly the guarantee this
   * package exists to keep. Neon's own connection roles are ordinary,
   * non-superuser roles, so this should never trip in normal operation.
   */
  async #assertNotSuperuser(): Promise<void> {
    await this.#withClient(async (client) => {
      const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
      );
      const role = rows[0];
      if (role?.rolsuper || role?.rolbypassrls) {
        throw new Error(
          'GatewayDatabase refuses to run as a Postgres superuser or a role with BYPASSRLS: ' +
            'row-level security is unconditionally bypassed for both, which would make every ' +
            'tenant-isolation policy in this schema silently do nothing. Use an ordinary role.'
        );
      }
    });
  }

  async #runMigrations(): Promise<void> {
    if (!this.#migrate) return;
    await this.#withClient(async (client) => {
      await client.query(MIGRATIONS_TABLE);
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK]);
      try {
        const { rows } = await client.query<{ id: string }>('SELECT id FROM gateway_migrations');
        const applied = new Set(rows.map((r) => r.id));
        for (const migration of MIGRATIONS) {
          if (applied.has(migration.id)) continue;
          await client.query('BEGIN');
          try {
            for (const statement of migration.statements) await client.query(statement);
            await client.query(
              'INSERT INTO gateway_migrations (id, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [migration.id, this.#now()]
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw error;
          }
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK]).catch(() => undefined);
      }
    });
  }

  async #withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.#maxRetries; attempt++) {
      let client: PoolClient | undefined;
      try {
        client = await this.#pool.connect();
        return await fn(client);
      } catch (error) {
        lastError = error;
        if (!isRetryableConnectionError(error)) throw error;
        const delay = this.#retryBaseMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay / 2 + Math.random() * delay));
      } finally {
        client?.release();
      }
    }
    throw lastError;
  }

  /**
   * Run `fn` inside a transaction with `app.tenant_id` set to `tenantId` for
   * that transaction only (`set_config`'s third argument — `is_local` —
   * means it resets the instant the transaction ends, never leaking onto a
   * pooled connection's next, unrelated use). Every row-level security
   * policy in this schema keys off exactly this setting. There is no other
   * path in this class that touches a tenant-scoped table.
   */
  async withTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready();
    return this.#withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  /**
   * For the auth tables only — `gateway_tenants` and `gateway_ingest_tokens`
   * — which carry no row-level security and no tenant context to set. See
   * `migrations.ts` for why. Every query here must filter explicitly.
   */
  async withoutTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready();
    return this.#withClient(fn);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
