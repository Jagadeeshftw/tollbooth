#!/usr/bin/env node
/**
 * Build every raster the mark is needed as, from packages/design/logo/mark.svg.
 *
 *   node scripts/build-logo-assets.mjs
 *
 * Writes into site/public/: the favicons a browser asks for (.ico with 16/32/48
 * inside, plus the PNGs modern browsers prefer), the two phone icons, a
 * maskable icon for Android, and the og:image that renders when a link is
 * pasted into Discord, Telegram, Slack or X.
 *
 * Rasterising needs a browser, so unlike `npm run sync` this is NOT wired into
 * CI — Chrome is not there. The outputs are committed instead, and this script
 * exists so they can be rebuilt identically when the mark changes.
 *
 * Requires Google Chrome at the usual macOS path, or CHROME= pointing at any
 * Chromium binary.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const OUT = join(ROOT, 'site/public');
const CHROME = process.env['CHROME'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The mark's three shapes, lifted out of the source so they can be re-laid-out. */
const markSource = readFileSync(join(ROOT, 'packages/design/logo/mark.svg'), 'utf8');
const shapes = markSource
  .split('\n')
  .filter((l) => /^\s*<(rect|path|circle)/.test(l))
  .join('\n');
if (!shapes.trim()) throw new Error('no shapes found in mark.svg');

/**
 * Optical sizing for 48px and below.
 *
 * At 16px the road in the full mark lands on roughly one pixel and greys out to
 * nothing, which costs exactly the element that stops the shape reading as a
 * hook. This variant thickens the road, post and arm so all three survive the
 * downsample. Same three shapes, same 45 degrees — heavier, not different.
 */
const smallShapes = `  <rect x="2" y="51" width="60" height="11" rx="5.5"/>
  <rect x="8" y="28" width="14" height="23" rx="2"/>
  <rect x="15" y="26" width="45" height="11" rx="5.5" transform="rotate(-45 15 31.5)"/>`;

const work = mkdtempSync(join(tmpdir(), 'tollbooth-logo-'));
mkdirSync(OUT, { recursive: true });

/** Screenshot an SVG document at exactly width x height. Transparent unless `background`. */
function raster(name, svg, width, height, background) {
  const file = join(work, `${name}.svg`);
  writeFileSync(file, svg);
  const out = join(work, `${name}.png`);
  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--screenshot=${out}`,
      `--window-size=${width},${height}`,
      `--default-background-color=${background ?? '00000000'}`,
      `file://${file}`,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );
  return readFileSync(out);
}

/**
 * The mark on its own, padded so it is not flush to the edge.
 * `pad` is a fraction of the icon's size on each side.
 */
const icon = (size, { pad = 0.12, fg = '#111111', bg = null, radius = 0, weight } = {}) => {
  const inner = 64 / (1 - 2 * pad);
  const offset = inner * pad;
  const body = (weight ?? (size <= 48 ? 'small' : 'regular')) === 'small' ? smallShapes : shapes;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${inner} ${inner}">
  ${bg ? `<rect width="${inner}" height="${inner}" rx="${radius}" fill="${bg}"/>` : ''}
  <g transform="translate(${offset} ${offset})" fill="${fg}">
${body}
  </g>
</svg>`;
};

/** ICO container. Each entry is a PNG, which every browser since IE11 reads. */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const at = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 0);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
    dir.writeUInt8(0, at + 2); // palette
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

const write = (name, buf) => {
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote site/public/${name} (${buf.length.toLocaleString()} bytes)`);
};

// --- favicons -------------------------------------------------------------
// Dark ink on transparent: browsers composite onto their own tab background,
// which is light in light mode and dark in dark mode — so the light-mode case
// is the one that has to work, and a near-black mark works on both.
const favicons = [16, 32, 48].map((size) => ({ size, png: raster(`favicon-${size}`, icon(size, { pad: 0.05 }), size, size) }));
write('favicon.ico', ico(favicons));
for (const f of favicons) write(`favicon-${f.size}.png`, f.png);

// --- phones ---------------------------------------------------------------
// iOS composites onto white and applies its own rounding, so this one ships a
// background rather than transparency.
write('apple-touch-icon.png', raster('apple', icon(180, { pad: 0.16, bg: '#ffffff' }), 180, 180));
write('icon-192.png', raster('i192', icon(192, { pad: 0.1 }), 192, 192));
write('icon-512.png', raster('i512', icon(512, { pad: 0.1 }), 512, 512));
// Android maskable: everything outside the central 80% circle can be cropped.
write('icon-maskable-512.png', raster('mask', icon(512, { pad: 0.22, bg: '#111111', fg: '#ffffff' }), 512, 512));

// --- og:image -------------------------------------------------------------
// 1200x630 is what Discord, Telegram, Slack and X all crop from. They render it
// small, so this is deliberately four things and no more: the mark, the name,
// one line of what it is, and the measurement that makes it worth a click.
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"
     font-family="Inter Display, Inter, ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif">
  <rect width="1200" height="630" fill="#0a0a0a"/>
  <rect x="0" y="0" width="1200" height="6" fill="#14b8a6"/>
  <g transform="translate(96 96) scale(1.75)" fill="#ffffff">
${shapes}
  </g>
  <text x="96" y="330" font-size="76" font-weight="700" fill="#ffffff" letter-spacing="-1.5">Tollbooth</text>
  <text x="96" y="392" font-size="34" fill="#a3a3a3">A paywall layer for MCP servers.</text>
  <text x="96" y="470" font-size="30" fill="#e5e5e5" font-family="DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace">
    <tspan fill="#14b8a6">18/18</tspan><tspan fill="#737373"> · </tspan><tspan fill="#14b8a6">41/43</tspan><tspan fill="#737373"> · </tspan><tspan fill="#c2410c">0/10</tspan>
  </text>
  <text x="96" y="512" font-size="24" fill="#a3a3a3">Agents retry a payment challenge — 71 blind trials, measured before it was built.</text>
  <text x="96" y="574" font-size="22" fill="#737373" font-family="DM Mono, ui-monospace, SFMono-Regular, Menlo, monospace">tollbooth.0xo.in</text>
</svg>`;
write('og-image.png', raster('og', og, 1200, 630, 'FF0A0A0A'));

rmSync(work, { recursive: true, force: true });
console.log('\nRebuild any time with: node scripts/build-logo-assets.mjs');
