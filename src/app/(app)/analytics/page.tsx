import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import {
  computeSpendBySource,
  computeSpendByBillingCycle,
  computeGrowthOverTime,
  computeRenewalsTimeline,
  computeTopMerchantsBySpend,
} from "@/lib/subscriptions/analytics";
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
          <GrowthChart points={growth} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming renewals</CardTitle>
            <CardDescription>Projected renewal charges over the next 12 months.</CardDescription>
          </CardHeader>
          <CardContent>
            <RenewalsTimelineChart months={renewals} />
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
            <SpendBySourceBars entries={spendBySource} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Billing cycles</CardTitle>
            <CardDescription>How your spend splits across billing frequencies.</CardDescription>
          </CardHeader>
          <CardContent>
            <BillingCycleCards entries={billingCycles} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
