import {
  creditsOutstanding,
  medianTimeToPaySeconds,
  overviewSummary,
  recentActivity,
  recentUnderpaidCharges,
  reportedPricesAndTools,
  revenueByDay,
  settlementOutcomeCounts,
} from '@tollbooth/gateway-server';

import { ActivityTable } from '@/components/ActivityTable';
import { PriceCatalogTable } from '@/components/PriceCatalogTable';
import { RevenueChart } from '@/components/RevenueChart';
import { SettlementFunnel } from '@/components/SettlementFunnel';
import { UnderpaidAlerts } from '@/components/UnderpaidAlerts';
import { gatewayDb } from '@/lib/db';
import { requireTenant } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function formatMedianPay(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export default async function OverviewPage() {
  const tenant = await requireTenant();
  const db = gatewayDb();
  const now = Date.now();

  const [summary, outcomes, outstanding, medianPay, revenueDays, activity, priceCatalog, underpaid] = await Promise.all([
    overviewSummary(db, tenant.id, 30, now),
    settlementOutcomeCounts(db, tenant.id, 30, now),
    creditsOutstanding(db, tenant.id),
    medianTimeToPaySeconds(db, tenant.id),
    revenueByDay(db, tenant.id, 30, now),
    recentActivity(db, tenant.id, 20),
    reportedPricesAndTools(db, tenant.id),
    recentUnderpaidCharges(db, tenant.id, 20),
  ]);

  const totalOpened = outcomes.granted + outcomes.partial + outcomes.underpaid + outcomes.expired;
  const conversion = summary.chargesOpened > 0 ? Math.round((summary.chargesConverted / summary.chargesOpened) * 100) : 0;
  const hasAnyData = summary.chargesOpened > 0 || totalOpened > 0 || activity.length > 0;

  const chartDays: { day: string; amount: number }[] = [];
  const byDay = new Map(revenueDays.map((d) => [d.day, Number(d.amount)]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    chartDays.push({ day: d, amount: byDay.get(d) ?? 0 });
  }

  const outstandingEntries = Object.entries(outstanding.bySku).filter(([, n]) => n !== 0);

  return (
    <section className="view">
      <div className="view-head">
        <div>
          <h1 className="view-title">Overview</h1>
          <p className="view-sub">What your paywall did — last 30 days.</p>
        </div>
      </div>

      {!hasAnyData ? (
        <div className="empty">
          <div className="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
          </div>
          <p className="empty-title">No events ingested yet</p>
          <p className="empty-body">
            Wire the gateway client into your server&rsquo;s paywall config, then a charge, a call or a settlement will show up here
            within seconds.
          </p>
          <div className="code-block">
            <span className="comment">// server.ts</span>
            <br />
            const gateway = new GatewayClient({'{'} endpoint, ingestToken {'}'})
            <br />
            gateway.start()
            <br />
            <br />
            withPaywall(mcp, {'{'}
            <br />
            &nbsp;&nbsp;provider, store,
            <br />
            &nbsp;&nbsp;onChargeOpened: gateway.onChargeOpened,
            <br />
            &nbsp;&nbsp;onCall: gateway.onCall,
            <br />
            &nbsp;&nbsp;onSettlement: gateway.onSettlement,
            <br />
            {'}'})
          </div>
        </div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile lead">
              <span className="tile-label">
                Credits outstanding<span className="tile-flag">only we know this</span>
              </span>
              <span className="tile-value mono">{outstanding.total.toLocaleString('en-US')} credits</span>
              <span className="tile-delta">{outstandingEntries.map(([sku, n]) => `${n.toLocaleString('en-US')} ${sku}`).join(' · ') || '—'}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Revenue (30d)</span>
              <span className="tile-value mono">${Number(summary.revenueAmount).toFixed(2)}</span>
              <span className="tile-delta">USDC received, granted + partial</span>
            </div>
            <div className="tile">
              <span className="tile-label">Median time to pay</span>
              <span className="tile-value mono">{formatMedianPay(medianPay)}</span>
              <span className="tile-delta">challenge issued → settlement observed</span>
            </div>
            <div className="tile">
              <span className="tile-label">Charges opened</span>
              <span className="tile-value mono">{summary.chargesOpened}</span>
              <span className="tile-delta">avg {(summary.chargesOpened / 30).toFixed(1)}/day</span>
            </div>
            <div className="tile">
              <span className="tile-label">Conversion</span>
              <span className="tile-value mono">{conversion}%</span>
              <span className="tile-delta">opened → granted or partial</span>
            </div>
            <div className="tile">
              <span className="tile-label">Tools selling</span>
              <span className="tile-value mono">{summary.toolsSelling.length}</span>
              <span className="tile-delta">{summary.toolsSelling.join(', ') || '—'}</span>
            </div>
          </div>

          <div className="panels">
            <div className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Revenue by day</h2>
                <span className="panel-caption">USDC received, granted + partial settlements</span>
              </div>
              <RevenueChart days={chartDays} />
              <span className="range-note">Fixed 30-day window for now. A date-range selector is deferred.</span>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2 className="panel-title">Settlement outcomes</h2>
                <span className="panel-caption">of {totalOpened} opened</span>
              </div>
              <SettlementFunnel counts={outcomes} />
              <span className="range-note">
                Partial and underpaid are shown separately, never folded into one failure bucket — the three-zone settlement policy
                treats them differently.
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Recent activity</h2>
              <span className="panel-caption">Most recent first</span>
            </div>
            <ActivityTable rows={activity} now={now} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Prices &amp; tools</h2>
              <span className="panel-caption">What your server has actually charged for</span>
            </div>
            {priceCatalog.length === 0 ? (
              <p className="range-note">No charges opened yet — a tool and its price show up here as soon as one is.</p>
            ) : (
              <PriceCatalogTable rows={priceCatalog} />
            )}
            <span className="range-note">
              Read-only. Reported by your server, not configured here — reprice on your side and this follows.
            </span>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Underpaid</h2>
              <span className="panel-caption">Settled short of the ask, never granted</span>
            </div>
            <UnderpaidAlerts rows={underpaid} now={now} />
          </div>
        </>
      )}
    </section>
  );
}
