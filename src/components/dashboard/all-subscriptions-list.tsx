"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { EmptyState } from "@/components/ui/empty-state";
import { SubscriptionRow } from "@/components/subscriptions/subscription-row";
import { getDuplicateFlaggedIds, getHighCostFlaggedIds } from "@/lib/subscriptions/filters";
import { staggerContainer } from "@/lib/motion";
import type { Subscription } from "@/lib/db/schema";
import type { ComputedInsight } from "@/lib/subscriptions/insights";

// Reuses SubscriptionRow (category icon, status badge, monthly/yearly cost,
// renewal urgency, duplicate/high-cost flags) instead of the bare
// name+amount list this used to be, same component the full subscriptions
// page uses, just without the bulk-select checkbox (SubscriptionRow's
// onToggleSelected is optional for exactly this read-only-preview case).
//
// Also doubles as the dashboard's "what's coming up" list (fed
// `upcomingRenewals` instead of every subscription — see dashboard/page.tsx):
// this used to be a second, separately-styled list, RenewalsList, stacked
// directly above this one, rendering an overlapping set of subscriptions in
// a plainer format. Two lists answering the same "what do I need to look at"
// question back to back was real duplication, not two distinct pieces of
// information, so RenewalsList was retired in favor of pointing this one at
// the renewal-sorted, 30-day-windowed set instead of the unsorted full list.
// emptyTitle/emptyDescription exist so that call site can say "nothing
// renewing soon" instead of "no subscriptions yet" without this component
// needing to know which caller it's serving.
export function AllSubscriptionsList({
  subscriptions,
  insights,
  emptyTitle = "No subscriptions yet",
  emptyDescription = "Add your first one using the quick-add bar above.",
}: {
  subscriptions: Subscription[];
  insights: ComputedInsight[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  // No action button here on purpose: this is the dashboard's only call
  // site, and QuickAddBar (the actual recommended path) already renders
  // directly above it. A second "Add your first one" button here used to
  // compete with it on the exact screen a brand-new user sees first, right
  // below copy that already pointed at the bar above, a competing CTA the
  // empty state's own wording was quietly contradicting.
  if (subscriptions.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={Inbox}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  const duplicateIds = getDuplicateFlaggedIds(insights);
  const highCostIds = getHighCostFlaggedIds(insights);
  const hiddenCount = subscriptions.length - 6;

  return (
    <>
      <motion.ul
        variants={staggerContainer(0.05)}
        initial="hidden"
        animate="visible"
        className="mt-4 space-y-2"
      >
        <AnimatePresence initial={false}>
          {subscriptions.slice(0, 6).map((s) => (
            <SubscriptionRow
              key={s.id}
              subscription={s}
              isDuplicate={duplicateIds.has(s.id)}
              isHighCost={highCostIds.has(s.id)}
            />
          ))}
        </AnimatePresence>
      </motion.ul>
      {/* This section's own heading already has a "View all" link, but
          that's far enough above a 6-row list that it's easy to scroll past
          without ever noticing there's more. This list used to just stop
          at 6 with nothing telling you so. Same "+N more" framing
          reveal-step.tsx's own merchant-pill truncation already uses. */}
      {hiddenCount > 0 ? (
        <Link
          href="/subscriptions"
          className="mt-2 block text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          +{hiddenCount} more. View all
        </Link>
      ) : null}
    </>
  );
}
