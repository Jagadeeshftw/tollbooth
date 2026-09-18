import React from 'react';
import { AbsoluteFill } from 'remotion';

import { font, layout, palette, type } from './design';
import { useElement } from './motion';

/**
 * Every beat sits on the same ground: one background, one content column,
 * left-aligned inside it. The column is centred so the frame's empty space
 * falls on both sides rather than piling up on the right.
 */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      backgroundColor: palette.bg,
      color: palette.fg,
      fontFamily: font.primary,
      padding: layout.margin,
      justifyContent: 'center',
      alignItems: 'center',
    }}
  >
    <div style={{ width: '100%', maxWidth: layout.column }}>{children}</div>
  </AbsoluteFill>
);

/**
 * The small caption above a beat's content. Present on every beat so the
 * viewer always knows which part of the argument they are in.
 */
/**
 * The heading block: eyebrow over title, centred. This is the site's own
 * section rhythm — a centred badge and heading, with left-aligned content
 * beneath it — rather than a second layout invented for the video.
 */
export const Header: React.FC<{
  eyebrow: string;
  title: React.ReactNode;
  duration: number;
  maxWidth?: number;
}> = ({ eyebrow, title, duration, maxWidth = 1500 }) => {
  const eyebrowStyle = useElement(0, duration);
  const titleStyle = useElement(8, duration);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div
        style={{
          ...eyebrowStyle,
          fontFamily: font.mono,
          fontSize: type.label,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: palette.brand,
          marginBottom: 30,
        }}
      >
        {eyebrow}
      </div>
      <h1
        style={{
          ...titleStyle,
          fontSize: type.title,
          fontWeight: 600,
          lineHeight: 1.14,
          letterSpacing: '-0.02em',
          margin: 0,
          maxWidth,
        }}
      >
        {title}
      </h1>
    </div>
  );
};

export const Body: React.FC<{
  children: React.ReactNode;
  delay?: number;
  duration: number;
  maxWidth?: number;
  muted?: boolean;
  center?: boolean;
}> = ({ children, delay = 0, duration, maxWidth = 1180, muted = true, center = false }) => {
  const style = useElement(delay, duration);
  return (
    <p
      style={{
        ...style,
        fontSize: type.body,
        lineHeight: 1.45,
        margin: center ? '0 auto' : 0,
        maxWidth,
        color: muted ? palette.fgMuted : palette.fg,
      }}
    >
      {children}
    </p>
  );
};

/** A figure. Monospaced, large, and never decorated — the number is the point. */
export const Figure: React.FC<{
  value: string;
  size?: number;
  tone?: 'fg' | 'brand' | 'muted' | 'warn';
}> = ({ value, size = type.figure, tone = 'fg' }) => (
  <span
    style={{
      fontFamily: font.mono,
      fontSize: size,
      fontWeight: 500,
      letterSpacing: '-0.02em',
      lineHeight: 1,
      fontVariantNumeric: 'tabular-nums',
      color:
        tone === 'brand' ? palette.brand : tone === 'muted' ? palette.fgMuted : tone === 'warn' ? palette.warn : palette.fg,
    }}
  >
    {value}
  </span>
);

/** A hairline, the same one the site draws between sections. */
export const Rule: React.FC<{ delay?: number; duration: number; width?: number | string }> = ({
  delay = 0,
  duration,
  width = '100%',
}) => {
  const style = useElement(delay, duration);
  return <div style={{ ...style, width, height: 1, backgroundColor: palette.line }} />;
};
