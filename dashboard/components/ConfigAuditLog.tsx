import type { ConfigAuditEntry } from '@tollbooth/gateway-server';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const FIELD_LABEL: Record<string, string> = {
  amount: 'price',
  credits: 'credits',
  ttlMs: 'lifetime',
  label: 'label',
};

/** Business record: who changed what, and when — never a handle, nonce, link id or wallet address. */
export function ConfigAuditLog({ entries }: { entries: readonly ConfigAuditEntry[] }) {
  if (entries.length === 0) {
    return <p className="range-note">No price edits yet — this fills in the moment you change one above.</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Sku</th>
            <th>Field</th>
            <th>Change</th>
            <th>By</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="mono">{entry.sku}</td>
              <td>{FIELD_LABEL[entry.field] ?? entry.field}</td>
              <td className="mono">
                {entry.oldValue ?? '—'} → {entry.newValue ?? '—'}
              </td>
              <td>@{entry.actor}</td>
              <td className="mono" style={{ color: 'var(--tb-fg-muted)' }}>
                {formatDate(entry.changedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
