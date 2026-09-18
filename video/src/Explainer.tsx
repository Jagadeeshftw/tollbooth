import React from 'react';
import { AbsoluteFill, Series } from 'remotion';

import { BEATS } from './beats';
import { palette } from './design';
import { framesFor } from './timeline';

/**
 * The whole film is this: the beats in order, each given its duration from
 * `timeline.ts`. There is no cross-fade and no transition component — beats
 * fade themselves out at their own end, so a cut is just the next beat
 * starting. That is what keeps re-timing to a number change.
 */
export const Explainer: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: palette.bg }}>
    <Series>
      {BEATS.map((beat) => {
        const durationInFrames = framesFor(beat);
        return (
          <Series.Sequence key={beat.id} durationInFrames={durationInFrames}>
            <beat.Component durationInFrames={durationInFrames} />
          </Series.Sequence>
        );
      })}
    </Series>
  </AbsoluteFill>
);
