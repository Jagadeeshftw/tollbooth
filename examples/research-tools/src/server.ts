import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { definePrice } from '@tollbooth/core';
import { withPaywall } from '@tollbooth/mcp';
import { MooveClient, MooveProvider } from '@tollbooth/moove';
import { SqliteEntitlementStore } from '@tollbooth/store-sqlite';
import { z } from 'zod';

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

export interface ServerOptions {
  apiKey: string;
  baseUrl?: string;
  databasePath?: string;
}

export function createServer(options: ServerOptions) {
  const store = new SqliteEntitlementStore({
    path: options.databasePath ?? process.env['TOLLBOOTH_DB'] ?? './tollbooth.sqlite',
  });

  const provider = new MooveProvider({
    client: new MooveClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    }),
    store,
    prices: PRICES,
  });

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
    async (args) => run(() => fetchReadable(String(args['url'])))
  );

  server.paidTool(
    'extract_tables',
    'Fetch a web page and return every HTML table on it as structured rows and ' +
      'headers. Use this when the facts you need are in a table.',
    { sku: 'research', cost: 2 },
    { url: z.string().describe('Absolute http(s) URL of the page containing tables.') },
    { readOnlyHint: true, openWorldHint: true },
    async (args) => run(() => extractTables(String(args['url'])))
  );

  server.paidTool(
    'inspect_domain',
    'Look up a domain: A, AAAA, MX, NS, TXT and CNAME records plus its live TLS ' +
      'certificate issuer and expiry. Use this for hosting, mail or certificate questions.',
    { sku: 'research', cost: 1 },
    { domain: z.string().describe('Domain name, e.g. example.org') },
    { readOnlyHint: true, openWorldHint: true },
    async (args) => run(() => inspectDomain(String(args['domain'])))
  );

  return { server, store, provider };
}

/** Turn a tool result into MCP content, and a ToolError into a clean message. */
async function run<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof ToolError) {
      return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
    }
    throw error;
  }
}
