#!/usr/bin/env node
/**
 * Public entrypoint: Streamable HTTP, for deploying somewhere an agent can
 * reach. A single transport serves every request: the server is stateless,
 * which is what the newer protocol revisions assume anyway.
 */
import { createServer as createHttpServer } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PostgresEntitlementStore } from '@tollbooth/store-postgres';

import { createServer } from './server.js';

const apiKey = process.env['MOOVE_API_KEY'];
if (!apiKey) {
  console.error('MOOVE_API_KEY is not set. See https://www.moove.xyz/dashboard/api-keys');
  process.exit(1);
}

const PORT = Number(process.env['PORT'] ?? 8080);

/**
 * Postgres when a connection string is present, SQLite otherwise.
 *
 * Deployment runs on Postgres because a container filesystem does not survive a
 * redeploy, and entitlements people paid for must. SQLite stays the zero-config
 * default for anyone running this locally.
 */
const databaseUrl = process.env['DATABASE_URL'] ?? process.env['TOLLBOOTH_POSTGRES_URL'];
const store = databaseUrl
  ? new PostgresEntitlementStore({ connectionString: databaseUrl })
  : undefined;
if (store) {
  await store.ready();
  console.error('[research-tools] store: postgres');
} else {
  console.error('[research-tools] store: sqlite (set DATABASE_URL for Postgres)');
}

const { provider, buildServer } = createServer({
  apiKey,
  ...(process.env['MOOVE_API_BASE_URL'] ? { baseUrl: process.env['MOOVE_API_BASE_URL'] } : {}),
  ...(store ? { store } : { databasePath: process.env['TOLLBOOTH_DB'] ?? '/data/tollbooth.sqlite' }),
});

const http = createHttpServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        store: databaseUrl ? 'postgres' : 'sqlite',
        prices: provider.listPrices().map((p) => p.sku),
      })
    );
    return;
  }
  if (req.url !== '/mcp') {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    // A fresh McpServer and transport per request. This is the SDK's stateless
    // pattern: an McpServer cannot be re-connected to a second transport, and
    // a shared transport with no session id has nothing to correlate a
    // follow-up request against. Only tool registration is repeated — the
    // store, provider and rate limiter are process-wide singletons.
    const mcp = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void mcp.close?.();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('[research-tools] request failed', error);
    if (!res.headersSent) res.writeHead(500).end('internal error');
  }
});

// The retry path settles almost everything; this catches what it missed.
const reconciler = setInterval(() => {
  provider.reconcile().catch((e) => console.error('[research-tools] reconcile failed', e));
}, 5 * 60 * 1000);
reconciler.unref();

http.listen(PORT, () => console.error(`[research-tools] listening on :${PORT}/mcp`));
