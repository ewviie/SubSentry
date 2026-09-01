import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCents } from "@/lib/subscriptions/money";
import type { PortfolioPriceChangeEntry, PortfolioPriceChangeTotal } from "@/lib/subscriptions/price-history";

// Product-value pass: turns subscriptionPriceHistory (Phase 9's own price-
// capture table, previously only ever read per-subscription on its own
// detail page) into the portfolio-wide "what's changing" view Analytics
// never had — computePortfolioPriceChanges (price-history.ts) is the only
// detection here; this component is presentation only.
export function PriceChangesCard({
  entries,
  total,
  creepingCost,
}: {
  entries: PortfolioPriceChangeEntry[];
  total: PortfolioPriceChangeTotal | null;
  // "Creeping cost" (watchdog phase): trailing-12-month sum of every
  // genuine increase, not just each subscription's latest one — a
  // deliberately different figure from `total` above (which is
  // per-subscription-latest-only, matching the entries list it's the sum
  // of). See price-history.ts's computeCreepingCostTrailing12Months for
  // the full "why these two numbers can differ" reasoning. Labeled
  // explicitly as an estimate of accumulated cost, never framed as money
  // the user could definitely get back — that's what /savings is for.
  creepingCost: PortfolioPriceChangeTotal | null;
}) {
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Price changes</CardTitle>
        <CardDescription>Subscriptions that genuinely got more expensive, biggest impact first.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Watchdog phase: "creeping cost," shown independently of the list
            below — computeCreepingCostTrailing12Months walks every
            consecutive price-history pair, not just each subscription's
            latest change, so it can genuinely differ from (and in a rare
            edge case, exist even when) the per-subscription-latest list is
            empty. Never framed as recoverable savings — this is "cost that
            crept in," not "money you could get back." */}
        {creepingCost ? (
          <p className="mb-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            <span className="font-financial font-medium text-foreground">{formatCents(creepingCost.annualDeltaCents, creepingCost.currency)}</span>{" "}
            in creeping cost from price increases over the last 12 months.
          </p>
        ) : null}
        {entries.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No price increases detected"
            description="SubSentry only flags a change once real price history shows one — nothing fabricated."
          />
        ) : (
          <div className="space-y-3">
            {total ? (
              <p className="text-sm text-muted-foreground">
                Together, that&apos;s{" "}
                <span className="font-financial font-medium text-foreground">{formatCents(total.annualDeltaCents, total.currency)}</span>{" "}
                more per year than before.
              </p>
            ) : null}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {entries.map(({ subscription, change }) => (
                <li key={subscription.id}>
                  <Link
                    href={`/subscriptions/${subscription.id}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{subscription.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCents(change.fromCents, change.currency)} → {formatCents(change.toCents, change.currency)} on{" "}
                        {change.observedAtIso}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-financial text-sm font-medium text-destructive">
                        +{formatCents(change.annualDeltaCents, change.currency)}/yr
                      </p>
                      <p className="text-xs text-muted-foreground">{Math.round(change.percentChange)}% more</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
