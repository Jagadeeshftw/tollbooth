# The explainer video

~150s, 1080p, silent. Built with [Remotion](https://remotion.dev): the composition is React, so the film is source, not a binary someone has to re-cut by hand.

```bash
cd video
npm install
npm run studio        # scrub any beat, live
npm run storyboard    # one still per beat, into out/storyboard
npm run render        # out/explainer.mp4
```

## Re-timing to the voiceover

**`src/timeline.ts` is the only file that changes.** The `seconds` in it are estimates for the silent pass — something to record against, not a target to speak to. Once the real audio exists:

1. Read the length of each beat off the waveform.
2. Put those numbers in `TIMINGS`.
3. `npm run render`.

Nothing else moves. Every beat lays itself out from the duration it is handed: entrance cadence is fixed in frames (reading speed does not scale with beat length), the exit is anchored to the end, and everything in between is hold. A longer beat is a longer hold, not a broken scene.

Two constraints worth keeping:

- **No beat under ~8s.** The entrance cadence alone runs about 4s on the denser beats, and the content still has to be read after it lands.
- **The results and flow beats carry the most to read.** If the recording runs tight somewhere, take the time from elsewhere.

## Where the numbers come from

Every figure on screen is imported from `src/measurements.generated.ts`, which is a generated copy of `site/content/measurements.ts` — the same file the landing page reads. Nothing is typed into a beat by hand, so the video cannot drift from the site.

Same for the palette: `src/theme.generated.ts` is parsed from `packages/design/tokens.css`, the single source the site and dashboard already share. The video renders on the dark token set.

Both copies, and the Inter Display faces in `public/fonts`, are written by the repo root's `npm run sync` and checked by `npm run check:generated`. CI fails if any of them drift.

One consequence worth knowing: the "real settled payments" line in the *what is built* beat reads `live.*` from measurements. Those are `null` until the payment lands, so the beat currently renders **measured confirmation pending** — the same marked placeholder the site shows. Filling in `live` in `measurements.ts` and re-rendering is what changes it. Nothing in the video asserts a payment that the evidence file does not hold.

## Structure

```
src/
  timeline.ts        the re-timing surface: ids, what the VO says, seconds
  beats/index.ts     which component plays each beat
  beats/01-…08-…     one component per beat
  Explainer.tsx      the beats in order, each handed its duration
  Root.tsx           the film, plus one composition per beat for stills
  components.tsx     Stage, Header, Figure, Body, Rule
  motion.ts          the whole motion vocabulary: appear, hold, leave
  design.ts          type scale, layout, fonts, palette
```

Motion is deliberately thin: opacity and a 10px rise, nothing else. No spin, no parallax, no travelling type. Movement exists to say "this is new, read it".

## Audio

There is none, by design — the voiceover is recorded separately against this timing pass and mixed afterwards. `npm run render` produces a silent mp4 (h264).
