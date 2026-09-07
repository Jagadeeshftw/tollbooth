import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { definePrice } from '@tollbooth/core';
import type { EntitlementStore } from '@tollbooth/core';
import { withPaywall } from '@tollbooth/mcp';
import { MooveClient, MooveProvider } from '@tollbooth/moove';
import { SqliteEntitlementStore } from '@tollbooth/store-sqlite';
import { z } from 'zod';

import { PerSubjectRateLimiter, RateLimitedError, TimeoutError, withDeadline } from './limits.js';
import { ToolError, extractTables, fetchReadable, inspectDomain } from './tools.js';

/**
 * Everything this server sells.
 *
 * One credit pack at the $5 floor and one at the recommended default. Both are
 * priced so a pack lasts a working session: interrupting a human to buy more
 * costs them far more than the money does.
 */
export const PRICES = [
  definePrice({
    sku: 'research',
    unit: 'credit_pack',
    amount: '5.00',
    credits: 250,
    label: 'Research tools — 250 credits',
  }),
  definePrice({
    sku: 'research-large',
    unit: 'credit_pack',
    amount: '20.00',
    credits: 1200,
    label: 'Research tools — 1200 credits',
  }),
];

/** Hard ceiling on any one tool call, covering DNS, TLS, fetch and parsing. */
const TOOL_DEADLINE_MS = 20_000;

export interface ServerOptions {
  apiKey: string;
  baseUrl?: string;
  databasePath?: string;
  store?: EntitlementStore;
  /** Sustained calls per second per payment handle. */
  ratePerSecond?: number;
  burst?: number;
}

/**
 * Build the store, provider and rate limiter once.
 *
 * These are process-wide: a pool, a database and a token bucket. Only the
 * McpServer is per-request, and that is just tool registration.
 */
export function createServer(options: ServerOptions) {
  const store =
    options.store ??
    new SqliteEntitlementStore({
      path: options.databasePath ?? process.env['TOLLBOOTH_DB'] ?? './tollbooth.sqlite',
    });

  // Credits stop free use. They do not stop somebody who bought a pack from
  // spending it in seconds probing hosts, so the paid path has its own ceiling.
  const limiter = new PerSubjectRateLimiter({
    ratePerSecond: options.ratePerSecond ?? 2,
    burst: options.burst ?? 10,
  });

  const provider = new MooveProvider({
    client: new MooveClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    }),
    store,
    prices: PRICES,
  });

  function buildServer() {
  const mcp = new McpServer(
    { name: 'research-tools', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const server = withPaywall(mcp, {
    provider,
    store,
    onSettlement: (outcome) => {
      // Worth logging loudly: `underpaid` means somebody paid and got nothing,
      // and only a human can resolve it.
      if (outcome.status === 'underpaid' || outcome.status === 'partial') {
        console.error(`[tollbooth] ${outcome.status}`, {
          nonce: outcome.charge.nonce,
          expected: outcome.expected,
          received: outcome.received,
        });
      }
    },
  });

  server.paidTool(
    'fetch_readable',
    'Fetch a web page and return its readable text with navigation, scripts and ' +
      'markup stripped. Use this instead of guessing what a page says.',
    { sku: 'research', cost: 1 },
    { url: z.string().describe('Absolute http(s) URL of the page to read.') },
    { readOnlyHint: true, openWorldHint: true },
    async (args, extra) => run(extra, () => fetchReadable(String(args['url'])))
  );

  server.paidTool(
    'extract_tables',
    'Fetch a web page and return every HTML table on it as structured rows and ' +
      'headers. Use this when the facts you need are in a table.',
    { sku: 'research', cost: 2 },
    { url: z.string().describe('Absolute http(s) URL of the page containing tables.') },
    { readOnlyHint: true, openWorldHint: true },
    async (args, extra) => run(extra, () => extractTables(String(args['url'])))
  );

  server.paidTool(
    'inspect_domain',
    'Look up a domain: A, AAAA, MX, NS, TXT and CNAME records plus its live TLS ' +
      'certificate issuer and expiry. Use this for hosting, mail or certificate questions.',
    { sku: 'research', cost: 1 },
    { domain: z.string().describe('Domain name, e.g. example.org') },
    { readOnlyHint: true, openWorldHint: true },
    async (args, extra) => run(extra, () => inspectDomain(String(args['domain'])))
  );

  return server;
  }

  const server = buildServer();

  /**
   * Rate limit the caller, run the tool under a deadline, and turn a refusal
   * into a message the model can act on rather than an opaque failure.
   */
  async function run<T>(extra: unknown, fn: () => Promise<T>) {
    const subject = (extra as { tollbooth?: { subject?: string } })?.tollbooth?.subject;
    try {
      if (subject) limiter.check(subject);
      const result = await withDeadline(TOOL_DEADLINE_MS, fn);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      if (
        error instanceof ToolError ||
        error instanceof RateLimitedError ||
        error instanceof TimeoutError
      ) {
        return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
      }
      throw error;
    }
  }

  return { server, store, provider, limiter, buildServer };
}
