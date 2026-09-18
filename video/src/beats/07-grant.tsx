import React from 'react';

import { Header, Stage } from '../components';
import { font, palette, type } from '../design';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

const ITEMS = [
  {
    n: '01',
    heading: 'First users',
    body: 'Sitting with real MCP authors putting a real price on a real tool, and fixing what that breaks.',
  },
  {
    n: '02',
    heading: 'A pay button in Claude Desktop',
    body: 'The measured gap is the human step. A client-side affordance closes it without touching the protocol.',
  },
  {
    n: '03',
    heading: 'A second payment provider',
    body: 'The model already has no provider in it. A second binding proves that seam holds, and removes the single dependency.',
  },
] as const;

const Item: React.FC<{ n: string; heading: string; body: string; delay: number; duration: number }> = ({
  n,
  heading,
  body,
  delay,
  duration,
}) => {
  const style = useElement(delay, duration);
  return (
    <div style={{ ...style, flex: 1 }}>
      <div style={{ fontFamily: font.mono, fontSize: 40, color: palette.brand, lineHeight: 1 }}>{n}</div>
      <div style={{ height: 1, backgroundColor: palette.line, margin: '22px 0 22px' }} />
      <div style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.25 }}>{heading}</div>
      <div style={{ fontSize: type.label, color: palette.fgMuted, lineHeight: 1.5, marginTop: 14 }}>{body}</div>
    </div>
  );
};

export const Grant: React.FC<BeatProps> = ({ durationInFrames: d }) => (
  <Stage>
    <Header duration={d} eyebrow="What the grant funds" title="Three things, in the order they unblock each other." />

    <div style={{ display: 'flex', gap: 80, marginTop: 84 }}>
      {ITEMS.map((item, i) => (
        <Item key={item.n} {...item} delay={44 + i * 30} duration={d} />
      ))}
    </div>
  </Stage>
);
