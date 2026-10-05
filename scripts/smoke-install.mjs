#!/usr/bin/env node
/**
 * Install Tollbooth the way a stranger would, and run a paid tool end to end.
 *
 *   node scripts/smoke-install.mjs                        # the line on the live site, packages from npm
 *   node --import tsx scripts/smoke-install.mjs --source repo --pack
 *                                                         # the line in snippets.ts, packages from this checkout
 *   ... --extra "@modelcontextprotocol/sdk@1.23.0 zod@3.25.0"
 *                                                         # then pin these, to test the floor of the peer ranges
 *
 * Why this exists: @tollbooth/mcp 0.1.1 passed every test in this repo and
 * failed for anyone who installed it. The repo's own example pins zod 3, so
 * nothing here ever resolved what npm resolves for a new project, which was
 * zod 4 for the SDK and a handle field the SDK refused at registration. The
 * site's install line, meanwhile, did not install the SDK at all. A test that
 * starts from the workspace cannot see either.
 *
 * So this starts from nothing: an empty directory outside the repo, the
 * install line copied verbatim (from the live page, by default), and the code
 * from the README that ships *inside the installed package*. Nothing from the
 * workspace is on the resolution path. The only stand-in is Moove itself,
 * whose HTTP API is answered in-process so no real link is created and no key
 * is needed; everything above the fetch call is the published code.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SITE = 'https://tollbooth.0xo.in/';
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const source = opt('source') ?? 'live';
const pack = args.includes('--pack');
const extra = opt('extra');
const keep = args.includes('--keep');

const step = (msg) => console.log(`\n== ${msg}`);
const fail = (msg) => {
  console.error(`\nSMOKE FAILED: ${msg}`);
  process.exit(1);
};

// 1. The install line, verbatim.
step(`install line from ${source === 'live' ? SITE : 'site/content/snippets.ts'}`);
let line;
if (source === 'live') {
  const html = await (await fetch(SITE, { headers: { 'cache-control': 'no-cache' } })).text();
  const m = html.match(/data-install-command="([^"]+)"/);
  if (!m) fail('no data-install-command attribute on the live page; the hero changed or the deploy is stale');
  line = m[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
} else {
  line = (await import(pathToFileURL(join(ROOT, 'site/content/snippets.ts')).href)).INSTALL;
}
console.log(line);
// It is about to be executed, so it must be exactly an npm install of package
// names and nothing else: no `;`, no `&&`, no `$(...)`.
if (!/^npm install( [@a-z0-9][a-z0-9._\-/@^~]*)+$/.test(line)) fail(`refusing to run an install line that is not plain package names: ${JSON.stringify(line)}`);

// 2. An empty project, nowhere near the repo.
const dir = mkdtempSync(join(tmpdir(), 'tollbooth-smoke-'));
step(`empty project at ${dir}`);
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: dir, stdio: 'inherit', ...opts });
run('npm', ['init', '-y'], { stdio: 'ignore' });
run('npm', ['pkg', 'set', 'type=module']);

let command = line;
if (pack) {
  // Same line, but each @tollbooth package comes from a tarball of this
  // checkout: what *would* be published, installed the way it will be.
  step('packing this checkout');
  const tarballs = {};
  for (const name of readdirSync(join(ROOT, 'packages'))) {
    const pj = JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'));
    if (pj.private || !pj.name?.startsWith('@tollbooth/')) continue;
    const out = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: join(ROOT, 'packages', name), encoding: 'utf8' }).trim().split('\n').at(-1);
    tarballs[pj.name] = join(dir, out);
  }
  command = line.split(' ').map((t) => tarballs[t.replace(/(.)@.*$/, '$1')] ?? t).join(' ');
  console.log(command);
}

step('npm install');
run('sh', ['-c', command]);
if (extra) {
  step(`npm install ${extra}`);
  run('sh', ['-c', `npm install ${extra}`]);
}

const version = (p) => {
  try { return JSON.parse(readFileSync(join(dir, 'node_modules', p, 'package.json'), 'utf8')).version; } catch { return 'not installed'; }
};
const resolved = Object.fromEntries(
  ['@tollbooth/mcp', '@tollbooth/core', '@tollbooth/moove', '@tollbooth/store-sqlite', '@modelcontextprotocol/sdk', 'zod'].map((p) => [p, version(p)])
);
console.log(resolved);

// 3. The README that ships in the installed package, run as written.
step('the "Use" example from node_modules/@tollbooth/mcp/README.md');
const readme = readFileSync(join(dir, 'node_modules/@tollbooth/mcp/README.md'), 'utf8');
const use = readme.match(/## Use\s+```js\n([\s\S]*?)```/);
if (!use) fail('the installed README has no "## Use" js block to run');
writeFileSync(join(dir, 'server.mjs'), `${use[1]}\nexport default server;\n`);

// 4. Drive it like an agent: list, call unpaid, pay, retry with the handle.
writeFileSync(
  join(dir, 'drive.mjs'),
  `
// Moove's API, answered in-process. Installed before the server module loads,
// because MooveClient captures fetch when it is constructed.
const links = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.moove.xyz') return realFetch(input, init);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (init.method === 'POST' && url.pathname === '/v1/payment-link') {
    const body = JSON.parse(String(init.body));
    const id = 'lnk_smoke_' + (links.size + 1);
    links.set(id, { toAmount: body.toAmount, paid: false });
    return json({ id, url: 'https://pay.moove.xyz/' + id });
  }
  const m = url.pathname.match(/^\\/v1\\/payment-link\\/([^/]+)$/);
  if (m && links.has(m[1])) {
    const l = links.get(m[1]);
    return json({
      id: m[1], userId: 'smoke', toAmount: l.toAmount, url: 'https://pay.moove.xyz/' + m[1],
      destinationAddress: '0x0000000000000000000000000000000000000000', dateCreated: new Date().toISOString(),
      token: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: null,
        isNative: false, isStablecoin: true, currencyCode: 'USD', commodityCode: null,
        chain: { id: '8453', name: 'Base', symbol: 'ETH', chainType: 'EVM', logo: '' } },
      status: l.paid ? 'completed' : 'active',
      ...(l.paid ? { receivedAmount: l.toAmount } : {}),
    });
  }
  return json({ error: { code: 'NOT_FOUND' } }, 404);
};

process.env.MOOVE_API_KEY ??= 'mk_smoke_not_a_real_key';
const { default: server } = await import('./server.mjs');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'tollbooth-smoke', version: '0.0.0' });
await Promise.all([server.connect(b), client.connect(a)]);

const { tools } = await client.listTools();
// The SDK drops non-standard annotation keys on the wire, so a paid tool is
// recognised the way an agent sees it: by the handle argument in its schema.
const tool = tools.find((t) => 'tollboothToken' in (t.inputSchema.properties ?? {}));
if (!tool) throw new Error('no tool carries a tollboothToken argument; tools: ' + tools.map((t) => t.name).join(', '));
const callArgs = Object.fromEntries((tool.inputSchema.required ?? []).map((k) => [k, 'smoke']));
console.log('paid tool:', tool.name, 'arguments:', JSON.stringify(callArgs));

const first = await client.callTool({ name: tool.name, arguments: callArgs });
const retry = first.structuredContent?.retry;
if (!first.isError || !retry) throw new Error('unpaid call was not challenged: ' + JSON.stringify(first).slice(0, 400));
console.log('challenged; checkout', first.structuredContent.checkoutUrl, 'amount', first.structuredContent.amount, first.structuredContent.currency);

for (const l of links.values()) l.paid = true;
console.log('link marked paid');

const second = await client.callTool({ name: retry.tool, arguments: { ...callArgs, [retry.argument]: retry.value } });
if (second.isError) throw new Error('paid retry failed: ' + JSON.stringify(second.content).slice(0, 400));
console.log('paid retry returned:', JSON.stringify(second.content));
await client.close();
console.log('END TO END OK');
`
);
step('end to end');
try {
  run('node', ['drive.mjs']);
} catch {
  fail(`the paid tool did not run end to end (project kept at ${dir})`);
}

console.log(`\nSMOKE PASSED: ${JSON.stringify(resolved)}`);
if (!keep) rmSync(dir, { recursive: true, force: true });
