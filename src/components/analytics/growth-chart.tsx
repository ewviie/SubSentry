"use client";

import { useState } from "react";
import { formatCents } from "@/lib/subscriptions/money";
import { cn } from "@/lib/utils";
import type { GrowthPoint } from "@/lib/subscriptions/analytics";

const CHART_HEIGHT = 40; // viewBox units
const TOP_PADDING = 4;
const BOTTOM_PADDING = 2;

// A single-series line/area chart — one hue (gold, this app's established
// "spend" accent, see the dashboard's Monthly spend stat card and
// SavingsCard), no legend needed per the dataviz single-series rule. Percent
// coordinate space (viewBox="0 0 100 40") lets hover hit-targets be plain
// absolutely-positioned buttons instead of SVG-space pointer math.
export function GrowthChart({ points }: { points: GrowthPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        Add a few more subscriptions over time to see your spend grow.
      </p>
    );
  }

  const maxCents = Math.max(...points.map((p) => p.cumulativeMonthlyCents), 1);
  const xPercent = (i: number) => (i / (points.length - 1)) * 100;
  const yPercent = (cents: number) =>
    CHART_HEIGHT - BOTTOM_PADDING - (cents / maxCents) * (CHART_HEIGHT - TOP_PADDING - BOTTOM_PADDING);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPercent(i)} ${yPercent(p.cumulativeMonthlyCents)}`)
    .join(" ");
  const areaPath = `${linePath} L ${xPercent(points.length - 1)} ${CHART_HEIGHT} L ${xPercent(0)} ${CHART_HEIGHT} Z`;

  const active = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];
  const activeIndex = hoverIndex ?? points.length - 1;

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">{active.monthLabel}</p>
        <p className="font-mono text-lg font-semibold tabular-nums">{formatCents(active.cumulativeMonthlyCents)}/mo</p>
      </div>
      <div
        className="relative h-48 w-full"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-gold)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#growth-fill)" />
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-gold)"
            strokeWidth={0.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {hoverIndex !== null ? (
            <>
              <line
                x1={xPercent(hoverIndex)}
                x2={xPercent(hoverIndex)}
                y1={0}
                y2={CHART_HEIGHT}
                stroke="var(--color-border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={xPercent(hoverIndex)}
                cy={yPercent(points[hoverIndex].cumulativeMonthlyCents)}
                r={1.6}
                fill="var(--color-gold)"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
        <div className="absolute inset-0 flex">
          {points.map((point, i) => (
            <button
              key={point.monthIso}
              type="button"
              className="h-full flex-1"
              onMouseEnter={() => setHoverIndex(i)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
              aria-label={`${point.monthLabel}: ${formatCents(point.cumulativeMonthlyCents)} per month`}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{points[0].monthLabel}</span>
        <span>{points[points.length - 1].monthLabel}</span>
      </div>
      {/* Screen-reader-only data table — the chart above is a visual summary
          of the same values, not the only way to access them. */}
      <table className="sr-only">
        <caption>Cumulative monthly spend by month added</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Cumulative monthly spend</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, i) => (
            <tr key={point.monthIso} className={cn(i === activeIndex && "font-semibold")}>
              <td>{point.monthLabel}</td>
              <td>{formatCents(point.cumulativeMonthlyCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
