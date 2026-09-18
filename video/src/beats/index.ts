import type React from 'react';

import type { BeatId, BeatProps, BeatTiming } from '../timeline';
import { TIMINGS } from '../timeline';
import { Question } from './01-question';
import { Results } from './02-results';
import { Problem } from './03-problem';
import { Flow } from './04-flow';
import { Moove } from './05-moove';
import { Built } from './06-built';
import { Grant } from './07-grant';
import { EndCard } from './08-endcard';

/** Which component plays each beat. Durations live in `timeline.ts`, not here. */
const COMPONENTS: Record<BeatId, React.FC<BeatProps>> = {
  question: Question,
  results: Results,
  problem: Problem,
  flow: Flow,
  moove: Moove,
  built: Built,
  grant: Grant,
  endcard: EndCard,
};

export type Beat = BeatTiming & { Component: React.FC<BeatProps> };

export const BEATS: Beat[] = TIMINGS.map((timing) => ({ ...timing, Component: COMPONENTS[timing.id] }));
