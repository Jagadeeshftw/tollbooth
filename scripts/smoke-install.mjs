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
 * workspace is on the resolution path. It settles twice: once by polling, on
 * the agent's retry, and once on a signed webhook, through the handler in the
 * README that ships inside the installed @tollbooth/moove. The only stand-in
 * is Moove itself,
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
writeFileSync(join(dir, 'server.mjs'), `${use[1]}\nexport default server;\nexport { provider };\n`);

step('the "Webhooks" example from node_modules/@tollbooth/moove/README.md');
const mooveReadme = readFileSync(join(dir, 'node_modules/@tollbooth/moove/README.md'), 'utf8');
const hook = mooveReadme.match(/## Webhooks[\s\S]*?```js\n([\s\S]*?)```/);
if (!hook) fail('the installed @tollbooth/moove README has no "## Webhooks" js block; the published package does not document webhooks');
writeFileSync(join(dir, 'webhook.mjs'), hook[1]);

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
    links.set(id, { toAmount: body.toAmount, description: body.description ?? null, paid: false });
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
      description: l.description,
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
console.log('POLLING PATH OK');

// The webhook path: a new unpaid call, settled by Moove's signed delivery
// before the agent retries. Signed here the way Moove documents it, HMAC-SHA256
// over "<timestamp>.<raw body>" keyed by the whole whsec_ secret, not by the
// package under test.
const { createHmac, randomBytes } = await import('node:crypto');
const { provider } = await import('./server.mjs');
const { handleMooveWebhook } = await import('./webhook.mjs');
process.env.MOOVE_WEBHOOK_SECRET = 'whsec_smoke_' + randomBytes(12).toString('hex');

const third = await client.callTool({ name: tool.name, arguments: callArgs });
const retry2 = third.structuredContent?.retry;
if (!third.isError || !retry2) throw new Error('second unpaid call was not challenged');
const linkId = [...links.keys()].at(-1);
const link = links.get(linkId);
if (!link.description) throw new Error('the link was created without the description the webhook settles by');
link.paid = true;
const event = {
  id: 'evt_smoke_' + randomBytes(6).toString('hex'),
  type: 'payment_link.completed',
  createdAt: new Date().toISOString(),
  data: { paymentLinkId: linkId, status: 'completed', amount: link.toAmount, receivedAmount: link.toAmount, currentUsage: 1, maxUsage: 1,
    chainId: '8453', tokenAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', description: link.description },
};
const raw = JSON.stringify(event);
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = 'v1=' + createHmac('sha256', process.env.MOOVE_WEBHOOK_SECRET).update(timestamp + '.' + raw).digest('hex');
const headers = { 'moove-signature': signature, 'moove-timestamp': timestamp, 'moove-event-id': event.id };

const tampered = handleMooveWebhook(provider, raw.replace('"completed"', '"completed" '), headers);
if (tampered.status !== 401) throw new Error('a tampered delivery was answered ' + tampered.status + ', not 401');
const unsigned = handleMooveWebhook(provider, raw, { 'moove-timestamp': timestamp });
if (unsigned.status !== 401) throw new Error('an unsigned delivery was answered ' + unsigned.status + ', not 401');
console.log('tampered and unsigned deliveries: 401');

const delivered = handleMooveWebhook(provider, Buffer.from(raw), headers);
if (delivered.status !== 200) throw new Error('the signed delivery was answered ' + delivered.status);
const settled = await delivered.settle();
if (!settled.handled || settled.outcome.status !== 'granted') throw new Error('the webhook did not grant: ' + JSON.stringify(settled).slice(0, 300));
console.log('webhook granted the charge before any retry');
const again = await handleMooveWebhook(provider, Buffer.from(raw), headers).settle();
if (!again.handled || again.outcome.status !== 'already_granted') throw new Error('a duplicate delivery was not idempotent: ' + JSON.stringify(again).slice(0, 300));
console.log('duplicate delivery: already_granted');

const fourth = await client.callTool({ name: retry2.tool, arguments: { ...callArgs, [retry2.argument]: retry2.value } });
if (fourth.isError) throw new Error('retry after the webhook failed: ' + JSON.stringify(fourth.content).slice(0, 400));
console.log('retry after webhook returned:', JSON.stringify(fourth.content));
console.log('WEBHOOK PATH OK');
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
