#!/usr/bin/env node
/**
 * Keeps generated copies in step with their single source.
 *
 *   node scripts/sync-generated.mjs          # write copies
 *   node scripts/sync-generated.mjs --check  # exit 1 if any copy has drifted
 *
 * Sources and copies:
 *   packages/design/tokens.css   ->  site/styles/tokens.css
 *   site/content/snippets.ts     ->  examples/research-tools/README.md (between markers)
 *
 * The site cannot import outside its own directory on Vercel, and the example
 * README cannot import anything at all, so these are copies — but generated
 * ones, checked in CI, never edited by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const check = process.argv.includes('--check');
let drift = 0;

function sync(target, expected, label) {
  const current = (() => { try { return readFileSync(target, 'utf8'); } catch { return ''; } })();
  if (current === expected) return;
  if (check) { console.error(`DRIFT: ${label} (${target})`); drift++; return; }
  writeFileSync(target, expected);
  console.log(`wrote ${label}`);
}

// 1. tokens
const tokens = readFileSync(join(ROOT, 'packages/design/tokens.css'), 'utf8');
sync(join(ROOT, 'site/styles/tokens.css'),
  '/* GENERATED from packages/design/tokens.css — do not edit. */\n' + tokens,
  'site/styles/tokens.css');

// 2. snippets -> example README
const snippetsSrc = readFileSync(join(ROOT, 'site/content/snippets.ts'), 'utf8');
const grab = (name) => {
  const m = snippetsSrc.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`snippet ${name} not found`);
  return m[1];
};
const readmePath = join(ROOT, 'examples/research-tools/README.md');
const readme = readFileSync(readmePath, 'utf8');
const block = (name, lang, body) =>
  `<!-- snippet:${name} (generated from site/content/snippets.ts) -->\n\`\`\`${lang}\n${body}\n\`\`\`\n<!-- /snippet:${name} -->`;
let next = readme;
for (const [name, lang] of [['RUN', 'bash'], ['TOOL', 'ts'], ['CLIENT', 'json']]) {
  const re = new RegExp(`<!-- snippet:${name} [^>]*-->[\\s\\S]*?<!-- /snippet:${name} -->`);
  if (!re.test(next)) throw new Error(`marker for ${name} missing in ${readmePath}`);
  next = next.replace(re, block(name, lang, grab(name)));
}
sync(readmePath, next, 'examples/research-tools/README.md snippets');

if (check && drift) { console.error(`${drift} generated file(s) out of date; run: node scripts/sync-generated.mjs`); process.exit(1); }
if (check) console.log('Generated copies in sync.');
