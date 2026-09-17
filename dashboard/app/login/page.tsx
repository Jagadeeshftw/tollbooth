const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'That sign-in link expired or was already used. Try again.',
  sign_in_failed: 'GitHub sign-in failed. Try again.',
  access_denied: 'Sign-in was cancelled.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--tb-bg)',
        color: 'var(--tb-fg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          border: '1px solid var(--tb-line)',
          borderRadius: 'var(--gw-radius)',
          background: 'var(--tb-bg-raised)',
          boxShadow: 'var(--tb-shadow)',
          padding: '32px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          textAlign: 'center',
        }}
      >
        <div className="wordmark" style={{ justifyContent: 'center' }}>
          <span className="wordmark-name">Tollbooth</span>
          <span className="wordmark-sub">Gateway</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--tb-fg-muted)', margin: 0 }}>
          See what your paywall did, and manage the tokens your server uses to tell us.
        </p>
        {error && (
          <p style={{ fontSize: 12.5, color: 'var(--gw-critical)', background: 'var(--gw-critical-soft)', borderRadius: 6, padding: '8px 10px', margin: 0 }}>
            {ERROR_MESSAGES[error] ?? 'Something went wrong signing in.'}
          </p>
        )}
        <a href="/api/auth/login" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}
