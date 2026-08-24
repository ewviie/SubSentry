import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import {
  computeSpendBySource,
  computeSpendByBillingCycle,
  computeGrowthOverTime,
  computeRenewalsTimeline,
  computeTopMerchantsBySpend,
} from "@/lib/subscriptions/analytics";
import { splitByPrimaryCurrency } from "@/lib/subscriptions/money";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SpendBySourceBars } from "@/components/analytics/spend-by-source-bars";
import { BillingCycleCards } from "@/components/analytics/billing-cycle-cards";
import { GrowthChart } from "@/components/analytics/growth-chart";
import { RenewalsTimelineChart } from "@/components/analytics/renewals-timeline-chart";
import { TopMerchantsList } from "@/components/analytics/top-merchants-list";
import { BarChart3 } from "lucide-react";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const subscriptions = await listSubscriptions(user.id);

  if (subscriptions.length === 0) {
    return (
      <div className="max-w-4xl">
        <h1 className="font-heading text-h1 font-semibold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">A deeper look at your subscription spend over time.</p>
        <EmptyState
          className="mt-6"
          icon={BarChart3}
          title="Nothing to analyze yet"
          description="Add or import a few subscriptions and this page fills in with real charts."
        />
      </div>
    );
  }

  const spendBySource = computeSpendBySource(subscriptions);
  const billingCycles = computeSpendByBillingCycle(subscriptions);
  const growth = computeGrowthOverTime(subscriptions);
  const renewals = computeRenewalsTimeline(subscriptions);
  const topMerchants = computeTopMerchantsBySpend(subscriptions);
  // Each compute* above already restricts its own sums to this same primary
  // currency internally (see analytics.ts) — this is just the label for the
  // charts below, computed the same way (majority-by-count active
  // subscription currency) so it always agrees with what was actually
  // summed. topMerchants is a per-row list, not a sum, and correctly still
  // shows every currency's merchants — it doesn't need this.
  const { currency } = splitByPrimaryCurrency(subscriptions.filter((s) => s.status === "active"));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">A deeper look at your subscription spend over time.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Spend growth</CardTitle>
          <CardDescription>Cumulative monthly spend, by the month each subscription was added.</CardDescription>
        </CardHeader>
        <CardContent>
          <GrowthChart points={growth} currency={currency ?? undefined} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming renewals</CardTitle>
            <CardDescription>Projected renewal charges over the next 12 months.</CardDescription>
          </CardHeader>
          <CardContent>
            <RenewalsTimelineChart months={renewals} currency={currency ?? undefined} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top subscriptions</CardTitle>
            <CardDescription>Ranked by annual cost.</CardDescription>
          </CardHeader>
          <CardContent>
            <TopMerchantsList merchants={topMerchants} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by source</CardTitle>
            <CardDescription>Where each active subscription came from.</CardDescription>
          </CardHeader>
          <CardContent>
            <SpendBySourceBars entries={spendBySource} currency={currency ?? undefined} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Billing cycles</CardTitle>
            <CardDescription>How your spend splits across billing frequencies.</CardDescription>
          </CardHeader>
          <CardContent>
            <BillingCycleCards entries={billingCycles} currency={currency ?? undefined} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
