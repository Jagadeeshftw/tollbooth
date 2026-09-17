'use client';

import { useState, useTransition } from 'react';

import { issueTokenAction, revokeTokenAction } from '@/app/(app)/tokens/actions';

export interface TokenRow {
  id: string;
  createdAt: number;
  lastUsedAt: number | null;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatLastUsed(ms: number | null): string {
  if (ms === null) return 'never';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return formatDate(ms);
}

export function TokensClient({ initialTokens }: { initialTokens: TokenRow[] }) {
  const [tokens, setTokens] = useState(initialTokens);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onIssue() {
    startTransition(async () => {
      const result = await issueTokenAction();
      setRevealed(result.token);
      setTokens((prev) => [{ id: result.id, createdAt: result.createdAt, lastUsedAt: null }, ...prev]);
    });
  }

  function onRevoke(id: string) {
    startTransition(async () => {
      await revokeTokenAction(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
    });
  }

  return (
    <>
      <div className="panel">
        <div className="token-issue">
          <div className="token-issue-copy">
            <p style={{ fontWeight: 600, color: 'var(--tb-fg)', fontSize: 13, marginBottom: 2 }}>Create a new token</p>
            <p>You can hold more than one — issue a fresh one per server if you run several.</p>
          </div>
          <button className="btn btn-primary" onClick={onIssue} disabled={isPending}>
            New ingest token
          </button>
        </div>

        {revealed && (
          <div className="reveal-banner">
            <div className="reveal-banner-copy">
              <span className="reveal-label">Shown once — copy it now</span>
              <span className="reveal-token mono">{revealed}</span>
            </div>
            <button className="btn btn-ghost" onClick={() => setRevealed(null)}>
              Done
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Active tokens</h2>
        </div>
        {tokens.length === 0 ? (
          <p style={{ fontSize: 12.5, color: 'var(--tb-fg-muted)', padding: '12px 0' }}>No tokens yet. Create one above.</p>
        ) : (
          tokens.map((t) => (
            <div className="token-row" key={t.id}>
              <div className="token-main">
                <span className="token-id mono">{t.id.slice(0, 16)}…</span>
                <span className="token-meta">
                  Created {formatDate(t.createdAt)} · last used {formatLastUsed(t.lastUsedAt)}
                </span>
              </div>
              <button className="btn-danger-ghost btn" onClick={() => onRevoke(t.id)} disabled={isPending}>
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}
