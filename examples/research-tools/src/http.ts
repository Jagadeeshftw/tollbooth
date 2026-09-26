#!/usr/bin/env node
/**
 * Public entrypoint: Streamable HTTP, for deploying somewhere an agent can
 * reach. A single transport serves every request: the server is stateless,
 * which is what the newer protocol revisions assume anyway.
 */
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { GatewayClient } from '@tollbooth/gateway-client';
import {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  parseWebhookEvent,
  verifyWebhookSignature,
} from '@tollbooth/moove';
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

/**
 * Report to a Tollbooth gateway dashboard when both are set; run exactly as
 * before when either is missing. Telemetry only: the gateway never sees the
 * Moove key, a payment handle or a link id, and a gateway outage cannot fail
 * a paid call.
 */
const gatewayEndpoint = process.env['TOLLBOOTH_GATEWAY_ENDPOINT'];
const ingestToken = process.env['TOLLBOOTH_INGEST_TOKEN'];
const gateway =
  gatewayEndpoint && ingestToken
    ? new GatewayClient({
        endpoint: gatewayEndpoint,
        ingestToken,
        onDropped: (events, error) =>
          console.error(`[research-tools] gateway dropped ${events.length} event(s)`, String(error)),
      })
    : undefined;
if (gateway) {
  gateway.start();
  console.error(`[research-tools] gateway: reporting to ${new URL(gatewayEndpoint!).origin}`);
} else {
  console.error('[research-tools] gateway: off (set TOLLBOOTH_GATEWAY_ENDPOINT and TOLLBOOTH_INGEST_TOKEN)');
}

const { provider, buildServer } = createServer({
  apiKey,
  ...(process.env['MOOVE_API_BASE_URL'] ? { baseUrl: process.env['MOOVE_API_BASE_URL'] } : {}),
  ...(store ? { store } : { databasePath: process.env['TOLLBOOTH_DB'] ?? '/data/tollbooth.sqlite' }),
  ...(gateway
    ? {
        telemetry: {
          onChargeOpened: gateway.onChargeOpened,
          onCall: gateway.onCall,
          onSettlement: gateway.onSettlement,
        },
      }
    : {}),
});

/**
 * Moove webhooks: the push half of settlement.
 *
 * Registered once in the Moove console — there is no API for it, deliberately,
 * since a key that could register a destination could copy every settled
 * payment somewhere its holder controls. Without the secret this route is off
 * and polling carries settlement alone, exactly as before.
 */
const webhookSecret = process.env['MOOVE_WEBHOOK_SECRET'];
const WEBHOOK_MAX_BYTES = 64 * 1024;

if (webhookSecret) {
  console.error('[research-tools] webhooks: on, POST /moove/webhook (signature required)');
} else {
  console.error('[research-tools] webhooks: off (set MOOVE_WEBHOOK_SECRET); settlement falls back to polling');
}

/** Read the body as bytes. The signature covers what was sent, not a re-serialisation of it. */
function readRawBody(req: IncomingMessage, limit = WEBHOOK_MAX_BYTES): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/**
 * The work a delivery triggers, run after the response has gone out.
 *
 * Moove gives the request 10 seconds and retries anything that is not a 2xx,
 * so settling inline would turn one slow Neon query into a duplicate delivery
 * of our own making. If this process dies between the 200 and the settle, the
 * reconciler finds the charge anyway — that is what it is for.
 */
function handleWebhookEvent(event: ReturnType<typeof parseWebhookEvent>): void {
  if (!event) return;
  setImmediate(() => {
    void provider
      .settleFromWebhook(event)
      .then((result) => {
        if (!result.handled) {
          console.error(
            `[tollbooth] ${JSON.stringify({ evt: 'webhook', id: event.id, type: event.type, handled: false, reason: result.reason })}`
          );
          return;
        }
        gateway?.onSettlement(result.outcome);
        console.error(
          `[tollbooth] ${JSON.stringify({
            evt: 'webhook',
            id: event.id,
            type: event.type,
            outcome: result.outcome.status,
            at: new Date().toISOString(),
          })}`
        );
      })
      .catch((error) => console.error(`[research-tools] webhook settle failed for ${event.id}`, error));
  });
}

/** Where a person landing on the bare URL should be sent. */
const LANDING_URL = process.env['TOLLBOOTH_LANDING_URL'] ?? 'https://tollbooth.0xo.in';
const REPO_URL = 'https://github.com/Jagadeeshftw/tollbooth';

const http = createHttpServer(async (req, res) => {
  // The first thing anyone visiting the URL sees. A descriptor, not a page:
  // the page lives at LANDING_URL, and an agent probing this host wants JSON.
  if (req.url === '/' || req.url === '') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          name: 'tollbooth-research-tools',
          description:
            'A paid MCP server built with Tollbooth. Three research tools behind a ' +
            'credit pack: an agent calls a tool, gets a payment challenge, a human pays, ' +
            'the agent retries.',
          mcp: { endpoint: '/mcp', transport: 'streamable-http', protocolVersion: '2025-11-25' },
          health: '/health',
          repo: REPO_URL,
          landing: LANDING_URL,
          tools: ['fetch_readable', 'extract_tables', 'inspect_domain'],
        },
        null,
        2
      )
    );
    return;
  }
  if (req.url === '/moove/webhook') {
    const receivedAt = Date.now();
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    if (!webhookSecret) {
      // Nothing can be verified, so nothing is accepted. 503 rather than 404:
      // a misconfigured deployment should look broken, not absent.
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'webhooks not configured' }));
      return;
    }

    const raw = await readRawBody(req);
    if (!raw) {
      res.writeHead(413).end();
      return;
    }

    const headerOf = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };

    // An unsigned, mis-signed or stale delivery is hostile, not malformed: the
    // URL is public and anyone can POST to it.
    if (
      !verifyWebhookSignature({
        rawBody: raw,
        signature: headerOf(SIGNATURE_HEADER),
        timestamp: headerOf(TIMESTAMP_HEADER),
        secret: webhookSecret,
      })
    ) {
      console.error(`[research-tools] webhook rejected: bad signature or stale timestamp (${headerOf(EVENT_ID_HEADER) ?? 'no id'})`);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid signature' }));
      return;
    }

    const event = parseWebhookEvent(raw);

    // Acknowledge first; settle after. Any 2xx ends the delivery.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ received: true }));

    // Logged after the ack, so measuring does not become part of what is
    // measured. Every event id is recorded, delivered or not: a duplicate
    // shows up here before it is worth a table to catch it, and the arrival
    // time and ack latency are the only record of how this endpoint behaved —
    // Moove's console shows its own side of the delivery, not ours.
    console.error(
      `[tollbooth] ${JSON.stringify({
        evt: 'webhook_received',
        id: event?.id ?? headerOf(EVENT_ID_HEADER) ?? null,
        type: event?.type ?? null,
        at: new Date().toISOString(),
        ackMs: Date.now() - receivedAt,
        signedAt: headerOf(TIMESTAMP_HEADER) ?? null,
      })}`
    );

    handleWebhookEvent(event);
    return;
  }

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
// Its outcomes go to the gateway too: a payer who never retries is settled
// only here, and the paywall's own onSettlement never sees that.
//
// TOLLBOOTH_RECONCILE=off pauses the sweep so the only thing that can grant
// is an explicit retry — for inspecting a live payment before anything is
// granted against it. A payer's own retry still settles as normal.
if (process.env['TOLLBOOTH_RECONCILE'] === 'off') {
  console.error('[research-tools] reconciler: paused (TOLLBOOTH_RECONCILE=off); only retries settle');
} else {
  const reconciler = setInterval(() => {
    provider
      .reconcile()
      .then((outcomes) => outcomes.forEach((o) => gateway?.onSettlement(o)))
      .catch((e) => console.error('[research-tools] reconcile failed', e));
  }, 5 * 60 * 1000);
  reconciler.unref();
}

http.listen(PORT, () => console.error(`[research-tools] listening on :${PORT}/mcp`));

// A redeploy sends SIGTERM. Send whatever telemetry is still queued first,
// but never let a slow or unreachable gateway hold the container open.
process.once('SIGTERM', () => {
  http.close();
  const flushed = gateway?.stop() ?? Promise.resolve();
  const cap = new Promise((resolve) => setTimeout(resolve, 5000).unref());
  void Promise.race([flushed, cap]).finally(() => process.exit(0));
});
