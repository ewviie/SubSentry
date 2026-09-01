"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { groupRenewalsByProximity } from "@/lib/subscriptions/renewal-calendar";
import { formatCents } from "@/lib/subscriptions/money";
import { BILLING_CYCLE_LABELS } from "@/lib/subscriptions/labels";
import { CATEGORY_BADGE_CLASSES, CATEGORY_ICONS } from "@/lib/subscriptions/category-colors";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import type { Subscription } from "@/lib/db/schema";

// The Renewal Calendar (product-value pass) — a genuinely useful "what
// renews when" view, not a decorative month grid: grouped by real
// proximity (Overdue / This week / This month / Later) rather than laid
// out on empty calendar cells for every day nothing renews. Every figure
// here (amount, billing cycle, days until) is the same real, already-
// stored data /subscriptions' own list already shows — this is a different
// sort/grouping of it, not a second source of truth.
export function RenewalCalendarView({ subscriptions }: { subscriptions: Subscription[] }) {
  const buckets = useMemo(() => groupRenewalsByProximity(subscriptions), [subscriptions]);

  if (buckets.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={CalendarCheck}
        title="Nothing renewing in the next 90 days"
        description="Active subscriptions renewing soon will show up here, grouped by how urgent they are."
      />
    );
  }

  return (
    <div className="space-y-6">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="space-y-2">
          <h3 className={bucket.key === "overdue" ? "text-sm font-semibold text-destructive" : "text-sm font-semibold"}>
            {bucket.label}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {bucket.subscriptions.map((s) => {
              const Icon = CATEGORY_ICONS[s.category];
              const when = s.daysUntil < 0 ? `${Math.abs(s.daysUntil)}d overdue` : s.daysUntil === 0 ? "Today" : s.daysUntil === 1 ? "Tomorrow" : `In ${s.daysUntil} days`;
              return (
                <li key={s.id}>
                  <Link href={`/subscriptions/${s.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
                    <div
                      aria-hidden="true"
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${CATEGORY_BADGE_CLASSES[s.category]}`}
                    >
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.nextRenewalDate} · {BILLING_CYCLE_LABELS[s.billingCycle]}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-financial text-sm font-medium">{formatCents(s.amountCents, s.currency)}</p>
                      <Badge variant={s.daysUntil < 0 ? "destructive" : s.daysUntil <= 7 ? "warning" : "outline"} className="mt-0.5">
                        {when}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
