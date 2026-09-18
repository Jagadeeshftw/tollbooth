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

## Running the tests

```bash
TOLLBOOTH_DASHBOARD_TEST_POSTGRES_URL=postgresql://... \
npm run test --workspace=@tollbooth/dashboard
```

Needs the same non-superuser, non-`BYPASSRLS` role as `@tollbooth/gateway-server`'s own suite (see
that package's `test/helpers.ts`) — pointed at its own throwaway database, never `DATABASE_URL` or
`GATEWAY_DATABASE_URL`, since this truncates every gateway table on each run. `pretest` runs a real
production build first; the tests then spawn a real `next start` server and talk to it over HTTP —
`cookies()` needs the request context only a running server provides, so nothing here calls route
handlers directly. Covers the auth gate (unauthenticated and tampered-cookie requests redirect to
`/login`; a valid session reaches `/` and `/tokens`) and `/api/ingest` (missing/invalid bearer token,
a valid batch, and a byte-for-byte replayed batch reporting fully duplicate rather than being
double-counted).

## What isn't built yet

- Revenue and Usage detail pages, and Settings — stubbed in the sidebar, not designed.
- The test suite above isn't wired into CI yet.
