# @tollbooth/mcp

The MCP binding for Tollbooth: `withPaywall` and `paidTool`, for gating a tool behind payment.

## The model, in one pass

A paid tool call with no payment handle mints one, opens a checkout, and returns an MCP error result carrying the checkout URL and the handle — the tool's own logic never runs. The agent relays the URL to the human, who pays. The **same call, retried with that handle**, settles the charge and runs the tool. No handle ever means "not paid yet," never "denied" — the retry is the whole interface.

## Install

```bash
npm install @tollbooth/mcp @modelcontextprotocol/sdk
export MOOVE_API_KEY=mk_live_...   # from https://www.moove.xyz/dashboard/api-keys
```

## Use

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { definePrice } from '@tollbooth/core';
import { withPaywall } from '@tollbooth/mcp';
import { MooveClient, MooveProvider } from '@tollbooth/moove';
import { SqliteEntitlementStore } from '@tollbooth/store-sqlite';

const store = new SqliteEntitlementStore({ path: 'tollbooth.sqlite' });
const provider = new MooveProvider({
  client: new MooveClient({ apiKey: process.env.MOOVE_API_KEY }),
  store,
  prices: [definePrice({ sku: 'search', unit: 'credit_pack', amount: '5.00', credits: 10, label: 'Search — 10 credits' })],
});

const server = withPaywall(new McpServer({ name: 'demo', version: '1.0.0' }), { provider, store });

server.paidTool(
  'lookup_market_data',
  'Look up live market data.',
  { sku: 'search', cost: 1 },
  { query: z.string() },
  { readOnlyHint: true },
  async (args) => ({ content: [{ type: 'text', text: `results for "${args.query}"` }] })
);
```

Registers cleanly and is ready to connect a transport as soon as it runs. Wire the transport of your choice (stdio, HTTP) onto `server.server` — see the SDK's own docs for that part; this package only adds the payment gate.

## Docs

[tollbooth.0xo.in/docs/quickstart](https://tollbooth.0xo.in/docs/quickstart) — the full quickstart, with the hardening notes and a runnable reference server at [`examples/research-tools`](https://github.com/Jagadeeshftw/tollbooth/tree/main/examples/research-tools).
