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
import { getUpgradeUrl } from "@/lib/billing/plan";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { runInsightsEngine } from "@/lib/insights-engine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionCard } from "@/components/dashboard/motion-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { SpendBySourceBars } from "@/components/analytics/spend-by-source-bars";
import { BillingCycleCards } from "@/components/analytics/billing-cycle-cards";
import { GrowthChart } from "@/components/analytics/growth-chart";
import { RenewalsTimelineChart } from "@/components/analytics/renewals-timeline-chart";
import { TopMerchantsList } from "@/components/analytics/top-merchants-list";
import { RiskAlertsCard, AiRecommendationsCard } from "@/components/dashboard/insights/insight-panels";
import { BarChart3 } from "lucide-react";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const subscriptions = await listSubscriptions(user.id);
  // Monetization pass, section 6: everything above this point (spend
  // growth, upcoming renewals, top subscriptions, spend by source, billing
  // cycles) stays exactly as free as it already was — "basic spend
  // summary, basic category breakdown, basic useful analytics" per that
  // section's own Free/Pro split, none of it newly restricted. What's new
  // is adding this page's own Pro depth (Risk alerts, Optimization
  // recommendations) below, reusing the exact same engine output and gated
  // cards the dashboard already uses — not a second, page-specific
  // definition of what's premium here.
  const isPremium = await resolveHasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);
  const engineOutput = runInsightsEngine(subscriptions, isPremium);

  if (subscriptions.length === 0) {
    return (
      <div className="max-w-4xl">
        <SectionHeading
          as="h1"
          eyebrow="Deeper look"
          title="Analytics"
          description="A deeper look at your subscription spend over time."
        />
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
      <SectionHeading
        as="h1"
        eyebrow="Deeper look"
        title="Analytics"
        description="A deeper look at your subscription spend over time."
      />

      <MotionCard>
        <Card size="sm" className="shadow-elevation-low">
          <CardHeader>
            <CardTitle>Spend growth</CardTitle>
            <CardDescription>Cumulative monthly spend, by the month each subscription was added.</CardDescription>
          </CardHeader>
          <CardContent>
            <GrowthChart points={growth} currency={currency ?? undefined} />
          </CardContent>
        </Card>
      </MotionCard>

      <StaggerSection className="grid gap-4 lg:grid-cols-2" staggerChildren={0.07}>
        <MotionCard>
          <Card size="sm" className="h-full shadow-elevation-low">
            <CardHeader>
              <CardTitle>Upcoming renewals</CardTitle>
              <CardDescription>Projected renewal charges over the next 12 months.</CardDescription>
            </CardHeader>
            <CardContent>
              <RenewalsTimelineChart months={renewals} currency={currency ?? undefined} />
            </CardContent>
          </Card>
        </MotionCard>

        <MotionCard>
          <Card size="sm" className="h-full shadow-elevation-low">
            <CardHeader>
              <CardTitle>Top subscriptions</CardTitle>
              <CardDescription>Ranked by annual cost.</CardDescription>
            </CardHeader>
            <CardContent>
              <TopMerchantsList merchants={topMerchants} />
            </CardContent>
          </Card>
        </MotionCard>
      </StaggerSection>

      <StaggerSection className="grid gap-4 lg:grid-cols-2" staggerChildren={0.07}>
        <MotionCard>
          <Card size="sm" className="h-full shadow-elevation-low">
            <CardHeader>
              <CardTitle>Spend by source</CardTitle>
              <CardDescription>Where each active subscription came from.</CardDescription>
            </CardHeader>
            <CardContent>
              <SpendBySourceBars entries={spendBySource} currency={currency ?? undefined} />
            </CardContent>
          </Card>
        </MotionCard>

        <MotionCard>
          <Card size="sm" className="h-full shadow-elevation-low">
            <CardHeader>
              <CardTitle>Billing cycles</CardTitle>
              <CardDescription>How your spend splits across billing frequencies.</CardDescription>
            </CardHeader>
            <CardContent>
              <BillingCycleCards entries={billingCycles} currency={currency ?? undefined} />
            </CardContent>
          </Card>
        </MotionCard>
      </StaggerSection>

      {/* Same two Pro-gated cards the dashboard already renders, fed the
          same engineOutput computed above — RiskAlertsCard/AiRecommendationsCard
          already return null for a premium caller with nothing to show, and
          the shared UpgradeCard (billing/upgrade-prompt.tsx) for a free one,
          so this page can't show different Pro content than the dashboard
          does for the same account. */}
      <StaggerSection className="grid gap-4 lg:grid-cols-2" staggerChildren={0.07}>
        <MotionCard>
          <RiskAlertsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
        </MotionCard>
        <MotionCard>
          <AiRecommendationsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
        </MotionCard>
      </StaggerSection>
    </div>
  );
}
