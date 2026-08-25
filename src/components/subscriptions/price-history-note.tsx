import { TrendingUp, TrendingDown, History } from "lucide-react";
import { formatCents } from "@/lib/subscriptions/money";
import { BILLING_CYCLE_LABELS } from "@/lib/subscriptions/labels";
import { computeLatestPriceChange } from "@/lib/subscriptions/price-history";
import type { SubscriptionPriceHistory } from "@/lib/db/schema";

// Phase 9. The detail-page half of price-history capture (see schema.ts's
// subscriptionPriceHistory comment for the write side). Two honest states,
// same "say what's actually known, not what would be nice to know"
// discipline as every other empty state in this app: a subscription with
// no recorded change yet says exactly that, rather than staying silent
// (silence here would read as "nothing to report," which isn't the same
// claim as "we haven't been watching long enough to know").
export function PriceHistoryNote({
  history,
  trackedSinceLabel,
}: {
  history: SubscriptionPriceHistory[];
  trackedSinceLabel: string;
}) {
  const change = computeLatestPriceChange(history);

  if (!change) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground">
          We started tracking this subscription&apos;s price on {trackedSinceLabel}. We&apos;ll flag any changes here
          once we&apos;ve seen one.
        </p>
      </div>
    );
  }

  const increased = change.annualDeltaCents > 0;
  const Icon = increased ? TrendingUp : TrendingDown;
  const cycleChanged = change.fromBillingCycle !== change.toBillingCycle;
  // Only annotate each price with its billing cadence when the cadence
  // actually differs between the two. The common case (same cycle,
  // different amount) reads better as a plain "$10.00 → $12.00" than a
  // redundant "$10.00 (billed monthly) → $12.00 (billed monthly)".
  const fromLabel = cycleChanged
    ? `${formatCents(change.fromCents, change.currency)} (billed ${BILLING_CYCLE_LABELS[change.fromBillingCycle].toLowerCase()})`
    : formatCents(change.fromCents, change.currency);
  const toLabel = cycleChanged
    ? `${formatCents(change.toCents, change.currency)} (billed ${BILLING_CYCLE_LABELS[change.toBillingCycle].toLowerCase()})`
    : formatCents(change.toCents, change.currency);

  return (
    <div
      className={
        increased
          ? "flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm"
          : "flex items-start gap-3 rounded-lg border border-emerald/20 bg-emerald-muted p-4 text-sm"
      }
    >
      <Icon className={increased ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-emerald"} aria-hidden="true" />
      <div>
        <p className={increased ? "font-medium text-destructive" : "font-medium text-emerald"}>
          Price {increased ? "increased" : "decreased"} {Math.abs(Math.round(change.percentChange))}%
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {fromLabel} → {toLabel} on {change.observedAtIso}
          {increased
            ? `. That's an additional ${formatCents(change.annualDeltaCents, change.currency)}/year.`
            : `. That's ${formatCents(Math.abs(change.annualDeltaCents), change.currency)}/year less.`}
        </p>
      </div>
    </div>
  );
}
