import { Easing, interpolate, useCurrentFrame } from 'remotion';

/**
 * The whole motion vocabulary: things appear, hold long enough to read, and
 * leave. No spin, no parallax, no travelling type — movement here exists to
 * say "this is new, read it", and nothing else.
 *
 * The contract that makes re-timing cheap: entrance cadence is *fixed* in
 * frames, because reading speed does not scale with how long a beat runs, and
 * the exit is anchored to the *end* of whatever duration the beat is given.
 * Everything between them is hold. So lengthening a beat to fit a slower
 * voiceover lengthens the hold and nothing else — no scene needs rebuilding.
 */
export const APPEAR_FRAMES = 14;
export const LEAVE_FRAMES = 12;

/** A small rise, not a slide: 10px is enough to read as "arriving". */
const RISE_PX = 10;

export type Revealed = {
  opacity: number;
  transform: string;
};

/** Reveal an element `delay` frames into the beat. */
export function useReveal(delay = 0): Revealed {
  const frame = useCurrentFrame();
  const t = interpolate(frame - delay, [0, APPEAR_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return { opacity: t, transform: `translateY(${(1 - t) * RISE_PX}px)` };
}

/**
 * The beat's own exit, anchored to its end. Multiply into a reveal's opacity
 * so a beat fades out as a whole rather than element by element.
 */
export function useLeave(durationInFrames: number): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [durationInFrames - LEAVE_FRAMES, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.in(Easing.cubic),
  });
}

/** Reveal plus the beat-level exit, which is what every element actually wants. */
export function useElement(delay: number, durationInFrames: number): Revealed {
  const reveal = useReveal(delay);
  const leaving = useLeave(durationInFrames);
  return { opacity: reveal.opacity * leaving, transform: reveal.transform };
}
