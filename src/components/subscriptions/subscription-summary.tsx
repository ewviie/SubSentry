import { formatCents, monthlyCents } from "@/lib/subscriptions/money";
import { cn } from "@/lib/utils";
import type { Subscription } from "@/lib/db/schema";

const CYCLE_DAYS: Record<Subscription["billingCycle"], number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

// This page used to be pure edit form — click into any one subscription and
// the "detail" page told you nothing you didn't already know from the list
// it came from. This is the actual detail: what tracking it has cost so
// far, what it costs annually, when it renews next. Estimated, not
// invented: there's no real charge history to read (no bank connection,
// no stored transaction log for manually-added subscriptions), so this is
// openly an estimate derived from billing cycle × time tracked, labeled as
// such rather than presented as a fact this app doesn't actually have.
// Date.now() pulled out of the component body on purpose — this project's
// lint config (react-hooks/purity) flags an impure call directly inside a
// component's render, the same reason insights.ts's todayISO() lives in a
// plain helper rather than inline in a page component.
function estimatePaidCents(subscription: Subscription): number {
  const daysSinceTracked = Math.max(0, Math.floor((Date.now() - subscription.createdAt.getTime()) / 86_400_000));
  const cycleDays = CYCLE_DAYS[subscription.billingCycle];
  const periodsElapsed = Math.max(1, Math.floor(daysSinceTracked / cycleDays) + 1);
  return periodsElapsed * subscription.amountCents;
}

// sharePercent: this subscription's annual cost as a share of the user's
// total active annual spend — null (not 0) whenever that comparison
// wouldn't mean anything: a paused/canceled subscription isn't part of
// current spend to take a share of, and a portfolio with $0 active spend
// has no denominator. Computed by the caller (subscriptions/[id]/page.tsx),
// not here — this component already doesn't fetch or aggregate anything
// beyond the one subscription it's given, and computing "total spend"
// needs every other active subscription, not just this one.
export function SubscriptionSummary({
  subscription,
  sharePercent = null,
}: {
  subscription: Subscription;
  sharePercent?: number | null;
}) {
  const estimatedPaidCents = estimatePaidCents(subscription);
  const annualCents = monthlyCents(subscription.amountCents, subscription.billingCycle) * 12;

  const trackedSinceLabel = subscription.createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 border-b border-border pb-4 text-sm sm:grid-cols-3",
        sharePercent !== null && "sm:grid-cols-4",
      )}
    >
      <div>
        <p className="text-muted-foreground">Est. paid since tracking</p>
        <p className="font-mono font-medium tabular-nums">{formatCents(estimatedPaidCents, subscription.currency)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Since {trackedSinceLabel}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Per year</p>
        <p className="font-mono font-medium tabular-nums">{formatCents(annualCents, subscription.currency)}</p>
      </div>
      <div>
        <p className="text-muted-foreground">Next renewal</p>
        <p className="font-medium">{subscription.nextRenewalDate}</p>
      </div>
      {sharePercent !== null ? (
        <div>
          <p className="text-muted-foreground">Share of your spend</p>
          <p className="font-mono font-medium tabular-nums">{sharePercent}%</p>
          <p className="mt-0.5 text-xs text-muted-foreground">of total annual spend</p>
        </div>
      ) : null}
    </div>
  );
}
