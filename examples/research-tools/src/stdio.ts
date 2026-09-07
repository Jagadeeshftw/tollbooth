#!/usr/bin/env node
/** Local entrypoint: run this server over stdio from an MCP client config. */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createServer } from './server.js';

const apiKey = process.env['MOOVE_API_KEY'];
if (!apiKey) {
  console.error(
    'MOOVE_API_KEY is not set. Create a key at https://www.moove.xyz/dashboard/api-keys\n' +
      'and export it, along with MOOVE_API_BASE_URL if your key names a different host.'
  );
  process.exit(1);
}

const { server } = createServer({
  apiKey,
  ...(process.env['MOOVE_API_BASE_URL'] ? { baseUrl: process.env['MOOVE_API_BASE_URL'] } : {}),
});

await server.connect(new StdioServerTransport());
console.error('[research-tools] ready on stdio');
