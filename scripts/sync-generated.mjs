#!/usr/bin/env node
/**
 * Keeps generated copies in step with their single source.
 *
 *   node scripts/sync-generated.mjs          # write copies
 *   node scripts/sync-generated.mjs --check  # exit 1 if any copy has drifted
 *
 * Sources and copies:
 *   packages/design/tokens.css     ->  site/styles/tokens.css
 *   packages/design/tokens.css     ->  video/src/theme.generated.ts
 *   site/content/measurements.ts   ->  video/src/measurements.generated.ts
 *   site/fonts/inter-display/*     ->  video/public/fonts/
 *   site/content/snippets.ts       ->  examples/research-tools/README.md (between markers)
 *
 * The site cannot import outside its own directory on Vercel, the example
 * README cannot import anything at all, and the video's composition is bundled
 * for a browser with no filesystem — so these are copies, but generated ones,
 * checked in CI, never edited by hand.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// 1b. tokens -> the video's theme module
//
// The video renders inside a browser bundle with no filesystem, so it cannot
// parse tokens.css at runtime. Parsed here instead, into a module it imports.
function parseTokenBlock(css, selector) {
  const block = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!block) throw new Error(`token block ${selector} not found`);
  /** @type {Record<string, string>} */
  const out = {};
  for (const [, name, value] of block[1].matchAll(/--tb-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())] = value.trim().replace(/\s+/g, ' ');
  }
  return out;
}
const asEntries = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');
/** `--tb-fg: var(--tb-charcoal-900)` is a reference in CSS and nothing at all in JS. Flatten it. */
function resolveVars(map) {
  const key = (name) => name.replace(/^--tb-/, '').replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const seen = new Set();
  const resolve = (value, from) => {
    const ref = value.match(/^var\((--tb-[a-z0-9-]+)\)$/);
    if (!ref) return value;
    const target = key(ref[1]);
    if (seen.has(from)) throw new Error(`token cycle at --tb-${from}`);
    seen.add(from);
    const next = map[target];
    if (next === undefined) throw new Error(`token --tb-${from} references missing ${ref[1]}`);
    const out = resolve(next, target);
    seen.delete(from);
    return out;
  };
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, resolve(v, k)]));
}
const lightRaw = parseTokenBlock(tokens, ':root');
const darkRaw = parseTokenBlock(tokens, '\\.dark');
const light = resolveVars(lightRaw);
// Resolved against the merged map so a dark token referencing another resolves
// to the dark value, then narrowed back to only the keys dark actually sets.
const darkResolved = resolveVars({ ...lightRaw, ...darkRaw });
const dark = Object.fromEntries(Object.keys(darkRaw).map((k) => [k, darkResolved[k]]));
sync(
  join(ROOT, 'video/src/theme.generated.ts'),
  '/* GENERATED from packages/design/tokens.css — do not edit. Run: npm run sync */\n\n' +
    `export const light = {\n${asEntries(light)}\n} as const;\n\n` +
    `/** The video renders on the dark palette: these override \`light\`. */\n` +
    `export const darkOverrides = {\n${asEntries(dark)}\n} as const;\n\n` +
    'export const theme = { ...light, ...darkOverrides } as const;\n',
  'video/src/theme.generated.ts'
);

// 1d. measurements -> the video's data module
//
// Same reason as the theme: the composition is bundled for a browser and
// cannot reach outside its own project. measurements.ts is self-contained
// data with no imports, so this is a straight copy — and the video importing
// only from here is what stops a figure on screen drifting from the site.
sync(
  join(ROOT, 'video/src/measurements.generated.ts'),
  '/* GENERATED from site/content/measurements.ts — do not edit. Run: npm run sync */\n' +
    readFileSync(join(ROOT, 'site/content/measurements.ts'), 'utf8'),
  'video/src/measurements.generated.ts'
);

// 1c. the real Inter Display faces -> the video's static folder
//
// Remotion serves fonts from public/ and renders in headless Chromium, which
// has neither the site's next/font pipeline nor these faces installed.
mkdirSync(join(ROOT, 'video/public/fonts'), { recursive: true });
for (const face of ['InterDisplay-Regular.ttf', 'InterDisplay-SemiBold.ttf', 'InterDisplay-Bold.ttf']) {
  const from = join(ROOT, 'site/fonts/inter-display', face);
  const to = join(ROOT, 'video/public/fonts', face);
  const expected = readFileSync(from);
  const current = (() => { try { return readFileSync(to); } catch { return Buffer.alloc(0); } })();
  if (expected.equals(current)) continue;
  if (check) { console.error(`DRIFT: video/public/fonts/${face}`); drift++; continue; }
  copyFileSync(from, to);
  console.log(`wrote video/public/fonts/${face}`);
}

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
