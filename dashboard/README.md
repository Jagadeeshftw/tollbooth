# Tollbooth Gateway dashboard

The hosted gateway's own UI — `app.tollbooth.0xo.in`, separate from the marketing site.
GitHub sign-in, the Overview and Ingest Tokens views from the approved design, and the
`/api/ingest` endpoint `@tollbooth/gateway-client` posts to.

## Environment variables

| Variable | What it's for |
| --- | --- |
| `GATEWAY_DATABASE_URL` | The gateway's own Neon database — never a tenant's entitlement store. A separate Neon project, per the architecture decision. |
| `GITHUB_CLIENT_ID` | From the GitHub OAuth App below. |
| `GITHUB_CLIENT_SECRET` | From the same app. Never committed; set as a platform secret. |
| `SESSION_SECRET` | A long random string signing session cookies. Rotating it signs everyone out; treat it like a credential. |
| `DASHBOARD_BASE_URL` | This deployment's own origin, e.g. `https://app.tollbooth.0xo.in`. Used to build the OAuth callback URL and defaults to `http://localhost:3000` for local dev. |

## The GitHub OAuth App

Register one at <https://github.com/settings/developers> → New OAuth App:

- **Application name**: `Tollbooth Gateway` (or similar — shown to the tenant on the GitHub consent screen).
- **Homepage URL**: `https://app.tollbooth.0xo.in`
- **Authorization callback URL**: `https://app.tollbooth.0xo.in/api/auth/callback`

For local development, a second OAuth App (or GitHub's own multiple-callback support, if enabled) pointing at
`http://localhost:3000/api/auth/callback` is needed — GitHub matches the callback URL exactly.

The requested scope is `read:user` only — identity, never repo or write access. This account signs a tenant
in; it never touches anything else in their GitHub account.

## Local development

```bash
# from the repo root, once
npm install

# a local Postgres for the gateway's own schema — never a tenant's entitlement store
GATEWAY_DATABASE_URL=postgresql://... \
GITHUB_CLIENT_ID=... \
GITHUB_CLIENT_SECRET=... \
SESSION_SECRET=$(openssl rand -base64 32) \
DASHBOARD_BASE_URL=http://localhost:3000 \
npm run dev --workspace=@tollbooth/dashboard
```

`GatewayDatabase` runs its own migrations on first connection and refuses to boot against a
Postgres superuser or a `BYPASSRLS` role — see `@tollbooth/gateway-server`'s own README for why.

## What isn't built yet

- Revenue and Usage detail pages, and Settings — stubbed in the sidebar, not designed.
- No automated test suite for this app specifically (the backend it calls,
  `@tollbooth/gateway-server`, has full coverage; this app was verified manually — a real
  seeded database, real GitHub-shaped session cookies, real Server Action round trips,
  screenshotted at 1440 and 390 in both themes — but that verification does not run in CI).
