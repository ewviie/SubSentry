import Link from "next/link";
import { DollarSign, TrendingUp, Layers, CalendarClock } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { StatCard } from "@/components/dashboard/stat-card";
import { CategorySpendBar } from "@/components/dashboard/category-spend-bar";
import { QuickAddBar } from "@/components/subscriptions/quick-add-bar";
import { InsightsSection } from "@/components/dashboard/insights-section";
import { RenewalsList } from "@/components/dashboard/renewals-list";
import { AllSubscriptionsList } from "@/components/dashboard/all-subscriptions-list";
import { DashboardHeroRow } from "@/components/dashboard/dashboard-hero-row";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import {
  computeHealthScore,
  computeInsights,
  computePotentialSavingsMonthlyCents,
} from "@/lib/subscriptions/insights";
import { getUpgradeUrl } from "@/lib/billing/plan";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const insights = computeInsights(data.subscriptions);
  const upgradeUrl = user.plan === "free" ? getUpgradeUrl(user.id) : null;

  const potentialSavingsMonthlyCents = computePotentialSavingsMonthlyCents(insights);
  const duplicateInsights = insights.filter((i) => i.potentialSavingsMonthlyCents !== undefined);
  const healthScore = computeHealthScore(insights, data.activeCount);

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-h1 font-semibold">
            Welcome, {user.name || user.email}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Here&apos;s what you&apos;re paying for.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {upgradeUrl ? (
            <Button variant="outline" render={<a href={upgradeUrl} />} nativeButton={false}>
              Upgrade to Pro
            </Button>
          ) : null}
          <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
            Add subscription
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <QuickAddBar />
        </CardContent>
      </Card>

      {data.activeCount > 0 ? (
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
          accentClassName="bg-gold-muted text-gold"
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming renewals</CardTitle>
          </CardHeader>
          <CardContent>
            <RenewalsList renewals={data.upcomingRenewals} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spend by category</CardTitle>
          </CardHeader>
          <CardContent>
            <CategorySpendBar entries={data.categoryBreakdown} />
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-h2 font-semibold">All subscriptions</h2>
          <Link href="/subscriptions" className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        </div>
        <AllSubscriptionsList subscriptions={data.subscriptions} />
      </div>
    </div>
  );
}
