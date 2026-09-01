"use client";

import { useState } from "react";
import { formatCents } from "@/lib/subscriptions/money";
import { cn } from "@/lib/utils";
import type { SpendHistoryPoint } from "@/lib/subscriptions/price-history";

const CHART_HEIGHT = 40; // viewBox units
const TOP_PADDING = 4;
const BOTTOM_PADDING = 2;

// Same single-series line/area shape as GrowthChart (growth-chart.tsx), a
// deliberately different question: that line only ever accumulates from
// each subscription's own createdAt; this one moves with the active
// portfolio's REAL price history — up on a genuine increase, down if a
// price ever genuinely fell, flat otherwise. Months containing a genuine
// change get a colored marker (destructive for a net increase, emerald for
// a net decrease — same convention PriceHistoryNote already uses) so a
// bend in the line is never left unexplained; hovering (or focusing, for
// keyboard/screen-reader users) a month reveals exactly which
// subscription(s) moved and by how much.
export function SpendTrendChart({ points, currency }: { points: SpendHistoryPoint[]; currency?: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Keep tracking a little longer to see your cost trend here.
      </p>
    );
  }

  const maxCents = Math.max(...points.map((p) => p.totalMonthlyCents), 1);
  const xPercent = (i: number) => (i / (points.length - 1)) * 100;
  const yPercent = (cents: number) =>
    CHART_HEIGHT - BOTTOM_PADDING - (cents / maxCents) * (CHART_HEIGHT - TOP_PADDING - BOTTOM_PADDING);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPercent(i)} ${yPercent(p.totalMonthlyCents)}`)
    .join(" ");
  const areaPath = `${linePath} L ${xPercent(points.length - 1)} ${CHART_HEIGHT} L ${xPercent(0)} ${CHART_HEIGHT} Z`;

  const activeIndex = hoverIndex ?? points.length - 1;
  const active = points[activeIndex];

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-muted-foreground">{active.monthLabel}</p>
        <p className="font-mono text-lg font-semibold tabular-nums">{formatCents(active.totalMonthlyCents, currency)}/mo</p>
      </div>
      <div className="relative h-40 w-full" onMouseLeave={() => setHoverIndex(null)}>
        <svg viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          <defs>
            <linearGradient id="spend-trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-emerald)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--color-emerald)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#spend-trend-fill)" />
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-emerald)"
            strokeWidth={0.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => {
            if (p.events.length === 0) return null;
            const netAnnualDeltaCents = p.events.reduce((sum, e) => sum + e.annualDeltaCents, 0);
            return (
              <circle
                key={p.monthIso}
                cx={xPercent(i)}
                cy={yPercent(p.totalMonthlyCents)}
                r={1.4}
                fill={netAnnualDeltaCents >= 0 ? "var(--color-destructive)" : "var(--color-emerald)"}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {hoverIndex !== null ? (
            <line
              x1={xPercent(hoverIndex)}
              x2={xPercent(hoverIndex)}
              y1={0}
              y2={CHART_HEIGHT}
              stroke="var(--color-border)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
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
              aria-label={`${point.monthLabel}: ${formatCents(point.totalMonthlyCents, currency)} per month${
                point.events.length > 0
                  ? `, ${point.events.length} price change${point.events.length === 1 ? "" : "s"}`
                  : ""
              }`}
            />
          ))}
        </div>
      </div>
      {active.events.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-2">
          {active.events.map((event) => (
            <li key={`${event.subscriptionId}-${event.observedAtIso}`} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{event.subscriptionName}</span>{" "}
              {formatCents(event.fromCents, event.currency)} → {formatCents(event.toCents, event.currency)}{" "}
              <span className={event.annualDeltaCents >= 0 ? "text-destructive" : "text-emerald"}>
                ({event.annualDeltaCents >= 0 ? "+" : "−"}
                {formatCents(Math.abs(event.annualDeltaCents), event.currency)}/yr)
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{points[0].monthLabel}</span>
        <span>{points[points.length - 1].monthLabel}</span>
      </div>
      {/* Screen-reader-only data table. The chart above is a visual summary
          of the same values, not the only way to access them. */}
      <table className="sr-only">
        <caption>Active portfolio cost by month, reconstructed from real price history</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Monthly cost</th>
            <th>Price changes</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, i) => (
            <tr key={point.monthIso} className={cn(i === activeIndex && "font-semibold")}>
              <td>{point.monthLabel}</td>
              <td>{formatCents(point.totalMonthlyCents, currency)}</td>
              <td>
                {point.events
                  .map((event) => `${event.subscriptionName}: ${formatCents(event.fromCents, event.currency)} to ${formatCents(event.toCents, event.currency)}`)
                  .join("; ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
