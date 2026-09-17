import type { OutcomeCounts } from '@tollbooth/gateway-server';

const ROWS: { key: keyof OutcomeCounts; label: string; color: string }[] = [
  { key: 'granted', label: 'Granted', color: 'var(--tb-brand)' },
  { key: 'partial', label: 'Partial', color: 'var(--tb-warn)' },
  { key: 'underpaid', label: 'Underpaid', color: 'var(--gw-critical)' },
  { key: 'expired', label: 'Expired', color: 'var(--tb-fg-faint)' },
];

/**
 * Partial and underpaid are always their own rows — never folded into one
 * failure bucket. The three-zone settlement policy treats a short payment
 * inside tolerance, inside the pro-rata band, and below the floor as three
 * different outcomes, and a tenant needs to see which one actually happened.
 */
export function SettlementFunnel({ counts }: { counts: OutcomeCounts }) {
  const total = counts.granted + counts.partial + counts.underpaid + counts.expired;
  return (
    <div className="funnel">
      {ROWS.map((row) => {
        const n = counts[row.key];
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return (
          <div className="funnel-row" key={row.key}>
            <span className="funnel-dot" style={{ background: row.color }} />
            <span className="funnel-label">{row.label}</span>
            <span className="funnel-track">
              <span className="funnel-fill" style={{ width: `${pct}%`, background: row.color }} />
            </span>
            <span className="funnel-count mono">{n}</span>
          </div>
        );
      })}
    </div>
  );
}
