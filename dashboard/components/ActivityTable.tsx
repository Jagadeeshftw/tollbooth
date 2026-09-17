import type { ActivityRow } from '@tollbooth/gateway-server';

import { StatusPill } from './StatusPill';

function timeAgo(atMs: number, now: number): string {
  const mins = Math.max(0, Math.round((now - atMs) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ActivityTable({ rows, now }: { rows: readonly ActivityRow[]; now: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Charge</th>
            <th>Tool</th>
            <th>Sku</th>
            <th>Amount</th>
            <th>Status</th>
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
              <td>
                <StatusPill status={row.status} />
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
