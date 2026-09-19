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
 *   site/content/measurements.ts   ->  packages/mcp/harness/README.md (between markers)
 *
 * The site cannot import outside its own directory on Vercel, the example
 * README cannot import anything at all, and the video's composition is bundled
 * for a browser with no filesystem — so these are copies, but generated ones,
 * checked in CI, never edited by hand.
 *
 * Runs under `tsx` (see the root package.json) because the sources are
 * TypeScript and are *imported and evaluated*, not scraped. A snippet like
 * `git clone ${REPO}` only becomes a working command once the module that
 * defines REPO has actually run; reading the source text would copy the
 * placeholder through verbatim, which is exactly the bug this once shipped.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const check = process.argv.includes('--check');
let drift = 0;

/** An unresolved `${...}` in prose or markdown means a template literal was copied, not evaluated. */
const PLACEHOLDER = /\$\{[^}\n]*\}/;

/**
 * @param target  file to write
 * @param expected  the content it should have
 * @param label  what to call it in output
 * @param kind  'text' for prose/markdown, which must contain no unresolved
 *   placeholders; 'source' for verbatim copies of TypeScript, where `${...}`
 *   is ordinary code the consuming bundler evaluates itself.
 */
function sync(target, expected, label, kind = 'text') {
  if (kind === 'text') {
    const found = expected.match(PLACEHOLDER);
    if (found) {
      console.error(
        `UNRESOLVED PLACEHOLDER: ${label} would contain ${found[0]} — a template literal was copied ` +
          'instead of evaluated. Fix the generator; do not hand-edit the copy.'
      );
      process.exit(1);
    }
  }
  const current = (() => { try { return readFileSync(target, 'utf8'); } catch { return ''; } })();
  if (current === expected) return;
  if (check) { console.error(`DRIFT: ${label} (${target})`); drift++; return; }
  writeFileSync(target, expected);
  console.log(`wrote ${label}`);
}

/** Replace the body between `<!-- marker:NAME ... -->` and `<!-- /marker:NAME -->`. */
function replaceBlock(doc, kindName, name, body, path) {
  const re = new RegExp(`<!-- ${kindName}:${name} [^>]*-->[\\s\\S]*?<!-- /${kindName}:${name} -->`);
  if (!re.test(doc)) throw new Error(`marker for ${name} missing in ${path}`);
  return doc.replace(re, body);
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
  'video/src/measurements.generated.ts',
  // Verbatim TypeScript: its own `${REPO}` templates are evaluated by the
  // video's bundler, so they are code here, not unsubstituted output.
  'source'
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
//
// Imported, not read: the snippets are template literals over REPO and SERVER
// from measurements.ts, and only evaluating the module turns them into the
// commands a reader can paste.
const snippets = await import(pathToFileURL(join(ROOT, 'site/content/snippets.ts')).href);
const grab = (name) => {
  const value = snippets[name];
  if (typeof value !== 'string') throw new Error(`snippet ${name} is not an exported string`);
  return value;
};
const readmePath = join(ROOT, 'examples/research-tools/README.md');
let next = readFileSync(readmePath, 'utf8');
const block = (name, lang, body) =>
  `<!-- snippet:${name} (generated from site/content/snippets.ts) -->\n\`\`\`${lang}\n${body}\n\`\`\`\n<!-- /snippet:${name} -->`;
for (const [name, lang] of [['RUN', 'bash'], ['TOOL', 'ts'], ['CLIENT', 'json']]) {
  next = replaceBlock(next, 'snippet', name, block(name, lang, grab(name)), readmePath);
}
sync(readmePath, next, 'examples/research-tools/README.md snippets');

// 3. the trial results -> the harness README
//
// The harness README is where someone reads the numbers next to the code that
// produced them, so it carried its own hand-typed copy of the same tables the
// site renders — the one copy of these figures that could drift silently.
const { trials, copyVariants } = await import(pathToFileURL(join(ROOT, 'site/content/measurements.ts')).href);
const pct = (part, whole) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`);
const shapeRows = trials.shapes
  .map((s) => `| \`${s.shape}\` | ${s.n} | ${s.retried} | ${s.tokenExact} | **${s.delivered} (${pct(s.delivered, s.n)})** |`)
  .join('\n');
const variantRows = copyVariants.rows
  .map((r) => {
    const intent = r.intent === 'shipped' ? '**shipped**' : r.intent;
    const confirmation = r.confirmation ? `, plus ${r.confirmation.retried}/${r.confirmation.n} on a confirmation run` : '';
    return `| ${r.id} (${intent}) | ${r.retried}/${r.n}${confirmation} |`;
  })
  .join('\n');
const harnessPath = join(ROOT, 'packages/mcp/harness/README.md');
const resultsBlock =
  `<!-- measured:RESULTS (generated from site/content/measurements.ts) -->\n` +
  `Blind two-turn trials, ${trials.measuredOn}, ${trials.client}, models ` +
  `${trials.models.map((m) => `\`${m}\``).join(' and ')}. ${trials.scored} scored trials.\n\n` +
  `| Carrier | n | retried | token exact | delivered |\n| --- | ---: | ---: | ---: | ---: |\n${shapeRows}\n\n` +
  `By copy variant, text carrier, ${copyVariants.perVariant} trials each:\n\n` +
  `| Variant | retried |\n| --- | --- |\n${variantRows}\n` +
  `<!-- /measured:RESULTS -->`;
const harnessNext = replaceBlock(readFileSync(harnessPath, 'utf8'), 'measured', 'RESULTS', resultsBlock, harnessPath);
sync(harnessPath, harnessNext, 'packages/mcp/harness/README.md measured results');

if (check && drift) { console.error(`${drift} generated file(s) out of date; run: node scripts/sync-generated.mjs`); process.exit(1); }
if (check) console.log('Generated copies in sync.');
