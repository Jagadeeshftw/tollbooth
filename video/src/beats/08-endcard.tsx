import React from 'react';

import { Stage } from '../components';
import { font, palette, type } from '../design';
import { Mark } from '../mark.generated';
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
        {/* The mark lands first and the name follows it, so the last thing on
            screen is the same shape that sits in the browser tab. */}
        <div style={{ ...mark, marginBottom: 46, color: palette.fg, lineHeight: 0 }}>
          <Mark width={132} height={132} />
        </div>

        <div style={wordmark}>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>Tollbooth</div>
          <div
            style={{
              fontFamily: font.mono,
              fontSize: type.label,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: palette.brand,
              marginTop: 18,
            }}
          >
            A paywall for MCP servers
          </div>
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
