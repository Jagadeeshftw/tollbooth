import React from 'react';

import { Figure, Header, Stage } from '../components';
import { font, palette, type } from '../design';
import { built, live } from '../measurements.generated';
import { useElement } from '../motion';
import type { BeatProps } from '../timeline';

const Stat: React.FC<{ value: string; label: string; delay: number; duration: number }> = ({
  value,
  label,
  delay,
  duration,
}) => {
  const style = useElement(delay, duration);
  return (
    <div style={{ ...style, flex: 1 }}>
      <Figure value={value} size={92} />
      <div style={{ fontSize: type.label, color: palette.fgMuted, marginTop: 16, lineHeight: 1.45 }}>{label}</div>
    </div>
  );
};

/**
 * The live payment is the one claim here that is not yet measured. The site
 * renders `live.*` as a marked pending state until the payment lands, and so
 * does this — filling the fields in `measurements.ts` is what changes it, in
 * the video exactly as on the page. Nothing is asserted here that the evidence
 * file does not already hold.
 */
const SettledPayment: React.FC<{ delay: number; duration: number }> = ({ delay, duration }) => {
  const style = useElement(delay, duration);
  const settled = live.toAmount !== null && live.receivedAmount !== null;
  return (
    <div style={{ ...style, display: 'flex', alignItems: 'baseline', gap: 20, justifyContent: 'center' }}>
      <span style={{ fontSize: type.body }}>Real settled payments</span>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: type.label,
          color: settled ? palette.brand : palette.warn,
        }}
      >
        {settled
          ? `measured: asked ${live.toAmount}, received ${live.receivedAmount}`
          : 'measured confirmation pending'}
      </span>
    </div>
  );
};

export const Built: React.FC<BeatProps> = ({ durationInFrames: d }) => {
  const line = useElement(108, d);

  return (
    <Stage>
      <Header duration={d} eyebrow="What is built" title="Shipped, published, and tested — not a prototype." />

      <div style={{ display: 'flex', gap: 72, marginTop: 84 }}>
        <Stat value={String(built.packagesPublished)} label="packages published on npm" delay={44} duration={d} />
        <Stat
          value={String(built.testsPassing)}
          label={`tests passing, ${built.testFailures} failing`}
          delay={64}
          duration={d}
        />
        <Stat
          value={String(built.entitlementStoreBackends.length)}
          label={`store backends: ${built.entitlementStoreBackends.join(', ')}`}
          delay={84}
          duration={d}
        />
      </div>

      <div style={{ ...line, marginTop: 76, fontSize: type.body, color: palette.fgMuted, lineHeight: 1.5, textAlign: 'center' }}>
        A documentation site, an operator dashboard, and a reference server anyone can run.
      </div>

      <div style={{ marginTop: 26 }}>
        <SettledPayment delay={126} duration={d} />
      </div>
    </Stage>
  );
};
