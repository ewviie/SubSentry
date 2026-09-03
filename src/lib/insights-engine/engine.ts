import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";
import {
  computeSpendBySource,
  computeSpendByBillingCycle,
  computeRenewalsTimeline,
  computeTopMerchantsBySpend,
  type SpendBySourceEntry,
  type BillingCycleEntry,
  type TopMerchantEntry,
} from "@/lib/subscriptions/analytics";
import {
  computeSavingsRecommendations,
  computeTotalPotentialSavingsMonthlyCents,
  computeTotalPotentialSavingsYearlyCents,
  type SavingsRecommendation,
} from "@/lib/subscriptions/savings";
import type { EngineContext, HealthScoreResult, InsightResult } from "./types";
import { HEALTH_RULES } from "./rules/health";
import { FREE_RULES } from "./rules/free";
import { PREMIUM_RULES } from "./rules/premium";
import { computeHealthScore } from "./health-score";
import { computeOptimizationScore } from "./optimization-score";
import { monthlyTotalCents, annualTotalCents, recentGrowthCount } from "./signals";
import { splitByPrimaryCurrency } from "@/lib/subscriptions/money";

export type {
  EngineContext,
  InsightResult,
  HealthScoreResult,
  InsightRule,
  HealthBreakdownEntry,
  HealthRating,
  HealthDimensionStatus,
  HealthDimensionResult,
} from "./types";

// A consumer that wants to render more than one of this module's own output
// buckets together (e.g. a subscription detail page's "What SubSentry
// noticed" list, which wants every positive/warning/premium finding that
// mentions this one subscription) cannot safely `[...a, ...b, ...c]`
// concatenate them directly: severity and the premium flag are independent
// axes on an InsightResult, not mutually exclusive categories. `warnings`
// (severity "warning" | "critical") and `premiumInsights` (premium: true)
// in particular overlap for real, shipped rules — every one of
// rules/premium.ts's "risk_*" rules is both `critical` and `premium: true`
// — so a naive concatenation includes the exact same InsightResult object
// twice, which is what produced a real React "two children with the same
// key" crash on the subscription detail page (premium.risk_high_spend_
// concentration, but any risk_* rule can trigger the same bug for a
// premium user). `positive` (severity "positive") never overlaps with the
// other two — no rule in this codebase is both positive and premium/
// warning/critical — so this only ever needs to drop true duplicates, not
// reconcile two independently-computed findings that happen to share a
// ruleId.
//
// Keeps the FIRST occurrence encountered across the provided arrays, in
// call order. Every duplicate this function will ever see is the literal
// same object reference (not two separately-evaluated results that happen
// to coincide), since every one of this engine's output arrays is built by
// `.filter()`-ing the same single `results` array HEALTH_RULES/FREE_RULES/
// PREMIUM_RULES were each evaluated into exactly once — `.filter` never
// clones elements. So "first wins" never discards different information;
// it only ever removes an identical copy. See engine.test.ts for the
// reproduction this was built against.
export function mergeInsightResults(...resultArrays: InsightResult[][]): InsightResult[] {
  const seenRuleIds = new Set<string>();
  const merged: InsightResult[] = [];
  for (const results of resultArrays) {
    for (const result of results) {
      if (seenRuleIds.has(result.ruleId)) continue;
      seenRuleIds.add(result.ruleId);
      merged.push(result);
    }
  }
  return merged;
}

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
  // Product-language pass: the "Unrealized savings" card used to fold this
  // straight into optimizationScore.unrealizedYearlySavingsCents with no way
  // for a consumer to show it separately from the confirmed-duplicates
  // figure (savingsForecast.yearlySavingsCents) — one combined number
  // wearing the confidence of its most certain half. Exposed here so the UI
  // can show "confirmed" and "estimated" as two distinct figures instead of
  // one. Same monthlySavingsCents-then-*12 basis optimizationScore already
  // uses for this same rule set (see the comment on totalUnrealizedMonthlyCents
  // below) — deliberately not re-derived a different way, so this number and
  // the "estimated" half of unrealizedYearlySavingsCents can never quietly
  // disagree.
  estimatedOptimizationYearlyCents: number;
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

export function runInsightsEngine(
  subscriptions: Subscription[],
  isPremium: boolean,
  priceHistoryBySubscriptionId?: Map<string, SubscriptionPriceHistory[]>,
  dismissedRecommendationIds?: Set<string>,
): EngineOutput {
  const active = subscriptions.filter((s) => s.status === "active");
  const today = todayIso();
  const ctx: EngineContext = { subscriptions, active, todayIso: today, isPremium, priceHistoryBySubscriptionId, dismissedRecommendationIds };

  // Evaluated once, here, and threaded into computeHealthScore below via
  // its precomputedHealthResults parameter — not re-evaluated a second
  // time inside it (release-review finding #8: this used to run the full
  // HEALTH_RULES set, including its O(n^2) duplicate/overlap passes,
  // twice per request via two independently-maintained call sites, which
  // also meant a future edit to one exclusion filter without the other
  // could make the health-score breakdown and the displayed insights list
  // silently disagree on which findings apply).
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
  // branch ("No duplicate subscriptions") stays in `healthResults`/`results`
  // deliberately — computeHealthScore (health-score.ts) still needs it
  // credited in the score breakdown regardless of which card, if any, also
  // shows it. See the `positive` filter below for the one place this
  // branch IS excluded from a UI-facing array, and why.
  const allHealthResults = HEALTH_RULES.map((rule) => rule.evaluate(ctx)).filter(
    (r): r is InsightResult => r !== null,
  );
  const healthResults = allHealthResults.filter(
    (r) => !(r.ruleId === "health.duplicates" && r.severity === "warning"),
  );

  const nonHealthRules = [...FREE_RULES, ...(isPremium ? PREMIUM_RULES : [])];
  const results = [
    ...nonHealthRules.map((rule) => rule.evaluate(ctx)).filter((r): r is InsightResult => r !== null),
    ...healthResults,
  ];

  // health.duplicates' positive branch is excluded here specifically (UI
  // audit finding, not the same collision the healthResults filter above
  // already handles): its title/description ("No confirmed duplicates" /
  // "Nothing looks redundant, you're not paying twice for the same thing.")
  // restates OverviewPanel's own "Duplicate check" callout on
  // dashboard/page.tsx near-verbatim ("Nothing here looks redundant.
  // You're not paying twice for the same thing."), which reads from this
  // same shared duplicate-pair detection (forEachLikelyDuplicatePair) and
  // is always rendered, more prominently, whenever this dashboard has any
  // active subscriptions at all. That earlier "there was never a collision
  // to avoid for it" reasoning only checked Savings opportunities (silent
  // exactly when this branch fires) — it didn't account for OverviewPanel,
  // which is the real, always-present collision. computeHealthScore still
  // credits this finding in the score breakdown regardless (it reads
  // `healthResults`, not `positive`), so nothing here changes what "Good"
  // status a clean redundancy dimension gets or why.
  const positive = results.filter((r) => r.severity === "positive" && r.ruleId !== "health.duplicates");
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
  // Not monthlySavingsCents * 12 — see computeTotalPotentialSavingsYearlyCents's
  // own comment (release-review finding #4) for why that double-rounds.
  const yearlySavingsCents = computeTotalPotentialSavingsYearlyCents(savingsRecommendations);

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

  const healthScore = computeHealthScore(ctx, allHealthResults);
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
      yearlySavingsCents,
    },
    estimatedYearlySavingsCents: yearlySavingsCents,
    estimatedOptimizationYearlyCents: optimizationRuleSavingsCents * 12,
  };
}

export { HEALTH_RULES, FREE_RULES, PREMIUM_RULES };
