"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
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
  if (subscriptions.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={Inbox}
        title="No subscriptions yet"
        description="Add your first one to start tracking what you pay for, or try the quick-add bar above."
        action={
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/subscriptions/new" />}
            nativeButton={false}
          >
            Add your first one
          </Button>
        }
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
