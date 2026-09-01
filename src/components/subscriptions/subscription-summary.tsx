import { formatCents, monthlyCents, annualCents as computeAnnualCents } from "@/lib/subscriptions/money";
import { estimatePaidCents } from "@/lib/subscriptions/price-history";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";

// This page used to be pure edit form: click into any one subscription and
// the "detail" page told you nothing you didn't already know from the list
// it came from. This is the actual detail: what tracking it has cost so
// far, what it costs annually, when it renews next. estimatePaidCents lives
// in price-history.ts (not here); it's genuinely price-history-aware logic
// now, not a one-line formula, and that's where it can actually be unit
// tested (this file has no test infrastructure of its own; nothing in this
// codebase unit-tests a .tsx component directly).
//
// sharePercent: this subscription's annual cost as a share of the user's
// total active annual spend. Null (not 0) whenever that comparison
// wouldn't mean anything: a paused/canceled subscription isn't part of
// current spend to take a share of, and a portfolio with $0 active spend
// has no denominator. Computed by the caller (subscriptions/[id]/page.tsx),
// not here: this component already doesn't fetch or aggregate anything
// beyond the one subscription it's given, and computing "total spend"
// needs every other active subscription, not just this one.
export function SubscriptionSummary({
  subscription,
  history,
  sharePercent = null,
}: {
  subscription: Subscription;
  history: SubscriptionPriceHistory[];
  sharePercent?: number | null;
}) {
  const estimatedPaidCents = estimatePaidCents(subscription, history);
  // Not monthlyCents(...) * 12 — see money.ts's own annualCents comment for
  // why that double-rounds a yearly/quarterly/weekly subscription's annual
  // figure away from its own stored price.
  const annualCents = computeAnnualCents(subscription.amountCents, subscription.billingCycle);

  const trackedSinceLabel = subscription.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 border-b border-border pb-4 text-sm sm:grid-cols-2 md:grid-cols-4",
        sharePercent !== null && "md:grid-cols-5",
      )}
    >
      <div>
        <p className="text-muted-foreground">Est. paid since tracking</p>
        <p className="font-financial font-medium">{formatCents(estimatedPaidCents, subscription.currency)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Since {trackedSinceLabel}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Per year</p>
        <p className="font-financial font-medium">{formatCents(annualCents, subscription.currency)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Next renewal</p>
        <p className="font-medium">{subscription.nextRenewalDate}</p>
      </div>
      {sharePercent !== null ? (
        <div>
          <p className="text-muted-foreground">Share of your spend</p>
          <p className="font-financial font-medium">{sharePercent}%</p>
          <p className="mt-0.5 text-xs text-muted-foreground">of total annual spend</p>
        </div>
      ) : null}
      <div>
        <p className="text-muted-foreground">Last reviewed</p>
        {/* subscription.lastReviewedAt reflects the state BEFORE this page
            view — see subscriptions/[id]/page.tsx's own comment: the write
            that records *this* visit runs via after(), scheduled to happen
            once the response is already on its way, so what's shown here
            is honestly "the last time before now," never a self-referential
            "just now" on every single load. */}
        <p className="font-medium">{subscription.lastReviewedAt ? formatRelativeTime(subscription.lastReviewedAt) : "Never"}</p>
      </div>
    </div>
  );
}
