import Link from "next/link";
import { PiggyBank, BarChart3 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData, getAllPriceHistoryForUser, getRealizedSavings } from "@/lib/subscriptions/queries";
import { computeRealizedSavings } from "@/lib/subscriptions/savings";
import { getDismissedRecommendationIds } from "@/lib/subscriptions/dismissed-recommendations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategorySpendBar } from "@/components/dashboard/category-spend-bar";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { QuickAddBar } from "@/components/subscriptions/quick-add-bar";
import { InsightsSection } from "@/components/dashboard/insights-section";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { computeCreepingCostTrailing12Months } from "@/lib/subscriptions/price-history";
import { MotionCard } from "@/components/dashboard/motion-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { computeInsights, computePotentialSavingsMonthlyCents } from "@/lib/subscriptions/insights";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, getUpgradeUrl, isBetaAllAccess, shouldShowSubscriptionLimitBanner } from "@/lib/billing/plan";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { runInsightsEngine } from "@/lib/insights-engine";
import { syncNotifications, getAttentionItems, getRecentActivitySummary } from "@/lib/notifications/queries";
import { AttentionPanel } from "@/components/dashboard/attention-panel";
import { UpgradeLimitBanner } from "@/components/billing/upgrade-prompt";
import {
  QuickWinsCard,
  PositiveHabitsCard,
  RenewalForecastCard,
  SavingsOpportunitiesCard,
  ScoreBreakdownCard,
  UnrealizedSavingsCard,
  AiRecommendationsCard,
  RiskAlertsCard,
} from "@/components/dashboard/insights/insight-panels";

export default async function DashboardPage() {
  const user = await requireUser();
  // Neither read depends on the other's result, fetched in parallel, same
  // reasoning subscriptions/[id]/page.tsx's own comment gives for its
  // Promise.all (raised in local-council review, Performance lens, for that
  // page; applied here too rather than reintroducing the same avoidable
  // extra round trip).
  const [data, priceHistoryBySubscriptionId, dismissedRecommendationIds] = await Promise.all([
    getDashboardData(user.id),
    getAllPriceHistoryForUser(user.id),
    getDismissedRecommendationIds(user.id),
  ]);
  const insights = computeInsights(data.subscriptions);
  const isPremium = await resolveHasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);

  const potentialSavingsMonthlyCents = computePotentialSavingsMonthlyCents(insights);
  const duplicateInsights = insights.filter((i) => i.potentialSavingsMonthlyCents !== undefined);
  const engineOutput = runInsightsEngine(data.subscriptions, isPremium, priceHistoryBySubscriptionId, dismissedRecommendationIds);
  // Notification/Intelligence Center: generate this account's current
  // notifications from data already loaded above — see generate.ts's own
  // header comment for why nothing here is a second, independent detection
  // pass. Awaited (not fire-and-forget) so a fresh finding is guaranteed
  // persisted before the bell icon's own fetch on this same page render;
  // insertNotifications' onConflictDoNothing makes repeat calls on every
  // dashboard load cheap (a skipped no-op) once a finding already has a row.
  await syncNotifications(user.id, {
    subscriptions: data.subscriptions,
    priceHistoryBySubscriptionId,
    savingsRecommendations: engineOutput.savingsForecast.recommendations,
    isPremium,
    dismissedRecommendationIds,
  });
  // "Needs your attention" (see attention-panel.tsx's own comment) — reads
  // what syncNotifications just persisted, so this always reflects the same
  // findings the bell/notifications page would show, never a second
  // detection pass.
  const [attentionItems, activitySummary, realizedSavingsRecords] = await Promise.all([
    getAttentionItems(user.id),
    getRecentActivitySummary(user.id),
    // User Value Journey Audit, opportunity #1 revised: the same permanent
    // ledger /savings reads from — fetched here so AttentionPanel can state
    // it unconditionally (no "worth showing" gate the way the digest needs;
    // this is a page render, not an email that might not otherwise fire).
    getRealizedSavings(user.id),
  ]);
  const realizedSavings = computeRealizedSavings(realizedSavingsRecords);
  const creepingCost = computeCreepingCostTrailing12Months(data.subscriptions, priceHistoryBySubscriptionId);
  // Insights and the Savings opportunities section below both ultimately
  // read from the same overlap/duplicate detection, left unfiltered here,
  // "Possible duplicate: Netflix and Netflix Premium" and "3 active
  // streaming subscriptions" rendered as Insights cards up top, then
  // rendered again verbatim (same title text) inside Savings opportunities
  // further down the same page: a real user scrolling past both reads the
  // identical sentence twice. Savings opportunities already gives overlap
  // findings a fuller, more actionable treatment (dollar impact, a specific
  // "review" target) than an Insights card can, so Insights keeps only the
  // findings that don't get their own second home elsewhere on this page:
  // overdue renewals and cost spikes. duplicateInsights/AllSubscriptionsList
  // above and below still read the unfiltered `insights` array; only what
  // InsightsSection renders is narrowed.
  const dashboardInsights = insights.filter((i) => i.type !== "possible_overlap");
  const healthScore = engineOutput.healthScore;
  const hasActive = data.activeCount > 0;
  // Distinct from hasActive: someone with subscriptions that are all paused
  // or canceled still gets real information from "$0.00 monthly, 0 active"
  // That's a legitimate state, not an empty one. True first-run (nothing
  // added yet) is the one where a stat row and an "insights" section have
  // nothing to report by construction, not by outcome.
  const hasAnySubscriptions = data.subscriptions.length > 0;

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* UI audit fix: this used to fall back to the account's email
            ("Welcome, alex@example.com") when no name was set — an email
            address isn't a name, and blowing it up to text-h1 as this
            page's hero headline read as a data leak/placeholder, not a
            greeting. Nameless accounts now get the plain, still-warm
            "Welcome" with nothing appended, an intentional neutral
            empty-state rather than a fallback value with no natural
            reason to be this prominent. min-w-0 + break-words stay: a
            user-entered name has no length limit here either (see
            settings' EditNameForm, 120 chars) and could still in
            principle be one long unbroken word. */}
        <div className="min-w-0">
          <h1 className="break-words font-heading text-h1 font-semibold">
            Welcome{user.name ? `, ${user.name}` : ""}
          </h1>
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

      {/* Back to one column: the left-rail shell got tried and rejected.
          Every other decluttering change (size="sm" everywhere, the merged
          renewals card, the 3-col savings grid, dropping the chart that
          duplicated /analytics below) stays.

          Refinement pass: the section heading itself is gated on
          hasAnySubscriptions too now, not just its contents. A heading
          promising "your spend, savings, and health at a glance" with
          nothing underneath it on a brand-new account was its own small
          version of the same problem (a container with nothing in it),
          just missed on the first pass. */}
      {hasAnySubscriptions ? (
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Overview"
          title="Financial Overview"
          description="Your spend, savings, and subscription health at a glance."
        />
        {/* One composed panel instead of a stat-card row plus two more
            stacked cards underneath it. See overview-panel.tsx's own
            comment for why. Monthly spend, health, and savings now read as
            one hierarchy instead of four boxes of equal visual weight. */}
        {hasActive ? (
          <OverviewPanel
            monthlyTotalCents={data.monthlyTotalCents}
            annualTotalCents={data.annualTotalCents}
            currency={data.currency}
            otherCurrencyActiveCount={data.otherCurrencyActiveCount}
            activeCount={data.activeCount}
            potentialYearlySavingsCents={potentialSavingsMonthlyCents * 12}
            duplicateInsights={duplicateInsights}
            creepingCostAnnualDeltaCents={creepingCost?.annualDeltaCents ?? null}
            creepingCostCurrency={creepingCost?.currency ?? null}
            healthScore={healthScore}
          />
        ) : null}
        {/* Product-value pass, round 2: replaces the old BiggestOpportunityCard
            slot (savings-only) with the fuller cross-type attention panel —
            see attention-panel.tsx's own comment. Net card count on the page
            is unchanged; what's in this one slot just answers a bigger
            question now. */}
        {hasActive ? (
          <MotionCard>
            <AttentionPanel items={attentionItems} activitySummary={activitySummary} realizedSavings={realizedSavings} />
          </MotionCard>
        ) : null}
        <InsightsSection insights={dashboardInsights} />
      </section>
      ) : null}

      <section className="space-y-5">
        <SectionHeading
          weight="secondary"
          title="Subscription Management"
          // First-run-specific: a brand-new account's only guaranteed-to-work
          // path to real value is typing one subscription below. Plaid/
          // TrueLayer/Gmail aren't configured in this deployment (both show
          // as "Coming soon" in the import wizard) and CSV/Apple both require
          // leaving the app first to get a file. Naming that here, only when
          // it's true, is honest framing, not a claim about capability that
          // doesn't exist yet.
          description={
            hasAnySubscriptions
              ? "Add a subscription and see what's renewing next."
              : "Type what you're paying for below. Takes about 10 seconds."
          }
          action={
            <Link href="/subscriptions" className="text-sm text-muted-foreground hover:underline">
              View all
            </Link>
          }
        />
        <MotionCard>
          <Card size="sm">
            <CardContent>
              <QuickAddBar isFirstSubscription={!hasAnySubscriptions} />
            </CardContent>
          </Card>
        </MotionCard>
        {/* Section 9 of the monetization pass: progressive limit awareness
            right where a user is actively adding more, not only after a
            hard block on /api/subscriptions. Same "4 of 5" threshold and
            isPremium guard as the Subscriptions page's own banner — see
            that page's comment for why it starts one below the real limit
            rather than from zero, and why it's already correctly inert for
            a real beta user. */}
        {shouldShowSubscriptionLimitBanner(isPremium, data.activeCount) ? (
          <UpgradeLimitBanner
            current={data.activeCount}
            limit={FREE_PLAN_SUBSCRIPTION_LIMIT}
            beta={isBetaAllAccess()}
            upgradeUrl={upgradeUrl}
          />
        ) : null}
        {/* One merged card instead of two side-by-side ones that led with
            the same fact (see RenewalForecastCard's own comment), and now
            the dashboard's only subscription list at all: this used to be
            followed by a second, separately-sorted AllSubscriptionsList
            rendering an overlapping set of subscriptions again right below
            it. RenewalForecastCard renders that same component internally
            now, fed the renewal-sorted set instead of the unsorted full
            one — see its own and all-subscriptions-list.tsx's comments. */}
        {hasActive ? (
          <MotionCard>
            <RenewalForecastCard output={engineOutput} renewals={data.upcomingRenewals} insights={insights} />
          </MotionCard>
        ) : null}
      </section>

      {/* Pulled out of the old flat 8-card grid so the highest-intent
          content (real dollar recs) stops competing for attention with
          informational panels. */}
      {hasActive ? (
        <section className="space-y-5">
          <SectionHeading
            weight="secondary"
            title="Savings opportunities"
            description="The biggest wins, ranked by real dollar impact."
            icon={PiggyBank}
            iconClassName="text-emerald"
          />
          {/* 3-wide, not the 2-wide grid every other section uses.
              Unrealized savings is one short figure next to three cards
              that are each a short list, so a uniform 2-column split kept
              leaving one side of the row visually heavier than the other.
              3 columns lets it sit on its own instead of stretching to
              match a list card's height.
              items-start (not the grid default stretch): the third column
              now stacks Unrealized savings with Optimization recommendations
              underneath it, so it's naturally taller than the single cards
              in the other two columns. Without items-start, grid's default
              row-stretch would force those two shorter columns to grow to
              match, leaving visible empty space at the bottom of each. */}
          <StaggerSection className="grid items-start gap-4 lg:grid-cols-3" staggerChildren={0.07}>
            <MotionCard>
              <SavingsOpportunitiesCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
            </MotionCard>
            <MotionCard>
              <QuickWinsCard output={engineOutput} />
            </MotionCard>
            {/* Optimization recommendations sits directly under Unrealized
                savings, same column, instead of wrapping to its own row
                below the other two cards (a flat 4th item in a 3-col grid
                lands alone in column 1 of a second row) — keeps the
                recommendation paired with the figure it elaborates on, and
                visually secondary to it (smaller, second in the stack)
                rather than reading as its own separate section. */}
            <div className="space-y-4">
              <MotionCard>
                <UnrealizedSavingsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
              </MotionCard>
              <MotionCard>
                <AiRecommendationsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
              </MotionCard>
            </div>
          </StaggerSection>
        </section>
      ) : null}

      {/* "Spending trend" used to render its own full GrowthChart card here,
          the exact same chart, over the exact same data, as /analytics'
          "Spend growth" card. Not a padding problem, a real duplicate page
          section. Dropped in favor of a link to the real thing; what's
          dashboard-only (category breakdown, risk alerts, score breakdown)
          stays, since none of that exists on /analytics. */}
      {hasActive ? (
        <section className="space-y-5">
          <SectionHeading
            weight="secondary"
            title="Analytics"
            description="Trends, categories, and patterns across your subscriptions."
            icon={BarChart3}
            action={
              <Link href="/analytics" className="text-sm text-muted-foreground hover:underline">
                View full analytics →
              </Link>
            }
          />
          <StaggerSection className="grid gap-4 lg:grid-cols-2" staggerChildren={0.07}>
            <MotionCard>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Spend by category</CardTitle>
                </CardHeader>
                <CardContent>
                  <CategorySpendBar entries={data.categoryBreakdown} currency={data.currency} />
                </CardContent>
              </Card>
            </MotionCard>
            <MotionCard>
              <PositiveHabitsCard output={engineOutput} />
            </MotionCard>
            <MotionCard>
              <RiskAlertsCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
            </MotionCard>
            <MotionCard>
              <ScoreBreakdownCard output={engineOutput} isPremium={isPremium} upgradeUrl={upgradeUrl} />
            </MotionCard>
          </StaggerSection>
        </section>
      ) : null}
    </div>
  );
}
