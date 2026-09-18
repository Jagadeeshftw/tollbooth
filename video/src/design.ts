import { loadFont } from '@remotion/fonts';
import { loadFont as loadDmMono } from '@remotion/google-fonts/DMMono';
import { staticFile } from 'remotion';

import { theme } from './theme.generated';

/**
 * The palette is the site's own, parsed from `packages/design/tokens.css` into
 * `theme.generated.ts` by `npm run sync` at the repo root — nothing here
 * invents a colour, and CI's `check:generated` fails if this drifts.
 *
 * The video renders on the dark palette: `theme` is the light tokens with the
 * `.dark` block applied over them, which is what the site itself serves in
 * dark mode.
 */
export const palette = theme;

/** The same faces the site uses: Inter Display locally, DM Mono from Google. */
const interWeights = [
  { file: 'InterDisplay-Regular.ttf', weight: '400' },
  { file: 'InterDisplay-SemiBold.ttf', weight: '600' },
  { file: 'InterDisplay-Bold.ttf', weight: '700' },
] as const;

for (const { file, weight } of interWeights) {
  void loadFont({ family: 'Inter Display', url: staticFile(`fonts/${file}`), weight });
}
const { fontFamily: dmMonoFamily } = loadDmMono('normal', { weights: ['400', '500'], subsets: ['latin'] });

export const font = {
  /** Body, labels, sentences. */
  primary: `"Inter Display", ${palette.fontPrimary.split(',').slice(1).join(',').trim()}`,
  /** Every figure on screen. Numbers are the hero and they are monospaced. */
  mono: dmMonoFamily,
} as const;

/**
 * A type scale for 1920×1080. Deliberately few steps: this is a technical
 * audience and restraint reads as confidence, so there is no size here that
 * exists only for emphasis.
 */
export const type = {
  hero: 260,
  figure: 116,
  title: 64,
  body: 34,
  label: 24,
} as const;

export const layout = {
  width: 1920,
  height: 1080,
  margin: 130,
  /** The content column. Wide enough to carry a four-column flow, narrow enough to read. */
  column: 1660,
} as const;
