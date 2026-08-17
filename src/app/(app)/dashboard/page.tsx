import Link from "next/link";
import { DollarSign, Layers, PiggyBank, BarChart3 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { StatCard } from "@/components/dashboard/stat-card";
import { formatCents } from "@/lib/subscriptions/money";
import { CategorySpendBar } from "@/components/dashboard/category-spend-bar";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { QuickAddBar } from "@/components/subscriptions/quick-add-bar";
import { InsightsSection } from "@/components/dashboard/insights-section";
import { AllSubscriptionsList } from "@/components/dashboard/all-subscriptions-list";
import { DashboardHeroRow } from "@/components/dashboard/dashboard-hero-row";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { computeInsights, computePotentialSavingsMonthlyCents } from "@/lib/subscriptions/insights";
import { getUpgradeUrl, hasPaidAccess } from "@/lib/billing/plan";
import { runInsightsEngine } from "@/lib/insights-engine";
import {
  BiggestOpportunityCard,
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
  // Insights and the Savings opportunities section below both ultimately
  // read from the same overlap/duplicate detection — left unfiltered here,
  // "Possible duplicate: Netflix and Netflix Premium" and "3 active
  // streaming subscriptions" rendered as Insights cards up top, then
  // rendered again verbatim (same title text) inside Savings opportunities
  // further down the same page: a real user scrolling past both reads the
  // identical sentence twice. Savings opportunities already gives overlap
  // findings a fuller, more actionable treatment (dollar impact, a specific
  // "review" target) than an Insights card can, so Insights keeps only the
  // findings that don't get their own second home elsewhere on this page —
  // overdue renewals and cost spikes. duplicateInsights/AllSubscriptionsList
  // above and below still read the unfiltered `insights` array; only what
  // InsightsSection renders is narrowed.
  const dashboardInsights = insights.filter((i) => i.type !== "possible_overlap");
  const healthScore = engineOutput.healthScore;
  const hasActive = data.activeCount > 0;
  // Distinct from hasActive: someone with subscriptions that are all paused
  // or canceled still gets real information from "$0.00 monthly, 0 active"
  // — that's a legitimate state, not an empty one. True first-run (nothing
  // added yet) is the one where a stat row and an "insights" section have
  // nothing to report by construction, not by outcome.
  const hasAnySubscriptions = data.subscriptions.length > 0;

  return (
    <div className="space-y-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* min-w-0 — without it, a flex item's automatic minimum width is
            its content's min-content size (spec default, applies in
            flex-col too), not 0. A name falls back to the account's
            email when unset, and an email has no natural break point;
            with no min-w-0 here, the browser reserved room to fit it on
            one unbroken line and forced this whole row (and the page)
            wider than the viewport on mobile — confirmed via a real
            production build (a long email caused ~230px of horizontal
            overflow at every tested mobile width). break-words on the
            h1 below is the other half of the fix: min-w-0 alone would
            still let the text overflow its own box; break-words gives
            it somewhere to actually wrap to once it's allowed to shrink. */}
        <div className="min-w-0">
          <h1 className="break-words font-heading text-h1 font-semibold">Welcome, {user.name || user.email}</h1>
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

      {/* Back to one column — the left-rail shell got tried and rejected.
          Every other decluttering change (size="sm" everywhere, the merged
          renewals card, the 3-col savings grid, dropping the chart that
          duplicated /analytics below) stays.

          Refinement pass: the section heading itself is gated on
          hasAnySubscriptions too now, not just its contents — a heading
          promising "your spend, savings, and health at a glance" with
          nothing underneath it on a brand-new account was its own small
          version of the same problem (a container with nothing in it),
          just missed on the first pass. */}
      {hasAnySubscriptions ? (
      <section className="space-y-6">
        <SectionHeading
          title="Financial Overview"
          description="Your spend, savings, and subscription health at a glance."
        />
        {hasActive ? (
          <DashboardHeroRow
            potentialYearlySavingsCents={potentialSavingsMonthlyCents * 12}
            duplicateInsights={duplicateInsights}
            healthScore={healthScore}
          />
        ) : null}
        {/* North Star Part 3 ("what's my biggest opportunity?") gets a
            direct, single-answer spot right under the hero row — before
            this, the closest thing was scrolling all the way to Savings
            opportunities/Quick wins further down and inferring it yourself
            from two separate ranked lists. */}
        {hasActive ? <BiggestOpportunityCard output={engineOutput} /> : null}
        {/* Was 4 stat cards; down to 2. "Annual spend" was Monthly × 12 with
            no information Monthly didn't already imply — folded into
            Monthly's own caption instead of a whole separate box. "Next
            renewal" duplicated the Renewals card's own list further down
            the page outright (same date, same subscription) — the exact
            redundancy already fixed once inside that card, just missed here
            the first time. Active subscriptions stays: it's the one number
            that answers this app's actual question ("how many things am I
            paying for"), not a derived restatement of another card.

            Both this row and Insights below are gated on hasAnySubscriptions
            now — they used to render unconditionally, so a brand-new
            account saw "$0.00" and "0" stat cards plus an empty-insights
            notice before ever reaching the one deliberately-designed empty
            state further down. Every other section on this page already
            knew to hide itself with no data; these two were the ones that
            got missed. Real, useful side effect: since these mount fresh
            (rather than sitting static at zero) the moment the first
            subscription is added, their existing entrance animations
            (StaggerSection, CountUp) now actually play at a moment that
            means something, instead of never firing at all. No inner
            hasAnySubscriptions check needed here anymore — the whole
            section above is gated on it now. */}
        <StaggerSection className="grid gap-4 sm:grid-cols-2">
          <StatCard
            icon={DollarSign}
            label="Monthly spend"
            accentClassName="bg-emerald-muted text-emerald"
            caption={`Across ${data.activeCount} active subscription${data.activeCount === 1 ? "" : "s"} · ${formatCents(data.annualTotalCents)}/yr`}
            emphasis
          >
            <CountUp value={data.monthlyTotalCents} format="currency" />
          </StatCard>
          <StatCard icon={Layers} label="Active subscriptions" accentClassName="bg-chart-3/10 text-chart-3">
            <CountUp value={data.activeCount} format="integer" />
          </StatCard>
        </StaggerSection>
        <InsightsSection insights={dashboardInsights} />
      </section>
      ) : null}

      <section className="space-y-6">
        <SectionHeading
          title="Subscription Management"
          // First-run-specific: a brand-new account's only guaranteed-to-work
          // path to real value is typing one subscription below — Plaid/
          // TrueLayer/Gmail aren't configured in this deployment (both show
          // as "Coming soon" in the import wizard) and CSV/Apple both require
          // leaving the app first to get a file. Naming that here, only when
          // it's true, is honest framing, not a claim about capability that
          // doesn't exist yet.
          description={
            hasAnySubscriptions
              ? "Add a subscription and see what's renewing next."
              : "Type what you're paying for below — takes about 10 seconds."
          }
          action={
            <Link href="/subscriptions" className="text-sm text-muted-foreground hover:underline">
              View all
            </Link>
          }
        />
        <Card size="sm">
          <CardContent>
            <QuickAddBar isFirstSubscription={!hasAnySubscriptions} />
          </CardContent>
        </Card>
        {/* One merged card instead of two side-by-side ones that led with
            the same fact (see RenewalForecastCard's own comment). */}
        {hasActive ? <RenewalForecastCard output={engineOutput} renewals={data.upcomingRenewals} /> : null}
        <AllSubscriptionsList subscriptions={data.subscriptions} insights={insights} />
      </section>

      {/* Pulled out of the old flat 8-card grid so the highest-intent
          content (real dollar recs) stops competing for attention with
          informational panels. */}
      {hasActive ? (
        <section className="space-y-6">
          <SectionHeading
            title="Savings opportunities"
            description="The biggest wins, ranked by real dollar impact."
            icon={PiggyBank}
            iconClassName="text-emerald"
          />
          {/* 3-wide, not the 2-wide grid every other section uses —
              Optimization score is one short number next to three cards
              that are each a short list, so a uniform 2-column split kept
              leaving one side of the row visually heavier than the other.
              3 columns lets the score sit on its own instead of stretching
              to match a list card's height. */}
          <div className="grid gap-4 lg:grid-cols-3">
            <SavingsOpportunitiesCard output={engineOutput} />
            <QuickWinsCard output={engineOutput} />
            <OptimizationScoreCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
            <AiRecommendationsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
          </div>
        </section>
      ) : null}

      {/* "Spending trend" used to render its own full GrowthChart card here
          — the exact same chart, over the exact same data, as /analytics'
          "Spend growth" card. Not a padding problem, a real duplicate page
          section. Dropped in favor of a link to the real thing; what's
          dashboard-only (category breakdown, risk alerts, score breakdown)
          stays, since none of that exists on /analytics. */}
      {hasActive ? (
        <section className="space-y-6">
          <SectionHeading
            title="Analytics"
            description="Trends, categories, and patterns across your subscriptions."
            icon={BarChart3}
            action={
              <Link href="/analytics" className="text-sm text-muted-foreground hover:underline">
                View full analytics →
              </Link>
            }
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card size="sm">
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
