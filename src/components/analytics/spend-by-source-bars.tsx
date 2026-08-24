"use client";

import { motion } from "framer-motion";
import { formatCents } from "@/lib/subscriptions/money";
import { SOURCE_BAR_CLASSES } from "@/lib/subscriptions/analytics-labels";
import { springSmooth } from "@/lib/motion";
import type { SpendBySourceEntry } from "@/lib/subscriptions/analytics";

// Same mark language as dashboard/category-spend-bar.tsx (bar width
// relative to the largest entry, spring fill animation, rounded track) —
// deliberately reused rather than a different chart style, so "a ranked
// breakdown" reads the same way everywhere in the app.
export function SpendBySourceBars({ entries, currency }: { entries: SpendBySourceEntry[]; currency?: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a subscription to see where it came from.</p>;
  }

  const max = Math.max(...entries.map((e) => e.monthlyCents));

  return (
    <ul className="space-y-3.5">
      {entries.map((entry) => (
        <li key={entry.source}>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium">{entry.label}</span>
            <span className="font-mono tabular-nums text-muted-foreground">{formatCents(entry.monthlyCents, currency)}/mo</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              className={`h-full rounded-full ${SOURCE_BAR_CLASSES[entry.source]}`}
              initial={{ width: 0 }}
              animate={{
                width: `${max > 0 && entry.monthlyCents > 0 ? Math.max((entry.monthlyCents / max) * 100, 3) : 0}%`,
              }}
              transition={springSmooth}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
