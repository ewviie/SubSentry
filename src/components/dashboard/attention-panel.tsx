import Link from "next/link";
import type { Route } from "next";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatCents } from "@/lib/subscriptions/money";
import { formatRelativeTime } from "@/lib/utils";
import { NOTIFICATION_TYPE_ICON } from "@/components/notifications/type-icon";
import type { Notification } from "@/lib/db/schema";
import type { RecentActivitySummary } from "@/lib/notifications/queries";

const TYPE_LABEL: Record<Notification["type"], string> = {
  price_increase: "price increase",
  upcoming_renewal: "upcoming renewal",
  stale_subscription: "unreviewed",
  unusual_charge: "unusual charge",
  savings_opportunity: "savings opportunity",
  duplicate_subscription: "duplicate",
  renewal_lapsed: "possibly lapsed",
};

// The dashboard's "What needs your attention" panel — product-value pass,
// round 2. Replaces BiggestOpportunityCard's dashboard slot (still real,
// still tested, still importable — just no longer rendered here): that
// card only ever answered "what's my biggest savings opportunity," a
// strict subset of what this shows. This is the single ranked list across
// every notification type (price increases, stale subscriptions,
// duplicates, savings opportunities), already computed and persisted by
// syncNotifications on this same page load — no new detection, just a
// different, more complete read of it (see notifications/queries.ts's
// getAttentionItems).
//
// activitySummary answers a different question ("what changed recently")
// from a different angle than the ranked list ("what's unresolved right
// now") — shown together so a returning user gets both "here's what's new"
// and "here's what to do about it" in one place, not two separate hunts.
export function AttentionPanel({
  items,
  activitySummary,
}: {
  items: Notification[];
  activitySummary: RecentActivitySummary;
}) {
  return (
    <Card className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Needs your attention</CardTitle>
        <CardDescription>
          {activitySummary.totalCount > 0
            ? `${activitySummary.totalCount} thing${activitySummary.totalCount === 1 ? "" : "s"} detected in the last 30 days.`
            : "Nothing detected in the last 30 days."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-6 text-center">
            <div className="mx-auto flex flex-col items-center gap-2 text-muted-foreground">
              <ShieldCheck className="size-5 text-emerald" aria-hidden="true" />
              <p className="text-sm">All caught up — nothing unread needs a look right now.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {items.map((item) => {
              const Icon = NOTIFICATION_TYPE_ICON[item.type];
              return (
                <li key={item.id}>
                  <Link
                    href={(item.actionHref ?? "/notifications") as Route}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <div
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${item.severity === "warning" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="capitalize">{TYPE_LABEL[item.type]}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(item.createdAt)}</span>
                      </div>
                    </div>
                    {item.impactCents !== null && item.currency ? (
                      <span className="shrink-0 font-financial text-sm font-medium">{formatCents(item.impactCents, item.currency)}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
