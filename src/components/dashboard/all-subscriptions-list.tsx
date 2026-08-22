"use client";

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
// name+amount list this used to be — same component the full subscriptions
// page uses, just without the bulk-select checkbox (SubscriptionRow's
// onToggleSelected is optional for exactly this read-only-preview case).
export function AllSubscriptionsList({
  subscriptions,
  insights,
}: {
  subscriptions: Subscription[];
  insights: ComputedInsight[];
}) {
  // No action button here on purpose — this is the dashboard's only call
  // site, and QuickAddBar (the actual recommended path) already renders
  // directly above it. A second "Add your first one" button here used to
  // compete with it on the exact screen a brand-new user sees first, right
  // below copy that already pointed at the bar above — a competing CTA the
  // empty state's own wording was quietly contradicting.
  if (subscriptions.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={Inbox}
        title="No subscriptions yet"
        description="Add your first one using the quick-add bar above."
      />
    );
  }

  const duplicateIds = getDuplicateFlaggedIds(insights);
  const highCostIds = getHighCostFlaggedIds(insights);

  return (
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
  );
}
