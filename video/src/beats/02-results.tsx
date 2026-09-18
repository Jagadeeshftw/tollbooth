import React from 'react';

import { Body, Figure, Header, Rule, Stage } from '../components';
import { font, palette, type } from '../design';
import { trials } from '../measurements.generated';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

/** Rows come straight from the measurement; nothing here is arranged by hand. */
const rows = trials.shapes;

const Row: React.FC<{ shape: string; retried: number; n: number; delay: number; duration: number }> = ({
  shape,
  retried,
  n,
  delay,
  duration,
}) => {
  const style = useElement(delay, duration);
  const worked = retried > 0;
  return (
    <div
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 60,
        padding: '26px 0',
        borderBottom: `1px solid ${palette.line}`,
      }}
    >
      <span style={{ fontFamily: font.mono, fontSize: type.body, color: palette.fg }}>{shape}</span>
      <Figure value={`${retried}/${n}`} size={72} tone={worked ? 'brand' : 'warn'} />
    </div>
  );
};

export const Results: React.FC<BeatProps> = ({ durationInFrames: d }) => {
  const quote = useElement(150, d);

  return (
    <Stage>
      <Header
        duration={d}
        eyebrow="The results"
        title="Agents retry — if the challenge carries the token where the model can read it."
      />

      <div style={{ marginTop: 58, maxWidth: 1320, marginLeft: 'auto', marginRight: 'auto' }}>
        <Rule duration={d} delay={40} />
        {rows.map((row, i) => (
          <Row key={row.shape} shape={row.shape} retried={row.retried} n={row.n} delay={52 + i * 22} duration={d} />
        ))}
      </div>

      <div style={{ ...quote, marginTop: 52, maxWidth: 1320, marginLeft: 'auto', marginRight: 'auto' }}>
        <div style={{ fontSize: type.label, color: palette.fgMuted, marginBottom: 14 }}>
          Elicitation cannot work, and this is why — the entire tool result the model received:
        </div>
        <div
          style={{
            fontFamily: font.mono,
            fontSize: 25,
            lineHeight: 1.5,
            // The rule carries the warning colour; the text itself stays at
            // reading contrast. Amber at this size on black is too dim to be
            // the thing the argument rests on.
            color: palette.fg,
            borderLeft: `3px solid ${palette.warn}`,
            paddingLeft: 26,
          }}
        >
          {trials.elicitationToolResult}
        </div>
      </div>

      <div style={{ marginTop: 40 }}>
        <Body duration={d} delay={168} maxWidth={1320}>
          The client runs its own consent flow and hands the model that, and nothing else. There is no token in it to
          retry with.
        </Body>
      </div>
    </Stage>
  );
};
