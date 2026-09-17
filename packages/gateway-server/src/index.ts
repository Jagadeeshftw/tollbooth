/**
 * @tollbooth/gateway-server — the hosted gateway's backend: GitHub sign-in, tenant
 * records, write-only ingest tokens, idempotent and reordering-tolerant
 * ingest, and the Neon schema and row-level security behind the dashboard.
 *
 * Depends on `@tollbooth/gateway-client` (for the wire-event contract both
 * sides share) and `pg`, and nothing else — enforced by
 * `scripts/check-boundaries.mjs`. No page code, no framework: this is the
 * backend, meant to be called from whatever HTTP layer the dashboard app
 * ends up using (its own separate, design-gated piece of work).
 *
 * Runs against its own Neon database, entirely separate from any tenant's
 * entitlement store — see `migrations.ts` for why that boundary is load-
 * bearing, not incidental.
 */

export { GatewayDatabase } from './db.js';
export type { GatewayDatabaseOptions } from './db.js';

export { MIGRATIONS, MIGRATIONS_TABLE, MIGRATION_ADVISORY_LOCK } from './migrations.js';
export type { Migration } from './migrations.js';

export {
  GithubOAuthError,
  exchangeGithubCode,
  fetchGithubUser,
  githubAuthorizeUrl,
} from './github-oauth.js';
export type { GithubOAuthConfig, GithubUser } from './github-oauth.js';

export { DEFAULT_SESSION_TTL_MS, issueSession, signSession, verifySession } from './session.js';
export type { SessionPayload } from './session.js';

export { getTenant, upsertTenantForGithubUser } from './tenants.js';
export type { Tenant } from './tenants.js';

export {
  authenticateIngestToken,
  issueTenantIngestToken,
  listTenantIngestTokens,
  revokeIngestToken,
} from './tokens.js';
export type { IngestTokenRecord } from './tokens.js';

export { hashIngestToken, issueIngestToken, verifyIngestToken } from './ingest-tokens.js';
export type { IssuedIngestToken } from './ingest-tokens.js';

export { ingestBatch } from './ingest.js';
export type { IngestResult } from './ingest.js';

export {
  creditsOutstanding,
  medianTimeToPaySeconds,
  overviewSummary,
  recentActivity,
  revenueByDay,
  settlementOutcomeCounts,
} from './queries.js';
export type { ActivityRow, CreditsOutstanding, DailyRevenue, OutcomeCounts, OverviewSummary } from './queries.js';

export { mintIngestToken, mintTenantId, secretsEqual } from './ids.js';
