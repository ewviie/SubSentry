"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, Copy, TrendingUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatCents, monthlyCents, annualCents } from "@/lib/subscriptions/money";
import { CATEGORY_LABELS, STATUS_LABELS } from "@/lib/subscriptions/labels";
import { CATEGORY_BADGE_CLASSES, CATEGORY_ICONS } from "@/lib/subscriptions/category-colors";
import { daysUntilRenewal } from "@/lib/subscriptions/filters";
import { fadeInUp, liftOnHover, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Subscription } from "@/lib/db/schema";

// Local to this file now: the dashboard's own upcoming-renewals list used
// to be a separate component (dashboard/renewals-list.tsx) that imported
// this for the same overdue/≤3 days/≤7 days urgency tiering, reused rather
// than re-derived with its own thresholds that could quietly drift from
// this one. That component was retired in favor of reusing SubscriptionRow
// itself (see all-subscriptions-list.tsx), which already renders this
// badge internally, so nothing outside this file needs it directly anymore.
function RenewalBadge({ subscription }: { subscription: Subscription }) {
  const days = daysUntilRenewal(subscription);
  if (subscription.status !== "active") {
    return <span className="text-sm text-muted-foreground">{subscription.nextRenewalDate}</span>;
  }
  // Renewal urgency is the one honest "trend" signal we actually have data
  // for: we don't store price history, so this deliberately isn't a
  // fabricated price-trend arrow.
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-destructive">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        Overdue
      </span>
    );
  }
  if (days <= 3) {
    return (
      <span className="text-sm font-medium text-destructive">
        {days === 0 ? "Renews today" : `Renews in ${days}d`}
      </span>
    );
  }
  if (days <= 7) {
    return <span className="text-sm font-medium text-emerald">Renews in {days}d</span>;
  }
  return <span className="text-sm text-muted-foreground">{subscription.nextRenewalDate}</span>;
}

export function SubscriptionRow({
  subscription,
  selected = false,
  onToggleSelected,
  isDuplicate = false,
  isHighCost = false,
}: {
  subscription: Subscription;
  selected?: boolean;
  // Optional: omit entirely for a read-only context (the dashboard's "All
  // subscriptions" preview) to drop the checkbox rather than wiring a
  // no-op handler. SubscriptionsExplorer (bulk actions) still passes both.
  onToggleSelected?: (id: string) => void;
  isDuplicate?: boolean;
  isHighCost?: boolean;
}) {
  const CategoryIcon = CATEGORY_ICONS[subscription.category];
  const monthly = monthlyCents(subscription.amountCents, subscription.billingCycle);

  return (
    <motion.li
      variants={fadeInUp}
      whileHover={liftOnHover}
      transition={springSnappy}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium sm:flex-row sm:items-center",
        selected && "border-primary/40 ring-1 ring-primary/20"
      )}
    >
      <div className="flex items-center gap-3">
        {onToggleSelected ? (
          <Checkbox
            className="relative z-10"
            checked={selected}
            onCheckedChange={() => onToggleSelected(subscription.id)}
            aria-label={`Select ${subscription.name}`}
          />
        ) : null}
        <div
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            CATEGORY_BADGE_CLASSES[subscription.category]
          )}
        >
          <CategoryIcon className="size-4" />
        </div>
        <div className="min-w-0 sm:hidden">
          <Link
            href={`/subscriptions/${subscription.id}`}
            className="after:absolute after:inset-0 after:content-[''] hover:underline"
          >
            <span className="font-medium">{subscription.name}</span>
          </Link>
        </div>
      </div>

      <div className="min-w-0 hidden sm:block sm:flex-1">
        <Link
          href={`/subscriptions/${subscription.id}`}
          className="after:absolute after:inset-0 after:content-[''] hover:underline"
        >
          <span className="font-medium">{subscription.name}</span>
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="secondary" className={cn("relative z-10", CATEGORY_BADGE_CLASSES[subscription.category])}>
            {CATEGORY_LABELS[subscription.category]}
          </Badge>
          {isDuplicate ? (
            <span className="relative z-10 inline-flex items-center gap-1 text-xs font-medium text-destructive">
              <Copy className="size-3" aria-hidden="true" />
              Possible duplicate
            </span>
          ) : null}
          {isHighCost ? (
            <span className="relative z-10 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <TrendingUp className="size-3" aria-hidden="true" />
              High cost
            </span>
          ) : null}
        </div>
      </div>

      {/* Mobile-only badge row: the desktop version lives inline with the
          name above instead, since there's horizontal room for it there. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
        <Badge variant="secondary" className={cn("relative z-10", CATEGORY_BADGE_CLASSES[subscription.category])}>
          {CATEGORY_LABELS[subscription.category]}
        </Badge>
        {isDuplicate ? (
          <span className="relative z-10 inline-flex items-center gap-1 text-xs font-medium text-destructive">
            <Copy className="size-3" aria-hidden="true" />
            Possible duplicate
          </span>
        ) : null}
        {isHighCost ? (
          <span className="relative z-10 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <TrendingUp className="size-3" aria-hidden="true" />
            High cost
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 sm:contents">
        <div className="sm:w-28 sm:text-right">
          <RenewalBadge subscription={subscription} />
        </div>

        <div className="text-right font-mono text-sm tabular-nums sm:w-32">
          <p className="font-medium">{formatCents(monthly, subscription.currency)}/mo</p>
          {/* Not monthly * 12 — that double-rounds a yearly/quarterly/weekly
              subscription's annual figure away from its own stored price
              (e.g. a $99.99/yr subscription's monthly-equivalent rounds to
              $8.33, and $8.33 * 12 = $99.96 — 3 cents off the real price).
              annualCents converts directly from the stored amount using
              each cycle's own exact multiplier. See money.ts's own comment. */}
          <p className="text-xs text-muted-foreground">
            {formatCents(annualCents(subscription.amountCents, subscription.billingCycle), subscription.currency)}/yr
          </p>
        </div>

        <Badge
          variant={
            subscription.status === "active"
              ? "success"
              : subscription.status === "paused"
                ? "warning"
                : "outline"
          }
        >
          {STATUS_LABELS[subscription.status]}
        </Badge>
      </div>
    </motion.li>
  );
}
