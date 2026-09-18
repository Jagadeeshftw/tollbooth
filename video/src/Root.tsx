import React from 'react';
import { Composition } from 'remotion';

import { Explainer } from './Explainer';
import { BEATS } from './beats';
import { layout } from './design';
import { FPS, TOTAL_FRAMES, framesFor } from './timeline';

/**
 * One composition for the film, plus one per beat.
 *
 * The per-beat compositions exist so the storyboard can be reviewed at the
 * frame level before anything is rendered at length, and so a single beat can
 * be scrubbed in the studio while its timing is being fitted to the recording.
 * Take a still from one with `npm run storyboard`, which picks the frame where
 * the beat is fully assembled — after its entrance, before its exit.
 */
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Explainer"
      component={Explainer}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={layout.width}
      height={layout.height}
    />
    {BEATS.map((beat) => {
      const durationInFrames = framesFor(beat);
      return (
        <Composition
          key={beat.id}
          id={`beat-${beat.id}`}
          component={beat.Component}
          durationInFrames={durationInFrames}
          fps={FPS}
          width={layout.width}
          height={layout.height}
          defaultProps={{ durationInFrames }}
        />
      );
    })}
  </>
);
