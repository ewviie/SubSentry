import Link from "next/link";
import { DollarSign, TrendingUp, Layers, CalendarClock, PiggyBank, BarChart3 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { StatCard } from "@/components/dashboard/stat-card";
import { CategorySpendBar } from "@/components/dashboard/category-spend-bar";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { QuickAddBar } from "@/components/subscriptions/quick-add-bar";
import { InsightsSection } from "@/components/dashboard/insights-section";
import { RenewalsList } from "@/components/dashboard/renewals-list";
import { AllSubscriptionsList } from "@/components/dashboard/all-subscriptions-list";
import { DashboardHeroRow } from "@/components/dashboard/dashboard-hero-row";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { computeInsights, computePotentialSavingsMonthlyCents } from "@/lib/subscriptions/insights";
import { computeGrowthOverTime } from "@/lib/subscriptions/analytics";
import { GrowthChart } from "@/components/analytics/growth-chart";
import { getUpgradeUrl, hasPaidAccess } from "@/lib/billing/plan";
import { runInsightsEngine } from "@/lib/insights-engine";
import {
  QuickWinsCard,
  PositiveHabitsCard,
  RenewalForecastCard,
  SavingsOpportunitiesCard,
  ScoreBreakdownCard,
  OptimizationScoreCard,
  AiRecommendationsCard,
  RiskAlertsCard,
} from "@/components/dashboard/insights/insight-panels";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const insights = computeInsights(data.subscriptions);
  const isPremium = hasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);

  const potentialSavingsMonthlyCents = computePotentialSavingsMonthlyCents(insights);
  const duplicateInsights = insights.filter((i) => i.potentialSavingsMonthlyCents !== undefined);
  const engineOutput = runInsightsEngine(data.subscriptions, isPremium);
  const healthScore = engineOutput.healthScore;
  const growthPoints = computeGrowthOverTime(data.subscriptions);
  const hasActive = data.activeCount > 0;

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-h1 font-semibold">Welcome, {user.name || user.email}</h1>
          <p className="mt-1 text-muted-foreground">Here&apos;s what you&apos;re paying for.</p>
        </div>
        <div className="flex items-center gap-2">
          {upgradeUrl ? (
            <Button variant="outline" render={<a href={upgradeUrl} />} nativeButton={false}>
              Upgrade to Pro
            </Button>
          ) : null}
          <Button variant="outline" render={<Link href="/subscriptions/import" />} nativeButton={false}>
            Import subscriptions
          </Button>
        </div>
      </div>

      {/* Section 1 — Financial overview: the KPIs and alerts a user opens
          this page to check, all visible without scrolling past a wall of
          equally-weighted cards. */}
      <section className="space-y-6">
        <SectionHeading
          title="Financial overview"
          description="Your spend, savings, and subscription health at a glance."
        />
        {hasActive ? (
          <DashboardHeroRow
            potentialYearlySavingsCents={potentialSavingsMonthlyCents * 12}
            duplicateInsights={duplicateInsights}
            healthScore={healthScore}
          />
        ) : null}
        <StaggerSection className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={DollarSign}
            label="Monthly spend"
            accentClassName="bg-emerald-muted text-emerald"
            caption={`Across ${data.activeCount} active subscription${data.activeCount === 1 ? "" : "s"}`}
            emphasis
          >
            <CountUp value={data.monthlyTotalCents} format="currency" />
          </StatCard>
          <StatCard icon={TrendingUp} label="Annual spend" accentClassName="bg-chart-2/10 text-chart-2">
            <CountUp value={data.annualTotalCents} format="currency" />
          </StatCard>
          <StatCard icon={Layers} label="Active subscriptions" accentClassName="bg-chart-3/10 text-chart-3">
            <CountUp value={data.activeCount} format="integer" />
          </StatCard>
          <StatCard icon={CalendarClock} label="Next renewal" accentClassName="bg-chart-4/10 text-chart-4">
            {data.upcomingRenewals[0] ? (
              data.upcomingRenewals[0].nextRenewalDate
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </StatCard>
        </StaggerSection>
        <InsightsSection insights={insights} />
      </section>

      {/* Section 2 — Subscription management: add, review, and track
          what's renewing next. */}
      <section className="space-y-6">
        <SectionHeading
          title="Subscription management"
          description="Add a subscription and see what's renewing next."
          action={
            <Link href="/subscriptions" className="text-sm text-muted-foreground hover:underline">
              View all
            </Link>
          }
        />
        <Card>
          <CardContent className="pt-6">
            <QuickAddBar />
          </CardContent>
        </Card>
        {hasActive ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <RenewalForecastCard output={engineOutput} />
            <Card>
              <CardHeader>
                <CardTitle>Upcoming renewals</CardTitle>
              </CardHeader>
              <CardContent>
                <RenewalsList renewals={data.upcomingRenewals} />
              </CardContent>
            </Card>
          </div>
        ) : null}
        <AllSubscriptionsList subscriptions={data.subscriptions} insights={insights} />
      </section>

      {/* Section 3 — Savings opportunities: pulled out of the old flat
          8-card grid so the highest-intent content (real dollar recs)
          stops competing for attention with informational panels. */}
      {hasActive ? (
        <section className="space-y-6">
          <SectionHeading
            title="Savings opportunities"
            description="The biggest wins, ranked by real dollar impact."
            icon={PiggyBank}
            iconClassName="text-emerald"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <SavingsOpportunitiesCard output={engineOutput} />
            <QuickWinsCard output={engineOutput} />
            <OptimizationScoreCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
            <AiRecommendationsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
          </div>
        </section>
      ) : null}

      {/* Section 4 — Analytics: trends, categories, patterns. */}
      {hasActive ? (
        <section className="space-y-6">
          <SectionHeading
            title="Analytics"
            description="Trends, categories, and patterns across your subscriptions."
            icon={BarChart3}
          />
          <Card>
            <CardHeader>
              <CardTitle>Spending trend</CardTitle>
            </CardHeader>
            <CardContent>
              <GrowthChart points={growthPoints} />
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Spend by category</CardTitle>
              </CardHeader>
              <CardContent>
                <CategorySpendBar entries={data.categoryBreakdown} />
              </CardContent>
            </Card>
            <PositiveHabitsCard output={engineOutput} />
            <RiskAlertsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
            <ScoreBreakdownCard output={engineOutput} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
