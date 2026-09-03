"use client";

import { motion } from "framer-motion";
import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { CATEGORY_BAR_CLASSES } from "@/lib/subscriptions/category-colors";
import { formatCents } from "@/lib/subscriptions/money";
import { springSmooth } from "@/lib/motion";
import type { CategoryBreakdownEntry } from "@/lib/subscriptions/queries";

// Bar width is relative to the largest category, not the monthly total:
// the point is comparing categories against each other (the actual
// question this card answers), not showing what fraction of a whole pie
// each one is.
export function CategorySpendBar({ entries, currency }: { entries: CategoryBreakdownEntry[]; currency: string }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Add a subscription to see your breakdown.</p>
    );
  }

  const max = Math.max(...entries.map((e) => e.monthlyCents));

  return (
    <>
      <ul className="space-y-3.5">
        {entries.map((entry) => (
          <li key={entry.category}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium">{CATEGORY_LABELS[entry.category]}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatCents(entry.monthlyCents, currency)}/mo
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <motion.div
                className={`h-full rounded-full ${CATEGORY_BAR_CLASSES[entry.category]}`}
                initial={{ width: 0 }}
                animate={{
                  width: `${
                    max > 0 && entry.monthlyCents > 0
                      ? Math.max((entry.monthlyCents / max) * 100, 3)
                      : 0
                  }%`,
                }}
                transition={springSmooth}
              />
            </div>
          </li>
        ))}
      </ul>
      {/* entries is sorted descending (queries.ts's getDashboardData), so
          entries[0] is the largest bar above. "Other" leading isn't really
          a spend-pattern finding — it's the category form's own default
          (subscription-form.tsx), left unset — so it's named honestly here
          instead of reading as SubSentry's best answer to "where does my
          money go." Only shown when Other actually dominates, not whenever
          it appears at all, to avoid flagging a legitimately small
          leftover bucket. */}
      {entries[0]?.category === "other" ? (
        <p className="mt-3 text-xs text-muted-foreground">
          &ldquo;Other&rdquo; groups subscriptions without a specific category. Set one when editing a subscription
          for a clearer breakdown.
        </p>
      ) : null}
    </>
  );
}
