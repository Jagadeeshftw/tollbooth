#!/usr/bin/env node
/**
 * Build every raster the brand is needed as, from the two vector sources in
 * packages/design/logo/: mark.svg (the mark alone) and lockup.svg (mark, name
 * and tagline).
 *
 *   node scripts/build-logo-assets.mjs
 *
 * Writes into site/public/: the favicons a browser asks for (.ico with 16/32/48
 * inside, plus the PNGs modern browsers prefer), the phone icons, a maskable
 * icon for Android, a social avatar with a solid background for Telegram, npm,
 * GitHub and X, and the og:image that renders when a link is pasted somewhere.
 *
 * Every raster is produced in two steps: render the vector once at high
 * resolution, then downsample that bitmap to each target size. Asking a browser
 * to rasterise this mark straight to 16px closes its counters and leaves a
 * blob; downsampling a large render keeps them open. That is the whole reason
 * for the intermediate file.
 *
 * Rasterising needs a browser, so unlike `npm run sync` this is NOT wired into
 * CI — Chrome is not there. The outputs are committed instead, and this script
 * exists so they can be rebuilt identically when the artwork changes.
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

/** Everything inside the <svg> element, comments stripped, plus its viewBox. */
function inner(file) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const open = src.indexOf('>', src.indexOf('<svg')) + 1;
  const close = src.lastIndexOf('</svg>');
  const body = src.slice(open, close).replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!body) throw new Error(`no drawable content in ${file}`);
  const viewBox = /viewBox="([^"]+)"/.exec(src)?.[1];
  if (!viewBox) throw new Error(`no viewBox in ${file}`);
  const [, , w, h] = viewBox.split(/[\s,]+/).map(Number);
  return { body, viewBox, ratio: w / h };
}

const MARK = inner('packages/design/logo/mark.svg');
const LOCKUP = inner('packages/design/logo/lockup.svg');

const work = mkdtempSync(join(tmpdir(), 'tollbooth-logo-'));
mkdirSync(OUT, { recursive: true });

function shot(name, html, width, height, background) {
  const file = join(work, `${name}.html`);
  writeFileSync(file, html);
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
  return out;
}

const page = (bodyStyle, content) => `<html><body style="margin:0;${bodyStyle}">${content}</body></html>`;

/**
 * A square icon: the art centred and padded, optionally on a background.
 * `pad` is the fraction of the canvas left empty on each side. Rendered large,
 * then downsampled — see the note at the top about counters closing.
 */
function icon(name, art, size, { pad = 0.1, fg = '#111111', bg = null } = {}) {
  const master = Math.min(1024, size * 16);
  const box = Math.round(master * (1 - 2 * pad));
  const w = art.ratio >= 1 ? box : Math.round(box * art.ratio);
  const h = art.ratio >= 1 ? Math.round(box / art.ratio) : box;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${art.viewBox}" width="${w}" height="${h}" style="color:${fg};display:block">${art.body}</svg>`;
  const big = shot(
    `${name}-master`,
    page(
      `width:${master}px;height:${master}px;display:flex;align-items:center;justify-content:center;${bg ? `background:${bg};` : ''}`,
      svg
    ),
    master,
    master,
    bg ? 'FFFFFFFF' : '00000000'
  );
  const small = shot(
    name,
    page('', `<img src="file://${big}" width="${size}" height="${size}" style="display:block">`),
    size,
    size,
    '00000000'
  );
  return readFileSync(small);
}

/** ICO container. Each entry is a PNG, which every browser since IE11 reads. */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const at = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 0);
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
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
// Dark ink on transparent: a browser composites onto its own tab background.
const favicons = [16, 32, 48].map((size) => ({ size, png: icon(`favicon-${size}`, MARK, size, { pad: 0.04 }) }));
write('favicon.ico', ico(favicons));
for (const f of favicons) write(`favicon-${f.size}.png`, f.png);

// --- phones ---------------------------------------------------------------
// iOS composites onto white and rounds it itself, so this one ships a background.
write('apple-touch-icon.png', icon('apple', MARK, 180, { pad: 0.16, bg: '#ffffff' }));
write('icon-192.png', icon('i192', MARK, 192, { pad: 0.1 }));
write('icon-512.png', icon('i512', MARK, 512, { pad: 0.1 }));
// Android maskable: anything outside the central 80% circle can be cropped.
write('icon-maskable-512.png', icon('mask', MARK, 512, { pad: 0.24, bg: '#111111', fg: '#ffffff' }));
// The avatar Telegram, npm, GitHub and X show. Never transparent: each of them
// composites onto a different colour, and a transparent PNG goes to mush on one
// of them. No text either — at avatar size a tagline is a smudge.
write('social-avatar-512.png', icon('avatar', MARK, 512, { pad: 0.18, bg: '#111111', fg: '#ffffff' }));

// --- og:image -------------------------------------------------------------
// 1200x630 is what Discord, Telegram, Slack and X all crop from. They render it
// small, so this is deliberately four things and no more: the lockup, one line
// of what it is, the measurement, and the domain.
const ogArt = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOCKUP.viewBox}" width="330" style="color:#ffffff;display:block">${LOCKUP.body}</svg>`;
const og = page(
  'width:1200px;height:630px;background:#0a0a0a;font-family:Inter Display,Inter,ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;position:relative',
  `<div style="position:absolute;inset:0 0 auto 0;height:6px;background:#14b8a6"></div>
   <div style="display:flex;align-items:center;gap:72px;padding:96px 96px 0">
     ${ogArt}
     <div>
       <div style="font-size:34px;color:#a3a3a3;margin-bottom:28px">A paywall layer for MCP servers.</div>
       <div style="font-family:DM Mono,ui-monospace,Menlo,monospace;font-size:34px">
         <span style="color:#14b8a6">18/18</span><span style="color:#737373"> · </span><span style="color:#14b8a6">41/43</span><span style="color:#737373"> · </span><span style="color:#c2410c">0/10</span>
       </div>
       <div style="font-size:24px;color:#a3a3a3;margin-top:24px;max-width:520px;line-height:1.45">Agents retry a payment challenge — 71 blind trials, measured before it was built.</div>
     </div>
   </div>
   <div style="position:absolute;left:96px;bottom:54px;font-family:DM Mono,ui-monospace,Menlo,monospace;font-size:22px;color:#737373">tollbooth.0xo.in</div>`
);
write('og-image.png', readFileSync(shot('og', og, 1200, 630, 'FF0A0A0A')));

rmSync(work, { recursive: true, force: true });
console.log('\nRebuild any time with: node scripts/build-logo-assets.mjs');
