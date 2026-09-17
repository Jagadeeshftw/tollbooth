const PILL_CLASS: Record<string, string> = {
  granted: 'pill-good',
  partial: 'pill-warn',
  underpaid: 'pill-critical',
  expired: 'pill-neutral',
  pending: 'pill-neutral',
};

const PILL_LABEL: Record<string, string> = {
  granted: 'Granted',
  partial: 'Partial',
  underpaid: 'Underpaid',
  expired: 'Expired',
  pending: 'Pending',
};

function PillIcon({ status }: { status: string }) {
  switch (status) {
    case 'granted':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'partial':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      );
    case 'underpaid':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="12" y1="9" x2="12" y2="14" />
          <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
        </svg>
      );
    case 'expired':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

/** `status: null` (opened but not yet settled) renders as "Pending" — never invented as a real outcome. */
export function StatusPill({ status }: { status: string | null }) {
  const key = status ?? 'pending';
  return (
    <span className={`pill ${PILL_CLASS[key] ?? 'pill-neutral'}`}>
      <PillIcon status={key} />
      {PILL_LABEL[key] ?? key}
    </span>
  );
}
