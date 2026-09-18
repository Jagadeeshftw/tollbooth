import type { PriceCatalogEntry } from '@tollbooth/gateway-server';

/** Read-only: derived entirely from charge_opened events already ingested — never configured here. */
export function PriceCatalogTable({ rows }: { rows: readonly PriceCatalogEntry[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Sku</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.tool}:${row.sku}`}>
              <td>{row.tool}</td>
              <td className="mono">{row.sku}</td>
              <td className="mono">
                {row.amount} {row.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
