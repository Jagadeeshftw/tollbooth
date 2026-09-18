import React from 'react';

import { Header, Stage } from '../components';
import { font, palette, type } from '../design';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

const STEPS = [
  { n: '01', heading: 'The agent calls a paid tool', body: 'No handle yet, so nothing runs. The tool never sees the call.' },
  { n: '02', heading: 'It gets a challenge back', body: 'A checkout link for the human, and an opaque handle for the agent to carry.' },
  { n: '03', heading: 'A person pays the link', body: 'Any wallet, any token, any chain. No account with us, and none with Moove.' },
  { n: '04', heading: 'The agent retries with the handle', body: 'The charge settles exactly once, credits are granted, and the tool runs.' },
] as const;

const Step: React.FC<{
  n: string;
  heading: string;
  body: string;
  delay: number;
  duration: number;
}> = ({ n, heading, body, delay, duration }) => {
  const style = useElement(delay, duration);
  return (
    <div style={{ ...style, flex: 1 }}>
      <div style={{ fontFamily: font.mono, fontSize: 56, fontWeight: 500, color: palette.brand, lineHeight: 1 }}>{n}</div>
      <div style={{ height: 1, backgroundColor: palette.line, margin: '26px 0 24px' }} />
      {/* Reserved height so a heading that wraps does not push its body out of
          line with the other three columns. */}
      <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.25, minHeight: 76 }}>{heading}</div>
      <div style={{ fontSize: type.label, color: palette.fgMuted, lineHeight: 1.5, marginTop: 10 }}>{body}</div>
    </div>
  );
};

export const Flow: React.FC<BeatProps> = ({ durationInFrames: d }) => (
  <Stage>
    <Header duration={d} eyebrow="What Tollbooth does" title="A paywall for MCP tools, in four steps." />

    <div style={{ display: 'flex', gap: 64, marginTop: 88 }}>
      {STEPS.map((step, i) => (
        <Step key={step.n} {...step} delay={44 + i * 34} duration={d} />
      ))}
    </div>
  </Stage>
);
