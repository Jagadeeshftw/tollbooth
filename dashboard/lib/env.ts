/**
 * Central, fail-loud env access. Every value the dashboard needs to run is
 * named here once, so a missing one fails at the call site with its own
 * name, not three files deep in a stack trace.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See dashboard/README.md for what the dashboard needs.`);
  return value;
}

export const env = {
  /** The gateway's own Neon database — never a tenant's entitlement store. */
  get gatewayDatabaseUrl() {
    return required('GATEWAY_DATABASE_URL');
  },
  get githubClientId() {
    return required('GITHUB_CLIENT_ID');
  },
  get githubClientSecret() {
    return required('GITHUB_CLIENT_SECRET');
  },
  /** Signs session cookies. A long random string; rotating it signs everyone out. */
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  /** This deployment's own origin, e.g. https://app.tollbooth.0xo.in — used to build the OAuth callback and cookie settings. */
  get baseUrl() {
    return (process.env['DASHBOARD_BASE_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');
  },
};
