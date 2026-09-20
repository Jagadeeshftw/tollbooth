import React from 'react';

import { Stage } from '../components';
import { font, palette, type } from '../design';
import { Lockup } from '../lockup.generated';
import { SITE } from '../measurements.generated';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

export const EndCard: React.FC<BeatProps> = ({ durationInFrames: d }) => {
  const mark = useElement(0, d);
  const wordmark = useElement(8, d);
  const url = useElement(24, d);

  return (
    <Stage>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        {/* The supplied lockup carries the name and the tagline as artwork, so
            the end card does not set them as type a second time. */}
        <div style={{ ...mark, color: palette.fg, lineHeight: 0 }}>
          <Lockup height={330} />
        </div>

        <div
          style={{
            ...wordmark,
            fontFamily: font.mono,
            fontSize: type.label,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: palette.brand,
            marginTop: 26,
          }}
        >
          A paywall for MCP servers
        </div>

        {/*
          Deliberately not the mono face: DM Mono slashes its zero, and this is
          a URL someone has to read off a screen and type. Legibility wins over
          the house monospace here.
        */}
        <div
          style={{
            ...url,
            fontSize: 58,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: palette.brand,
            marginTop: 56,
          }}
        >
          {SITE}
        </div>
      </div>
    </Stage>
  );
};
