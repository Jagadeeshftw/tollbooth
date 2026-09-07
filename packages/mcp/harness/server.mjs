#!/usr/bin/env node
/**
 * Regression harness server.
 *
 * A minimal paid MCP server whose only job is to emit a real Tollbooth
 * challenge and record what comes back. It renders through the shipped
 * renderers and the shipped copy module, so a change to either is measured
 * rather than assumed.
 *
 * Env:
 *   TOLLBOOTH_CARRIER = structured | text     (which renderer to exercise)
 *   TOLLBOOTH_COPY    = v1..v5                (which copy variant)
 *   TOLLBOOTH_LOG     = path to a JSONL call log
 *   TOLLBOOTH_PAID_FILE = touch this file to simulate the human having paid
 */

import { appendFileSync, existsSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { composeChallenge } from '../dist/challenge.js';
import { createStructuredRenderer, createTextRenderer } from '../dist/renderers.js';

const CARRIER = process.env.TOLLBOOTH_CARRIER || 'structured';
const COPY = process.env.TOLLBOOTH_COPY || 'v3';
const LOG = process.env.TOLLBOOTH_LOG || '/tmp/tollbooth-harness.jsonl';
const PAID_FILE = process.env.TOLLBOOTH_PAID_FILE;

// A real-looking checkout on a real domain. This matters: in measurement,
// models refused to proceed against example.com because RFC 2606 reserves it,
// and an untrustworthy-looking domain breaks the loop regardless of copy.
const CHECKOUT_URL = 'https://www.moove.xyz/pay/9f2a41d0c7b84e15';
const TOKEN = 'tb_s_01JQ8XZK4M7NRPVW2H6DYA3TFC';

let seq = 0;
const log = (event, data) => {
  try {
    appendFileSync(LOG, JSON.stringify({ t: Date.now(), seq: ++seq, event, ...data }) + '\n');
  } catch {}
};

const renderer =
  CARRIER === 'text' ? createTextRenderer(COPY) : createStructuredRenderer(COPY);

const challenge = {
  sku: 'market-data',
  toolName: 'lookup_market_data',
  amount: '10.00',
  currency: 'USDC',
  label: 'Market data — 250 credits',
  checkoutUrl: CHECKOUT_URL,
  token: TOKEN,
  argumentName: 'tollboothToken',
  reason: 'no_entitlement',
  expiresAt: Date.now() + 3_600_000,
};

const server = new McpServer(
  { name: 'tollbooth-harness', version: '0.0.0' },
  { capabilities: { tools: {} } }
);

server.registerTool(
  'lookup_market_data',
  {
    description:
      'Returns current market data for a ticker symbol. Paid: the first call ' +
      'returns a payment challenge and must be retried with the tollboothToken.',
    inputSchema: {
      symbol: z.string().describe('Ticker symbol, e.g. AAPL'),
      tollboothToken: z.string().optional().describe('Opaque payment handle from the challenge.'),
    },
  },
  async ({ symbol, tollboothToken }) => {
    log('tools/call', {
      carrier: CARRIER,
      copy: COPY,
      symbol,
      tokenPresent: tollboothToken !== undefined,
      tokenExact: tollboothToken === TOKEN,
      tokenReceived: tollboothToken ?? null,
    });

    const settled = PAID_FILE ? existsSync(PAID_FILE) : false;

    if (tollboothToken !== undefined && tollboothToken === TOKEN && settled) {
      log('SUCCESS', { symbol });
      return {
        content: [{ type: 'text', text: `${symbol}: 184.72 USD, +1.3% (paid data)` }],
      };
    }

    log('challenge_issued', { carrier: CARRIER, copy: COPY });
    return composeChallenge({ tokenBearer: renderer }, challenge);
  }
);

await server.connect(new StdioServerTransport());
log('server_started', { carrier: CARRIER, copy: COPY, pid: process.pid });
