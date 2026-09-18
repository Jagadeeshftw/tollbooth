import type { UnderpaidChargeRow } from '@tollbooth/gateway-server';

function timeAgo(atMs: number, now: number): string {
  const mins = Math.max(0, Math.round((now - atMs) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Read-only: money that arrived short of the ask and was never granted —
 * Moove has no refund path, so this is the one place an operator finds out
 * without the payer telling them. Nothing here is actionable from the
 * dashboard; it is a display of what the ingest pipeline has already
 * recorded, same as every other panel on this page.
 */
export function UnderpaidAlerts({ rows, now }: { rows: readonly UnderpaidChargeRow[]; now: number }) {
  if (rows.length === 0) {
    return <p className="range-note">No underpaid settlements — every charge that settled met its ask, within tolerance.</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Charge</th>
            <th>Tool</th>
            <th>Sku</th>
            <th>Asked</th>
            <th>Received</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.chargeRef}>
              <td className="mono ref">{row.chargeRef.slice(0, 8)}…</td>
              <td>{row.tool ?? '—'}</td>
              <td className="mono">{row.sku}</td>
              <td className="mono">{row.amount ? `$${row.amount}` : '—'}</td>
              <td className="mono">
                {row.receivedAmount ? `$${row.receivedAmount}` : '—'}
                {row.receivedFraction !== null ? ` (${Math.round(row.receivedFraction * 100)}%)` : ''}
              </td>
              <td className="mono" style={{ color: 'var(--tb-fg-muted)' }}>
                {timeAgo(row.at, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
