/**
 * THE RE-TIMING SURFACE. This is the only file that changes when the video is
 * cut to Jagadeesh's actual recording.
 *
 * Deliberately free of React: the beat components live in `beats/index.ts`,
 * keyed by the ids below, so tooling (the storyboard script, any future audio
 * alignment) can read the timings without pulling a composition into Node.
 *
 * `seconds` below are *estimates* for the silent timing pass — something to
 * record against, not a target to speak to. Once the real audio exists, read
 * the length of each beat off the waveform, put it here, and re-render.
 * Nothing else moves: every beat lays out from the duration it is handed, its
 * entrance cadence is fixed in frames, and its exit is anchored to its end, so
 * a longer beat is a longer hold rather than a broken scene.
 *
 * Two constraints worth keeping when re-timing:
 *   - No beat under ~8s. The entrance cadence alone runs about 4s on the
 *     denser beats, and the content still needs to be read after it lands.
 *   - The results and flow beats carry the most to read. If the recording is
 *     tight somewhere, take it from elsewhere.
 */

export const FPS = 30;

/** Frames a beat spends fading itself out, anchored to its end. Mirrors motion.ts. */
export const LEAVE_FRAMES = 12;

export type BeatId = 'question' | 'results' | 'problem' | 'flow' | 'moove' | 'built' | 'grant' | 'endcard';

export type BeatTiming = {
  id: BeatId;
  /** What the voiceover is saying here — the thing a duration is being fitted to. */
  says: string;
  seconds: number;
};

export const TIMINGS: BeatTiming[] = [
  { id: 'question', says: 'The opening question, and the number 71.', seconds: 16 },
  { id: 'results', says: '18/18, 41/43, 0/10 — and why elicitation cannot work.', seconds: 28 },
  { id: 'problem', says: 'MCP authors cannot charge; agent-held wallets are not real.', seconds: 18 },
  { id: 'flow', says: 'What Tollbooth does, as the four-step flow.', seconds: 26 },
  { id: 'moove', says: 'Why Moove: no account, any chain, tiny fee, full amount.', seconds: 20 },
  { id: 'built', says: 'What is built: packages, docs, dashboard, tests, stores.', seconds: 18 },
  { id: 'grant', says: 'What the grant funds: users, a pay button, a second provider.', seconds: 16 },
  { id: 'endcard', says: 'End card.', seconds: 8 },
];

export type BeatProps = {
  /** The beat's own length. Its exit is anchored to this, so the beat adapts to any duration. */
  durationInFrames: number;
};

export const framesFor = (beat: BeatTiming): number => Math.round(beat.seconds * FPS);

export const TOTAL_FRAMES = TIMINGS.reduce((sum, beat) => sum + framesFor(beat), 0);

/** The frame a beat is fully assembled at: everything arrived, nothing left yet. */
export const assembledFrame = (beat: BeatTiming): number =>
  Math.max(0, framesFor(beat) - LEAVE_FRAMES - 10);
