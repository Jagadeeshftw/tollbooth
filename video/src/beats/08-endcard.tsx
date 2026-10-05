import React from 'react';

import { Stage } from '../components';
import { palette, type } from '../design';
import { LockupHorizontal } from '../lockup-horizontal.generated';
import { REPO, SITE } from '../measurements.generated';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

/**
 * The full horizontal lockup carries the name and the one tagline (METERED) as
 * artwork. What it is follows as a plain sentence in body type — a
 * description, not a second tagline competing with the artwork's.
 */
export const EndCard: React.FC<BeatProps> = ({ durationInFrames: d }) => {
  const lockup = useElement(0, d);
  const line = useElement(10, d);
  const site = useElement(22, d);
  const links = useElement(30, d);

  return (
    <Stage>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ ...lockup, color: palette.fg, lineHeight: 0 }}>
          <LockupHorizontal height={190} />
        </div>

        <div style={{ ...line, fontSize: type.body, color: palette.fgMuted, marginTop: 44 }}>
          A paywall for MCP servers.
        </div>

        {/*
          Deliberately not the mono face: DM Mono slashes its zero, and these
          are addresses someone has to read off a screen and type. Legibility
          wins over the house monospace here.
        */}
        <div style={{ ...site, fontSize: 58, fontWeight: 600, letterSpacing: '-0.01em', color: palette.brand, marginTop: 64 }}>
          {SITE}
        </div>
        <div style={{ ...links, fontSize: type.body, color: palette.fg, marginTop: 18 }}>
          {SITE}/docs
          <span style={{ color: palette.fgMuted, margin: '0 22px' }}>·</span>
          {REPO.replace(/^https:\/\//, '')}
        </div>
      </div>
    </Stage>
  );
};
