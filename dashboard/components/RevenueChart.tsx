'use client';

import { useRef, useState } from 'react';

export interface RevenueChartDay {
  day: string; // YYYY-MM-DD
  amount: number;
}

export function RevenueChart({ days }: { days: RevenueChartDay[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const W = 600;
  const H = 168;
  const padLeft = 34;
  const padBottom = 20;
  const padTop = 8;
  const padRight = 4;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const maxRev = Math.max(1, ...days.map((d) => d.amount));
  const niceMax = Math.ceil(maxRev / 10) * 10;
  const barGap = 2;
  const barW = days.length > 0 ? plotW / days.length - barGap : plotW;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Daily revenue">
        <line x1={padLeft} y1={padTop + plotH} x2={W - padRight} y2={padTop + plotH} className="chart-axis-line" />
        {[0, niceMax / 2, niceMax].map((v) => {
          const y = padTop + plotH - (v / niceMax) * plotH;
          return (
            <text key={v} x={padLeft - 6} y={y + 3} className="chart-tick" textAnchor="end">
              ${v}
            </text>
          );
        })}
        {days.map((d, idx) => {
          const x = padLeft + idx * (barW + barGap);
          const h = (d.amount / niceMax) * plotH;
          const y = padTop + plotH - h;
          return (
            <rect
              key={d.day}
              x={x}
              y={y}
              width={Math.max(1, barW)}
              height={Math.max(1, h)}
              rx={2}
              className="chart-bar"
              onMouseEnter={(e) => {
                const rect = (e.target as SVGRectElement).getBoundingClientRect();
                const wrap = wrapRef.current?.getBoundingClientRect();
                if (!wrap) return;
                setTooltip({ x: rect.left - wrap.left + rect.width / 2, y: rect.top - wrap.top, label: `${d.day.slice(5)} — $${d.amount.toFixed(2)}` });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
        {days.map((d, idx) =>
          idx % 6 === 0 ? (
            <text key={`lbl-${d.day}`} x={padLeft + idx * (barW + barGap) + barW / 2} y={H - 4} className="chart-tick" textAnchor="middle">
              {d.day.slice(5)}
            </text>
          ) : null
        )}
      </svg>
      {tooltip && (
        <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
