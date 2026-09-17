import { listTenantIngestTokens } from '@tollbooth/gateway-server';

import { TokensClient } from '@/components/TokensClient';
import { gatewayDb } from '@/lib/db';
import { requireTenant } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function TokensPage() {
  const tenant = await requireTenant();
  const tokens = await listTenantIngestTokens(gatewayDb(), tenant.id);

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Ingest tokens</h1>
          <p className="view-sub">What your server uses to send events here. Never your Moove key.</p>
        </div>
      </div>

      <div className="banner-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>
          A token can only send fingerprints, tool names, skus, amounts and timestamps — it cannot read your data back, and it cannot
          spend a tenant&rsquo;s credits. Stored here as a hash; shown to you in full exactly once, at creation.
        </span>
      </div>

      <TokensClient
        initialTokens={tokens.map((t) => ({ id: t.id, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }))}
      />
    </section>
  );
}
