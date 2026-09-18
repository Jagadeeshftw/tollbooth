import React from 'react';

import { Figure, Header, Stage } from '../components';
import { palette, type } from '../design';
import { trials } from '../measurements.generated';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

export const Question: React.FC<BeatProps> = ({ durationInFrames: d }) => {
  const number = useElement(46, d);
  const caption = useElement(62, d);
  const footnote = useElement(78, d);

  return (
    <Stage>
      <Header
        duration={d}
        eyebrow="The question"
        title={
          <>
            If a paid tool asks an agent to pay,
            <br />
            does the agent come back?
          </>
        }
      />

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 44, marginTop: 84 }}>
        <div style={{ ...number, lineHeight: 0.85 }}>
          <Figure value={String(trials.scored)} size={type.hero} tone="brand" />
        </div>
        <div style={caption}>
          <div style={{ fontSize: 38, lineHeight: 1.3 }}>blind two-turn trials</div>
          <div style={{ fontSize: type.label, color: palette.fgMuted, marginTop: 12, whiteSpace: 'nowrap' }}>
            {trials.client}, {trials.models.join(' and ')} · {trials.measuredOn}
          </div>
        </div>
      </div>

      <div
        style={{
          ...footnote,
          marginTop: 72,
          textAlign: 'center',
          fontSize: type.body,
          color: palette.fgMuted,
        }}
      >
        The subject is blind: it sees a task, not an experiment.
      </div>
    </Stage>
  );
};
