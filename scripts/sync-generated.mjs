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
 *   site/content/snippets.ts       ->  README.md, packages/mcp/README.md (between markers)
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

// 1e. the artwork -> React components for the site and the video
//
// Same reason as the theme: neither can read a file at runtime, and the mark
// has to be identical in a browser tab, a page header and the video's end
// card. The sources are packages/design/logo/{mark,lockup}.svg; the rasters
// (favicons, og:image, social avatar) come from the same files via
// scripts/build-logo-assets.mjs.
function svgSource(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const open = src.indexOf('>', src.indexOf('<svg')) + 1;
  const body = src
    .slice(open, src.lastIndexOf('</svg>'))
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .split('\n')
    .map((l) => '    ' + l.trim())
    .join('\n');
  const viewBox = /viewBox="([^"]+)"/.exec(src)?.[1];
  if (!body || !viewBox) throw new Error(`no drawable content or viewBox in ${file}`);
  return { body, viewBox };
}

// 1f. the horizontal lockups, rearranged from the supplied artwork
//
// The stacked lockup cannot go in a header: its name is 13% of its height. So
// headers and wide cards use a horizontal arrangement of the same traced
// paths — the mark, then TOLLBOOTH beside it, and METERED beneath the name in
// the full variant only (in a header it would be about 7px tall). Each path
// is sorted into mark, name or tagline by where it sits, and placed through a
// crop window; no glyph is redrawn, so re-tracing the artwork re-flows here.
/** The exact bounds of a potrace path: cubic extrema solved, not control points. */
function pathBBox(d) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '';
  const xs = [], ys = [];
  const num = () => Number(tok[i++]);
  const at = (nx, ny) => { xs.push(nx); ys.push(ny); };
  // Where a cubic's derivative is zero on one axis, inside (0, 1).
  const extrema = (a, b, c, e) => {
    const A = -a + 3 * b - 3 * c + e, B = 2 * (a - 2 * b + c), C0 = b - a;
    if (Math.abs(A) < 1e-12) return Math.abs(B) < 1e-12 ? [] : [-C0 / B];
    const disc = B * B - 4 * A * C0;
    if (disc < 0) return [];
    const r = Math.sqrt(disc);
    return [(-B + r) / (2 * A), (-B - r) / (2 * A)];
  };
  const cubicAt = (a, b, c, e, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * e;
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { x = sx; y = sy; continue; }
    if (C === 'M' || C === 'L') {
      x = ox + num(); y = oy + num(); at(x, y);
      if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
    } else if (C === 'H') { x = ox + num(); at(x, y); }
    else if (C === 'V') { y = oy + num(); at(x, y); }
    else if (C === 'C') {
      const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(), x3 = ox + num(), y3 = oy + num();
      at(x3, y3);
      for (const t of extrema(x, x1, x2, x3)) if (t > 0 && t < 1) xs.push(cubicAt(x, x1, x2, x3, t));
      for (const t of extrema(y, y1, y2, y3)) if (t > 0 && t < 1) ys.push(cubicAt(y, y1, y2, y3, t));
      x = x3; y = y3;
    } else throw new Error(`unsupported path command ${cmd} in lockup.svg; extend pathBBox`);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
{
  const src = readFileSync(join(ROOT, 'packages/design/logo/lockup.svg'), 'utf8');
  const group = /<g transform="translate\(0\.000000,1250\.000000\) scale\(0\.100000,-0\.100000\)"/.test(src);
  if (!group) throw new Error('lockup.svg no longer has the potrace group transform the horizontal lockups assume');
  // Path coordinates are potrace's: x/10, and y flipped about 1250 after /10.
  const paths = [...src.matchAll(/<path d="([^"]+)"\s*\/>/g)].map((m) => {
    const b = pathBBox(m[1].replace(/\s+/g, ' '));
    return { d: m[1], box: { x0: b.x0 / 10, x1: b.x1 / 10, y0: 1250 - b.y1 / 10, y1: 1250 - b.y0 / 10 } };
  });
  // Crop windows in the artwork's 1381x1250 viewBox, and where each lands.
  const PART = {
    mark: { crop: [324, 10, 742, 799], test: (cy) => cy < 880 },
    name: { crop: [10, 942, 1361, 169], test: (cy) => cy >= 880 && cy < 1140 },
    tagline: { crop: [364, 1173, 665, 67], test: (cy) => cy >= 1140 },
  };
  const parts = { mark: [], name: [], tagline: [] };
  for (const p of paths) {
    const cy = (p.box.y0 + p.box.y1) / 2;
    const key = Object.keys(PART).find((k) => PART[k].test(cy));
    const [cx, cyy, cw, ch] = PART[key].crop;
    // Exact outline bounds. Up to one unit of overhang (a twelfth of a pixel in
    // a header) is drawn anyway, because each window has visible overflow.
    if (p.box.x0 < cx - 1 || p.box.x1 > cx + cw + 1 || p.box.y0 < cyy - 1 || p.box.y1 > cyy + ch + 1) {
      throw new Error(`a ${key} path in lockup.svg falls outside its crop window; the horizontal lockups would clip it: ${JSON.stringify(p.box)} vs ${PART[key].crop}`);
    }
    parts[key].push(p.d);
  }
  if (!parts.mark.length || !parts.name.length || !parts.tagline.length) throw new Error('lockup.svg did not split into mark, name and tagline');
  const place = (key, x, y, w, h) =>
    `  <svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${PART[key].crop.join(' ')}" overflow="visible">\n` +
    `    <g transform="translate(0,1250) scale(0.1,-0.1)">\n` +
    parts[key].map((d) => `      <path d="${d.replace(/\s+/g, ' ')}"/>`).join('\n') +
    `\n    </g>\n  </svg>`;
  const lockupFile = (variant, body) =>
    `<!-- GENERATED from packages/design/logo/lockup.svg by scripts/sync-generated.mjs — do not edit. ${variant} -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 471.2 100" fill="currentColor" role="img" aria-label="Tollbooth">\n${body}\n</svg>\n`;
  sync(join(ROOT, 'packages/design/logo/lockup-horizontal.svg'),
    lockupFile('Horizontal, with METERED: for 64px tall and up.', [place('mark', 0, 0, 92.9, 100), place('name', 116.9, 10, 354.3, 44), place('tagline', 116.9, 70, 168.7, 17)].join('\n')),
    'packages/design/logo/lockup-horizontal.svg', 'source');
  sync(join(ROOT, 'packages/design/logo/lockup-horizontal-compact.svg'),
    lockupFile('Horizontal, compact: for headers.', [place('mark', 0, 0, 92.9, 100), place('name', 116.9, 28, 354.3, 44)].join('\n')),
    'packages/design/logo/lockup-horizontal-compact.svg', 'source');
}

const component = (name, file, extra) => {
  const { body, viewBox } = svgSource(file);
  return (
    `/* GENERATED from ${file} — do not edit. Run: npm run sync */\n` +
    extra +
    `export const ${name} = (props: React.SVGProps<SVGSVGElement>) => (\n` +
    `  <svg\n` +
    `    viewBox="${viewBox}"\n` +
    `    fill="currentColor"\n` +
    `    xmlns="http://www.w3.org/2000/svg"\n` +
    `    aria-hidden="true"\n` +
    `    {...props}\n` +
    `  >\n${body}\n  </svg>\n);\n`
  );
};

for (const [target, name, file, extra] of [
  ['site/components/mark.generated.tsx', 'Mark', 'packages/design/logo/mark.svg', ''],
  ['site/components/lockup.generated.tsx', 'Lockup', 'packages/design/logo/lockup.svg', ''],
  ['video/src/mark.generated.tsx', 'Mark', 'packages/design/logo/mark.svg', "import React from 'react';\n\n"],
  ['video/src/lockup.generated.tsx', 'Lockup', 'packages/design/logo/lockup.svg', "import React from 'react';\n\n"],
  ['site/components/lockup-horizontal-compact.generated.tsx', 'LockupHorizontalCompact', 'packages/design/logo/lockup-horizontal-compact.svg', ''],
  ['dashboard/components/lockup-horizontal-compact.generated.tsx', 'LockupHorizontalCompact', 'packages/design/logo/lockup-horizontal-compact.svg', ''],
  ['video/src/lockup-horizontal.generated.tsx', 'LockupHorizontal', 'packages/design/logo/lockup-horizontal.svg', "import React from 'react';\n\n"],
  ['video/src/lockup-horizontal-compact.generated.tsx', 'LockupHorizontalCompact', 'packages/design/logo/lockup-horizontal-compact.svg', "import React from 'react';\n\n"],
]) {
  sync(join(ROOT, target), component(name, file, extra), target, 'source');
}

// 1g. the favicon set -> the dashboard
//
// Built into site/public by scripts/build-logo-assets.mjs from mark.svg. The
// dashboard is a separate deployment with its own public/, and had no icon at
// all; copied rather than rebuilt so the two tabs can never show different marks.
mkdirSync(join(ROOT, 'dashboard/public'), { recursive: true });
for (const icon of ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'icon-192.png', 'apple-touch-icon.png']) {
  const from = join(ROOT, 'site/public', icon);
  const to = join(ROOT, 'dashboard/public', icon);
  const expected = readFileSync(from);
  const current = (() => { try { return readFileSync(to); } catch { return Buffer.alloc(0); } })();
  if (expected.equals(current)) continue;
  if (check) { console.error(`DRIFT: dashboard/public/${icon}`); drift++; continue; }
  copyFileSync(from, to);
  console.log(`wrote dashboard/public/${icon}`);
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
const block = (name, lang, body) =>
  `<!-- snippet:${name} (generated from site/content/snippets.ts) -->\n\`\`\`${lang}\n${body}\n\`\`\`\n<!-- /snippet:${name} -->`;

// The install line has to install everything the quickstart code imports.
// 0.1.1 shipped a hero line that left out the MCP SDK, and READMEs whose
// install lines left out the provider and the store: every one of them was
// "correct" on its own, and none of them could run the code beside it.
{
  const imported = new Set();
  for (const name of ['WITH_PAYWALL', 'TOOL']) {
    for (const [, spec] of grab(name).matchAll(/from '([^']+)'/g)) {
      if (spec.startsWith('.') || spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      imported.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  const installed = new Set(grab('INSTALL').replace(/^npm install\s+/, '').split(/\s+/).map((p) => p.replace(/(.)@.*$/, '$1')));
  const missing = [...imported].filter((p) => !installed.has(p));
  if (missing.length) {
    console.error(`INSTALL does not install ${missing.join(', ')}, which the quickstart snippets import. Fix site/content/snippets.ts.`);
    process.exit(1);
  }
}

// Any document carrying a snippet marker gets that snippet, so the READMEs
// cannot say different things about the same command.
const LANGS = { INSTALL: 'bash', RUN: 'bash', WITH_PAYWALL: 'ts', TOOL: 'ts', CLIENT: 'json' };
for (const doc of ['examples/research-tools/README.md', 'README.md', 'packages/mcp/README.md']) {
  const path = join(ROOT, doc);
  let next = readFileSync(path, 'utf8');
  for (const [name, lang] of Object.entries(LANGS)) {
    if (!next.includes(`<!-- snippet:${name} `)) continue;
    next = replaceBlock(next, 'snippet', name, block(name, lang, grab(name)), path);
  }
  sync(path, next, `${doc} snippets`);
}

// 3. the trial results -> the harness README
//
// The harness README is where someone reads the numbers next to the code that
// produced them, so it carried its own hand-typed copy of the same tables the
// site renders — the one copy of these figures that could drift silently.
const { trials, copyVariants, mooveDocumented, VIDEO_URL, VIDEO_RUNTIME } = await import(
  pathToFileURL(join(ROOT, 'site/content/measurements.ts')).href
);
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
// The same table the README leads with. One source, two documents.
const shapesBlock =
  `<!-- measured:SHAPES (generated from site/content/measurements.ts) -->\n` +
  `| Challenge shape | n | retried | token exact | delivered |\n| --- | ---: | ---: | ---: | ---: |\n${shapeRows}\n` +
  `<!-- /measured:SHAPES -->`;
const rootReadmePath = join(ROOT, 'README.md');
const rootReadme = readFileSync(rootReadmePath, 'utf8');
if (rootReadme.includes('<!-- measured:SHAPES ')) {
  sync(rootReadmePath, replaceBlock(rootReadme, 'measured', 'SHAPES', shapesBlock, rootReadmePath), 'README.md results table');
}

// The explainer link. GitHub cannot play a video inline, so the README gets a
// thumbnail that leaves for YouTube — pointed at the same URL the site uses.
const watchBlock =
  `<!-- measured:WATCH (generated from site/content/measurements.ts) -->\n` +
  `<p align="center">\n` +
  `  <a href="${VIDEO_URL}">\n` +
  `    <img src="site/public/explainer-thumb.jpg" alt="Play the Tollbooth explainer on YouTube" width="640">\n` +
  `  </a>\n` +
  `</p>\n\n` +
  `<p align="center"><sub>${VIDEO_RUNTIME} on YouTube. The results on screen come from the same file the site reads.</sub></p>\n` +
  `<!-- /measured:WATCH -->`;
if (rootReadme.includes('<!-- measured:WATCH ')) {
  sync(
    rootReadmePath,
    replaceBlock(readFileSync(rootReadmePath, 'utf8'), 'measured', 'WATCH', watchBlock, rootReadmePath),
    'README.md watch link'
  );
}

// What Moove documents, in the one paragraph that states it. These are
// Moove's numbers, not ours, and they were the last figures anywhere in the
// project still typed by hand.
const mooveBlock =
  `<!-- measured:MOOVE (generated from site/content/measurements.ts) -->\n` +
  `The payer needs a wallet and nothing else — no Moove account, no signup, no KYC — and can\n` +
  `pay from any of ${mooveDocumented.chains} chains in whatever token they already hold, which Moove routes to the\n` +
  `settlement token the tool author chose. For a payment link the author receives the full\n` +
  `amount: ${mooveDocumented.linkDeliversFullAmount}. The ${mooveDocumented.protocolFeeCrossChain} protocol fee is the payer's, and\n` +
  `same-chain, same-token is ${mooveDocumented.sameChainSameToken}.\n` +
  `<!-- /measured:MOOVE -->`;
if (rootReadme.includes('<!-- measured:MOOVE ')) {
  sync(
    rootReadmePath,
    replaceBlock(readFileSync(rootReadmePath, 'utf8'), 'measured', 'MOOVE', mooveBlock, rootReadmePath),
    'README.md Moove figures'
  );
}

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
