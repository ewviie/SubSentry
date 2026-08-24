import type { Subscription } from "@/lib/db/schema";
import {
  computeSpendBySource,
  computeSpendByBillingCycle,
  computeRenewalsTimeline,
  computeTopMerchantsBySpend,
  type SpendBySourceEntry,
  type BillingCycleEntry,
  type TopMerchantEntry,
} from "@/lib/subscriptions/analytics";
import { computeSavingsRecommendations, computeTotalPotentialSavingsMonthlyCents, type SavingsRecommendation } from "@/lib/subscriptions/savings";
import type { EngineContext, HealthScoreResult, InsightResult } from "./types";
import { HEALTH_RULES } from "./rules/health";
import { FREE_RULES } from "./rules/free";
import { PREMIUM_RULES } from "./rules/premium";
import { computeHealthScore } from "./health-score";
import { computeOptimizationScore } from "./optimization-score";
import { monthlyTotalCents, annualTotalCents, recentGrowthCount } from "./signals";
import { splitByPrimaryCurrency } from "@/lib/subscriptions/money";

export type { EngineContext, InsightResult, HealthScoreResult, InsightRule, HealthBreakdownEntry, HealthRating } from "./types";

export interface RenewalForecast {
  // nextRenewal/largestUpcomingPayment are single-item picks across ALL
  // active subscriptions regardless of currency (not sums), each carrying
  // its own subscription's real currency — comparing "biggest payment" by
  // raw cents across different currencies is still a face-value comparison
  // (not a true-value one, since this app has no exchange rates), a known,
  // documented limitation rather than a fixed one this pass.
  nextRenewal: { subscriptionId: string; name: string; date: string; cents: number; currency: string } | null;
  // totalDueNext30DaysCents/busiestPeriod ARE sums across multiple
  // subscriptions, so — unlike the two picks above — they're restricted to
  // `currency` (active's primary currency, via splitByPrimaryCurrency) to
  // avoid combining raw cents from different currencies into one figure.
  totalDueNext30DaysCents: number;
  busiestPeriod: { monthLabel: string; totalCents: number } | null;
  largestUpcomingPayment: { subscriptionId: string; name: string; monthLabel: string; cents: number; currency: string } | null;
  // The currency totalDueNext30DaysCents/busiestPeriod are denominated in;
  // null only when there are no active subscriptions at all.
  currency: string | null;
}

export interface EngineStats {
  // totalMonthlyCents/totalYearlyCents/topMerchants are restricted to
  // `currency` (active's primary currency, via splitByPrimaryCurrency) —
  // summing raw cents across different currencies into one figure would be
  // fabricated math, the same rule getDashboardData (queries.ts) already
  // follows for the dashboard's own headline numbers. otherCurrencyActiveCount
  // is how many active subscriptions this excludes, so a consumer can
  // disclose the gap rather than let the total look complete when it isn't.
  totalMonthlyCents: number;
  totalYearlyCents: number;
  currency: string | null;
  otherCurrencyActiveCount: number;
  activeCount: number;
  newSubscriptionsThisMonth: number;
  longestRunning: { subscriptionId: string; name: string; createdAt: string } | null;
  spendBySource: SpendBySourceEntry[];
  billingCycles: BillingCycleEntry[];
  topMerchants: TopMerchantEntry[];
}

export interface EngineOutput {
  healthScore: HealthScoreResult | null;
  optimizationScore: { score: number; unrealizedYearlySavingsCents: number } | null;
  stats: EngineStats;
  renewalForecast: RenewalForecast;
  positive: InsightResult[];
  warnings: InsightResult[];
  optimization: InsightResult[];
  quickWins: InsightResult[];
  premiumInsights: InsightResult[];
  savingsForecast: {
    recommendations: SavingsRecommendation[];
    monthlySavingsCents: number;
    yearlySavingsCents: number;
  };
  estimatedYearlySavingsCents: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildRenewalForecast(active: Subscription[], today: string): RenewalForecast {
  const upcoming = active.filter((s) => s.nextRenewalDate >= today).sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate));
  const nextRenewal = upcoming[0]
    ? { subscriptionId: upcoming[0].id, name: upcoming[0].name, date: upcoming[0].nextRenewalDate, cents: upcoming[0].amountCents, currency: upcoming[0].currency }
    : null;

  // Sums below are restricted to active's primary currency — see this
  // interface's own field comments.
  const { currency, included: primaryActive } = splitByPrimaryCurrency(active);
  const primaryUpcoming = upcoming.filter((s) => s.currency === currency);

  const in30 = new Date(new Date(`${today}T00:00:00Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const totalDueNext30DaysCents = primaryUpcoming.filter((s) => s.nextRenewalDate <= in30).reduce((sum, s) => sum + s.amountCents, 0);

  const timeline = computeRenewalsTimeline(primaryActive, new Date(`${today}T00:00:00Z`));
  const busiestMonth = timeline.reduce((max, m) => (m.totalCents > (max?.totalCents ?? 0) ? m : max), timeline[0] ?? null);
  const busiestPeriod = busiestMonth && busiestMonth.totalCents > 0 ? { monthLabel: busiestMonth.monthLabel, totalCents: busiestMonth.totalCents } : null;

  const largest = [...upcoming].sort((a, b) => b.amountCents - a.amountCents)[0];
  const largestUpcomingPayment = largest
    ? {
        subscriptionId: largest.id,
        name: largest.name,
        monthLabel: timeline.find((m) => m.monthIso === largest.nextRenewalDate.slice(0, 7))?.monthLabel ?? busiestMonth?.monthLabel ?? "",
        cents: largest.amountCents,
        currency: largest.currency,
      }
    : null;

  return { nextRenewal, totalDueNext30DaysCents, busiestPeriod, largestUpcomingPayment, currency };
}

export function runInsightsEngine(subscriptions: Subscription[], isPremium: boolean): EngineOutput {
  const active = subscriptions.filter((s) => s.status === "active");
  const today = todayIso();
  const ctx: EngineContext = { subscriptions, active, todayIso: today, isPremium };

  // HEALTH_RULES are also evaluated independently by computeHealthScore()
  // below (for its own score/breakdown) — evaluating them a second time
  // here, rather than threading their results through, keeps this a pure
  // additive change with zero risk to computeHealthScore's existing
  // behavior/tests. Both evaluations are cheap, pure functions over a
  // handful of rule objects; the duplication costs nothing measurable.
  //
  // Before this, HEALTH_RULES' own findings (e.g. "3 renewals land the
  // same week", "No duplicate subscriptions") only ever fed the health
  // score's numeric breakdown — the individual title/description/
  // subscriptionIds were computed and then discarded, never reaching
  // `results` at all. That meant `positive` and the warning half of
  // `quickWins` below were provably always empty: FREE_RULES only ever
  // returns severity "info", and PREMIUM_RULES results are all
  // `premium: true` (filtered out by quickWins' `!r.premium`), so neither
  // QuickWinsCard nor PositiveHabitsCard could ever render, for any user,
  // under any data — confirmed by the fact that no existing test asserted
  // either array was ever non-empty. health.duplicates' *warning* branch is
  // excluded here specifically: it's already given a fuller, more
  // actionable treatment by Savings opportunities (savingsForecast below),
  // and including it here too would reproduce the exact "same finding
  // rendered twice on one page" bug dashboard/page.tsx's own comment
  // already documents fixing once for possible_overlap. Its *positive*
  // branch ("No duplicate subscriptions") stays in, deliberately — Savings
  // opportunities only ever renders when there's something to flag
  // (savingsForecast.recommendations.length > 0), so it's silent in
  // exactly the case that branch fires, meaning there was never a
  // collision to avoid for it. Filtering out the whole rule by ruleId
  // alone would silently drop that positive finding too, leaving a real
  // gap: computeHealthScore (health-score.ts) still credits it in the
  // score breakdown, but no card would ever say why.
  const healthResults = HEALTH_RULES.map((rule) => rule.evaluate(ctx)).filter(
    (r): r is InsightResult => r !== null && !(r.ruleId === "health.duplicates" && r.severity === "warning"),
  );

  const nonHealthRules = [...FREE_RULES, ...(isPremium ? PREMIUM_RULES : [])];
  const results = [
    ...nonHealthRules.map((rule) => rule.evaluate(ctx)).filter((r): r is InsightResult => r !== null),
    ...healthResults,
  ];

  const positive = results.filter((r) => r.severity === "positive");
  const warnings = results.filter((r) => r.severity === "warning" || r.severity === "critical");
  const optimization = results.filter((r) => r.category === "optimization");
  const premiumInsights = results.filter((r) => r.premium);

  // Quick wins: the most actionable free findings, ranked by real dollar
  // impact first (an unrealized saving beats an informational note), then
  // by how much the health score is affected.
  const freeActionable = results.filter((r) => !r.premium && (r.severity === "warning" || r.severity === "critical"));
  const quickWins = [...freeActionable]
    .sort(
      (a, b) =>
        (b.monthlySavingsCents ?? 0) - (a.monthlySavingsCents ?? 0) ||
        Math.abs(b.scoreImpact ?? 0) - Math.abs(a.scoreImpact ?? 0),
    )
    .slice(0, 3);

  const savingsRecommendations = computeSavingsRecommendations(subscriptions, today);
  const monthlySavingsCents = computeTotalPotentialSavingsMonthlyCents(savingsRecommendations);

  // The score's own job is "unrealized savings as a share of spend" — that's
  // strictly broader than "confirmed duplicates," so it needs every
  // optimization-category rule's dollar figure folded in (currently just
  // premium.annual_switch_savings), not only the duplicate-detection total.
  // These don't double-count the same fix: canceling a duplicate and moving
  // the survivor to an annual plan are two independent actions a user could
  // take on the same subscription, so summing them is the real combined
  // opportunity, not an inflated one. `savingsForecast` below stays scoped
  // to confirmed duplicates on purpose — that card's whole promise is "never
  // a guessed percentage," and folding in an estimate would break that.
  const optimizationRuleSavingsCents = optimization.reduce((sum, r) => sum + (r.monthlySavingsCents ?? 0), 0);
  const totalUnrealizedMonthlyCents = monthlySavingsCents + optimizationRuleSavingsCents;

  const healthScore = computeHealthScore(ctx);
  const optimizationScore = computeOptimizationScore(ctx, totalUnrealizedMonthlyCents * 12);

  // Restricted to active's primary currency (splitByPrimaryCurrency) — see
  // EngineStats' own field comment.
  const { currency: primaryCurrency, included: primaryActive, excluded: otherCurrencyActive } = splitByPrimaryCurrency(active);
  const totalMonthlyCents = monthlyTotalCents(primaryActive);
  const longest = active.length > 0 ? [...active].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] : null;

  return {
    healthScore,
    optimizationScore,
    stats: {
      totalMonthlyCents,
      // Not totalMonthlyCents * 12 — see money.ts's own annualCents comment
      // (and signals.ts's annualTotalCents, which sums each subscription's
      // exact annual figure directly rather than scaling an already-rounded
      // monthly total).
      totalYearlyCents: annualTotalCents(primaryActive),
      currency: primaryCurrency,
      otherCurrencyActiveCount: otherCurrencyActive.length,
      activeCount: active.length,
      newSubscriptionsThisMonth: recentGrowthCount(active, today, 30),
      longestRunning: longest
        ? { subscriptionId: longest.id, name: longest.name, createdAt: longest.createdAt.toISOString().slice(0, 10) }
        : null,
      spendBySource: computeSpendBySource(subscriptions),
      billingCycles: computeSpendByBillingCycle(subscriptions),
      // Restricted to primary-currency active subscriptions so this list's
      // [0] entry (computeBiggestOpportunity's fallback) is guaranteed the
      // same currency as totalYearlyCents above — the two are combined into
      // a "% of total annual spend" figure that would otherwise divide one
      // currency's number by a sum of several. The Analytics page's own
      // "Top merchants" list calls computeTopMerchantsBySpend directly with
      // the full subscription list instead (see analytics/page.tsx) — a
      // per-row list, not a sum, so it correctly still shows every
      // currency's merchants.
      topMerchants: computeTopMerchantsBySpend(primaryActive),
    },
    renewalForecast: buildRenewalForecast(active, today),
    positive,
    warnings,
    optimization,
    quickWins,
    premiumInsights,
    savingsForecast: {
      recommendations: savingsRecommendations,
      monthlySavingsCents,
      yearlySavingsCents: monthlySavingsCents * 12,
    },
    estimatedYearlySavingsCents: monthlySavingsCents * 12,
  };
}

export { HEALTH_RULES, FREE_RULES, PREMIUM_RULES };
