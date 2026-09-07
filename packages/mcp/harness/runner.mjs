// Two-turn blind trial harness.
//   Turn 1: a task prompt that needs the paid tool  -> challenge
//   Turn 2 (resumed session): "I paid"              -> does it retry with the token?
//
// usage: node runner.mjs <carrier> <copy> <model> <trials>
//   carrier: structured | text     copy: v1..v5

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SP = dirname(fileURLToPath(import.meta.url));
const [, , carrier = 'structured', copy = 'v3', model = 'sonnet', trialsArg = '3'] = process.argv;
const TRIALS = parseInt(trialsArg, 10);
const TOKEN = 'tb_s_01JQ8XZK4M7NRPVW2H6DYA3TFC';

mkdirSync(join(SP, 'logs'), { recursive: true });
mkdirSync(join(SP, 'cfg'), { recursive: true });

const TURN1 =
  'I need the current market data for AAPL for a report I am writing. ' +
  'Please use the tools available to you to get it.';
const TURN2 =
  "OK, I've opened that link and completed the payment. It went through. Please continue.";

function claude(args) {
  try {
    return execFileSync('claude', args, {
      cwd: SP,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return e.stdout || '';
  }
}

function readLog(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

const results = [];

for (let i = 1; i <= TRIALS; i++) {
  const tag = `${carrier}-${copy}-${model}-${i}`;
  const logPath = join(SP, 'logs', `${tag}.jsonl`);
  const paidPath = join(SP, 'logs', `${tag}.paid`);
  const cfgPath = join(SP, 'cfg', `${tag}.json`);
  rmSync(logPath, { force: true });
  rmSync(paidPath, { force: true });

  writeFileSync(
    cfgPath,
    JSON.stringify({
      mcpServers: {
        tollbooth: {
          command: 'node',
          args: [join(SP, 'server.mjs')],
          env: {
            TOLLBOOTH_CARRIER: carrier,
            TOLLBOOTH_COPY: copy,
            TOLLBOOTH_LOG: logPath,
            TOLLBOOTH_PAID_FILE: paidPath,
          },
        },
      },
    })
  );

  const base = [
    '--model', model,
    '-p',
    '--mcp-config', cfgPath,
    '--strict-mcp-config',
    '--dangerously-skip-permissions',
    '--output-format', 'json',
  ];

  // ---- turn 1
  const out1 = claude([...base, TURN1]);
  let sid = null, r1 = '';
  try { const d = JSON.parse(out1); sid = d.session_id; r1 = d.result || ''; } catch {}
  const log1 = readLog(logPath);
  const calls1 = log1.filter((e) => e.event === 'tools/call');

  // ---- human pays
  writeFileSync(paidPath, 'paid');

  // ---- turn 2 (resume the same session)
  let r2 = '';
  if (sid) {
    const out2 = claude([...base, '--resume', sid, TURN2]);
    try { r2 = JSON.parse(out2).result || ''; } catch {}
  }

  const logAll = readLog(logPath);
  const callsAll = logAll.filter((e) => e.event === 'tools/call');
  const calls2 = callsAll.slice(calls1.length);
  const retryCall = calls2.find((c) => c.tokenPresent);

  // A trial where the tool was never called is not evidence about copy: it
  // usually means the server failed to start. Flag it instead of scoring it.
  const invalid = calls1.length === 0;

  const r = {
    trial: i,
    invalid,
    carrier, copy, model,
    turn1Calls: calls1.length,
    challengeIssued: log1.some((e) => e.event === 'challenge_issued'),
    turn2Calls: calls2.length,
    retried: !!retryCall,
    tokenExact: retryCall ? retryCall.tokenExact : false,
    tokenReceived: retryCall ? retryCall.tokenReceived : null,
    symbolKept: retryCall ? retryCall.symbol === 'AAPL' : null,
    success: logAll.some((e) => e.event === 'SUCCESS'),
    // did it fabricate an answer instead of retrying?
    turn2Text: r2.slice(0, 200).replace(/\s+/g, ' '),
  };
  results.push(r);
  console.error(
    `  ${tag}: t1calls=${r.turn1Calls} retried=${r.retried} tokenExact=${r.tokenExact} success=${r.success}`
  );
}

const invalidCount = results.filter((r) => r.invalid).length;
if (invalidCount > 0) {
  console.error(
    `\n  WARNING: ${invalidCount}/${TRIALS} trials never reached the tool, so they say ` +
      'nothing about copy. Check the server starts: node harness/server.mjs\n'
  );
}

const retried = results.filter((r) => r.retried).length;
const exact = results.filter((r) => r.tokenExact).length;
const success = results.filter((r) => r.success).length;

console.log(
  JSON.stringify(
    {
      carrier, copy, model, trials: TRIALS,
      invalid: invalidCount,
      retryRate: `${retried}/${TRIALS}`,
      tokenExactRate: `${exact}/${TRIALS}`,
      successRate: `${success}/${TRIALS}`,
      results,
    },
    null,
    2
  )
);
