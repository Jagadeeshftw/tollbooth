#!/usr/bin/env node
/**
 * One still per beat, at the frame where the beat is fully assembled — after
 * its entrance cadence has landed, before its exit begins. That is the frame
 * worth arguing about, and the point of reviewing a storyboard before
 * committing to a full render.
 *
 *   npm run storyboard
 *
 * Reads the real timings from `src/timeline.ts`, so a re-time changes these
 * stills too without anything here being touched.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIMINGS, assembledFrame, framesFor } from '../src/timeline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out', 'storyboard');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

TIMINGS.forEach((beat, i) => {
  const frame = assembledFrame(beat);
  const file = join(OUT, `${String(i + 1).padStart(2, '0')}-${beat.id}.png`);
  console.log(`${beat.id}: frame ${frame} of ${framesFor(beat)} (${beat.seconds}s)`);
  execFileSync('npx', ['remotion', 'still', 'src/index.ts', `beat-${beat.id}`, file, `--frame=${frame}`], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
});

console.log(`\n${TIMINGS.length} stills in ${OUT}`);
