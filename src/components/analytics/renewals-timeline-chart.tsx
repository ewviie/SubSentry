"use client";

import { useState } from "react";
import { formatCents } from "@/lib/subscriptions/money";
import { cn } from "@/lib/utils";
import type { RenewalMonthEntry } from "@/lib/subscriptions/analytics";

// A 12-bar time series, one flat hue (gold — this app's established "spend"
// accent) since each bar's identity is its position in time, not a
// category — a sequential ramp or per-bar hue here would wrongly imply
// each month is a different "kind" of thing. Per-bar hover tooltip, same
// interaction pattern as the line chart's hover.
export function RenewalsTimelineChart({ months }: { months: RenewalMonthEntry[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = Math.max(...months.map((m) => m.totalCents), 1);

  return (
    <div>
      <div
        className="flex h-40 gap-1.5"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {months.map((month, i) => {
          const heightPct = month.totalCents > 0 ? Math.max((month.totalCents / max) * 100, 4) : 0;
          return (
            // h-full on this wrapper (not `items-end` on the row above) is
            // what gives the bar below a definite height to resolve its own
            // percentage height against — a percentage height only works
            // against an ancestor with a real, non-auto height.
            <div key={month.monthIso} className="relative h-full flex-1">
              <div
                className="absolute bottom-0 w-full"
                style={{ height: `${heightPct}%`, minHeight: month.totalCents > 0 ? "2px" : "0px" }}
              >
                {hoverIndex === i ? (
                  <div className="absolute -top-9 z-10 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium shadow-elevation-low">
                    {formatCents(month.totalCents)}
                  </div>
                ) : null}
                <button
                  type="button"
                  className={cn(
                    "h-full w-full rounded-t-sm bg-gold/70 transition-colors hover:bg-gold",
                    hoverIndex === i && "bg-gold",
                  )}
                  onMouseEnter={() => setHoverIndex(i)}
                  onFocus={() => setHoverIndex(i)}
                  onBlur={() => setHoverIndex(null)}
                  aria-label={`${month.monthLabel}: ${formatCents(month.totalCents)} across ${month.count} renewal${month.count === 1 ? "" : "s"}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[10px] text-muted-foreground">
        {months.map((month) => (
          <span key={month.monthIso} className="flex-1 truncate text-center">
            {month.monthLabel.split(" ")[0]}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Upcoming renewal charges by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Total</th>
            <th>Renewals</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.monthIso}>
              <td>{month.monthLabel}</td>
              <td>{formatCents(month.totalCents)}</td>
              <td>{month.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
