import React from 'react';

import { Header, Stage } from '../components';
import { palette, type } from '../design';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

const Claim: React.FC<{ heading: string; body: string; delay: number; duration: number }> = ({
  heading,
  body,
  delay,
  duration,
}) => {
  const style = useElement(delay, duration);
  return (
    <div style={{ ...style, maxWidth: 720 }}>
      <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em' }}>{heading}</div>
      <div style={{ fontSize: type.body, color: palette.fgMuted, lineHeight: 1.45, marginTop: 18 }}>{body}</div>
    </div>
  );
};

export const Problem: React.FC<BeatProps> = ({ durationInFrames: d }) => (
  <Stage>
    <Header duration={d} eyebrow="The problem" title="Nobody building an MCP server today can charge for it." />

    <div style={{ display: 'flex', gap: 96, marginTop: 76 }}>
      <Claim
        heading="The protocol has no payment step"
        body="MCP has no billing, no identity, and since revision 2026-07-28 no sessions either. A tool author who wants to charge has to invent the whole path themselves."
        delay={44}
        duration={d}
      />
      <Claim
        heading="Agent-held wallets are not real"
        body="Most paid-MCP work assumes the agent holds funds and can spend them unattended. Almost nobody will fund that, and the ones who would still have to bridge, sign and approve."
        delay={70}
        duration={d}
      />
    </div>
  </Stage>
);
