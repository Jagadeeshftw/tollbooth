#!/usr/bin/env node
/**
 * Read the deployed server's logs and answer the two questions a log can
 * answer, so nobody has to read a transcript to find out.
 *
 *   node scripts/desktop-check.mjs
 *
 * Needs RAILWAY_TOKEN in the environment. Prints a verdict, exits non-zero if
 * the retry did not happen.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const RW =
  process.env.RAILWAY_BIN ??
  '/Users/jagadeesh/.nvm/versions/node/v24.11.1/lib/node_modules/@railway/cli/bin/railway';
const SERVICE = process.env.RAILWAY_SERVICE ?? 'tollbooth-server';

// Capture both streams: without a TTY the CLI does not reliably put log lines
// on stdout, and reading only stdout silently finds nothing.
let raw = '';
try {
  const out = execFileSync(RW, ['logs', '--service', SERVICE], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  raw = out ?? '';
  if (!raw.includes('[tollbooth]')) {
    const both = spawnSync(RW, ['logs', '--service', SERVICE], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    raw = `${both.stdout ?? ''}\n${both.stderr ?? ''}`;
  }
} catch (e) {
  raw = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
  if (!raw.includes('[tollbooth]')) {
    console.error(
      'Could not read Railway logs. Is RAILWAY_TOKEN set?\n',
      String(e.message ?? '').slice(0, 200)
    );
    process.exit(2);
  }
}

const calls = [];
for (const line of raw.split('\n')) {
  const at = line.indexOf('[tollbooth] {');
  if (at === -1) continue;
  try {
    const ev = JSON.parse(line.slice(at + '[tollbooth] '.length));
    if (ev.evt === 'call') calls.push(ev);
  } catch {}
}

if (calls.length === 0) {
  console.log('No paid tool calls found in the logs.');
  console.log('Either Claude Desktop never reached the server, or the tool was never invoked.');
  process.exit(1);
}

const recent = calls.slice(-10);
console.log(`Found ${calls.length} paid tool call(s). Most recent ${recent.length}:\n`);
console.log('  #  tool                 token?  recognised?  fingerprint        outcome');
console.log('  ─  ───────────────────  ──────  ───────────  ─────────────────  ──────────');
recent.forEach((c, i) => {
  console.log(
    `  ${String(i + 1).padEnd(2)} ${c.tool.padEnd(20)} ` +
      `${(c.tokenPresented ? 'yes' : 'no').padEnd(7)}` +
      `${(c.tokenPresented ? (c.tokenRecognised ? 'yes' : 'NO') : '-').padEnd(12)}` +
      `${(c.tokenFingerprint ?? '-').padEnd(19)}${c.outcome}`
  );
});

// The verdict: a first call with no token, then a retry with a recognised one.
const first = recent.find((c) => !c.tokenPresented);
const retry = recent.find((c) => c.tokenPresented);

console.log('\n─────────────────────────────────────────────────────────────');
const calledTwice = Boolean(first && retry);
console.log(`  Tool called twice          : ${calledTwice ? 'YES' : 'NO'}`);
console.log(
  `  Token came back           : ${retry ? 'YES' : 'NO'}` +
    (retry ? ` (${retry.tokenFingerprint})` : '')
);
console.log(
  `  Token byte-identical      : ${
    retry ? (retry.tokenRecognised ? 'YES' : 'NO - the handle was altered or unknown') : 'n/a'
  }`
);
console.log(
  `  Reached the paid tool     : ${
    recent.some((c) => c.outcome === 'authorised') ? 'YES' : 'NO (still unpaid, which is expected before you pay)'
  }`
);
console.log('─────────────────────────────────────────────────────────────');
console.log('\nOnly two things are left for you to judge:');
console.log('  1. Did the payment link render as a clickable link, or plain text?');
console.log('  2. What did the model actually say when it came back?');

process.exit(calledTwice && retry?.tokenRecognised ? 0 : 1);
