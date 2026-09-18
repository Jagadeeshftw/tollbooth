'use client';

import { useState, useTransition } from 'react';

import { updatePriceAction } from '@/app/(app)/actions';
import type { EffectivePriceRow } from '@tollbooth/gateway-server';

export function PriceConfigEditor({ initialRows }: { initialRows: EffectivePriceRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEdit(row: EffectivePriceRow) {
    setEditing(row.sku);
    setDraft(row.amount);
    setError(null);
  }

  function save(sku: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updatePriceAction({ sku, amount: draft });
        setRows((prev) => prev.map((r) => (r.sku === sku ? { ...r, amount: result.amount, configured: true } : r)));
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'could not save');
      }
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Sku</th>
            <th>Price</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sku}>
              <td>{row.tool}</td>
              <td className="mono">{row.sku}</td>
              <td className="mono">
                {editing === row.sku ? (
                  <input
                    className="mono"
                    style={{ width: 90, background: 'transparent', border: '1px solid var(--tb-line)', borderRadius: 4, padding: '2px 6px' }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={isPending}
                    autoFocus
                  />
                ) : (
                  <>
                    {row.amount} USDC
                    {row.configured && (
                      <span className="tile-flag" style={{ marginLeft: 6 }}>
                        edited
                      </span>
                    )}
                  </>
                )}
              </td>
              <td>
                {editing === row.sku ? (
                  <>
                    <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => save(row.sku)} disabled={isPending}>
                      Save
                    </button>{' '}
                    <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => setEditing(null)} disabled={isPending}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => startEdit(row)}>
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <p className="range-note" style={{ color: 'var(--gw-critical)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
