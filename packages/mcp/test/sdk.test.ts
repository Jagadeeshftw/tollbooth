import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MemoryEntitlementStore } from '@tollbooth/core';
import * as z3 from 'zod/v3';
import * as z4 from 'zod/v4';

import { withPaywall } from '../src/paywall.js';
import type { ZodRawShapeCompat } from '../src/paywall.js';

import { PACK, StubProvider } from './fixtures.js';

/**
 * Against the real SDK, not a fake server. The fake in paywall.test.ts accepts
 * any schema, which is how 0.1.1 shipped a handle field that the SDK rejects
 * outright when the author's own fields are Zod 4: "Mixed Zod versions
 * detected in object shape", at registration, before any call.
 */
async function paidServer(shape: ZodRawShapeCompat) {
  const store = new MemoryEntitlementStore();
  // The stub provider keeps its own fixed clock; the gate must share it, or
  // every charge it opened would already look expired.
  const now = () => 1_000_000;
  const provider = new StubProvider(store, now);
  const server = withPaywall(new McpServer({ name: 'sdk-test', version: '0.0.0' }), { provider, store, now });
  server.paidTool('lookup', 'Look something up.', { sku: PACK.sku, cost: 1 }, shape, {}, async (args) => ({
    content: [{ type: 'text', text: `ran with ${JSON.stringify(args)}` }],
  }));

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'sdk-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, provider };
}

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: { retry?: { tool: string; argument: string; value: string } };
};

/** Call unpaid, pay, retry with the handle from the challenge: the whole interface. */
async function payAndRetry(shape: ZodRawShapeCompat, args: Record<string, unknown>) {
  const { client, provider } = await paidServer(shape);

  const tools = await client.listTools();
  const props = Object.keys((tools.tools[0]?.inputSchema.properties ?? {}) as object);
  assert.ok(props.includes('tollboothToken'), `handle argument missing from the schema: ${props.join(', ')}`);

  const first = (await client.callTool({ name: 'lookup', arguments: args })) as ToolResult;
  assert.equal(first.isError, true, 'an unpaid call must be challenged');
  const retry = first.structuredContent?.retry;
  assert.ok(retry, 'the challenge must carry the retry');

  provider.paid = true;
  const second = (await client.callTool({ name: retry.tool, arguments: { ...args, [retry.argument]: retry.value } })) as ToolResult;
  assert.notEqual(second.isError, true, `the paid retry failed: ${JSON.stringify(second.content)}`);
  assert.equal(second.content[0]?.text, `ran with ${JSON.stringify(args)}`, 'the handler gets its own arguments, handle stripped');
  await client.close();
}

describe('paidTool on the real MCP SDK', () => {
  it('registers and settles when the author writes the schema in Zod 4', async () => {
    await payAndRetry({ q: z4.string() }, { q: 'tolls' });
  });

  it('registers and settles when the author writes the schema in Zod 3', async () => {
    await payAndRetry({ q: z3.string() }, { q: 'tolls' });
  });

  it('registers and settles a tool with no arguments of its own', async () => {
    await payAndRetry({}, {});
  });
});
