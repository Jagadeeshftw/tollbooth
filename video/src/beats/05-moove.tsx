import React from 'react';

import { Body, Figure, Header, Stage } from '../components';
import { palette, type } from '../design';
import { mooveDocumented } from '../measurements.generated';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

/** Reserved so the column without a figure still lines its heading up with the two that have one. */
const FIGURE_ROW_HEIGHT = 82;

const Point: React.FC<{ figure?: string; heading: string; body: string; delay: number; duration: number }> = ({
  figure,
  heading,
  body,
  delay,
  duration,
}) => {
  const style = useElement(delay, duration);
  return (
    <div style={{ ...style, flex: 1 }}>
      <div style={{ height: FIGURE_ROW_HEIGHT, display: 'flex', alignItems: 'flex-end' }}>
        {figure ? <Figure value={figure} size={64} tone="brand" /> : null}
      </div>
      <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.25, marginTop: 18 }}>{heading}</div>
      <div style={{ fontSize: type.label, color: palette.fgMuted, lineHeight: 1.5, marginTop: 14 }}>{body}</div>
    </div>
  );
};

/** The documented strings are authored for mid-sentence use on the site. */
const startSentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const Moove: React.FC<BeatProps> = ({ durationInFrames: d }) => (
  <Stage>
    <Header duration={d} eyebrow="Why Moove" title="The payer needs a wallet and nothing else." />

    <div style={{ display: 'flex', gap: 72, marginTop: 80 }}>
      <Point
        heading="No account, no signup, no KYC"
        body="The person paying opens a link and pays. They never register with Moove, and never with us."
        delay={44}
        duration={d}
      />
      <Point
        figure={String(mooveDocumented.chains)}
        heading="chains, any token"
        body="They pay from whatever they already hold, wherever they already hold it."
        delay={68}
        duration={d}
      />
      <Point
        figure={mooveDocumented.protocolFeeCrossChain}
        heading="fee, paid by the buyer"
        body={`Same chain and same token is ${mooveDocumented.sameChainSameToken}. ${startSentence(
          mooveDocumented.linkDeliversFullAmount
        )}.`}
        delay={92}
        duration={d}
      />
    </div>

    <div style={{ marginTop: 72, textAlign: 'center' }}>
      <Body duration={d} delay={116} maxWidth={1400} center>
        Documented by Moove, not measured by us — the distinction every figure in this project is labelled with.
      </Body>
    </div>
  </Stage>
);
