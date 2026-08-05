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
import { monthlyTotalCents, recentGrowthCount } from "./signals";

export type { EngineContext, InsightResult, HealthScoreResult, InsightRule, HealthBreakdownEntry, HealthRating } from "./types";

export interface RenewalForecast {
  nextRenewal: { subscriptionId: string; name: string; date: string; cents: number } | null;
  totalDueNext30DaysCents: number;
  busiestPeriod: { monthLabel: string; totalCents: number } | null;
  largestUpcomingPayment: { subscriptionId: string; name: string; monthLabel: string; cents: number } | null;
}

export interface EngineStats {
  totalMonthlyCents: number;
  totalYearlyCents: number;
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
    ? { subscriptionId: upcoming[0].id, name: upcoming[0].name, date: upcoming[0].nextRenewalDate, cents: upcoming[0].amountCents }
    : null;

  const in30 = new Date(new Date(`${today}T00:00:00Z`).getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const totalDueNext30DaysCents = upcoming.filter((s) => s.nextRenewalDate <= in30).reduce((sum, s) => sum + s.amountCents, 0);

  const timeline = computeRenewalsTimeline(active, new Date(`${today}T00:00:00Z`));
  const busiestMonth = timeline.reduce((max, m) => (m.totalCents > (max?.totalCents ?? 0) ? m : max), timeline[0] ?? null);
  const busiestPeriod = busiestMonth && busiestMonth.totalCents > 0 ? { monthLabel: busiestMonth.monthLabel, totalCents: busiestMonth.totalCents } : null;

  const largest = [...upcoming].sort((a, b) => b.amountCents - a.amountCents)[0];
  const largestUpcomingPayment = largest
    ? {
        subscriptionId: largest.id,
        name: largest.name,
        monthLabel: timeline.find((m) => m.monthIso === largest.nextRenewalDate.slice(0, 7))?.monthLabel ?? busiestMonth?.monthLabel ?? "",
        cents: largest.amountCents,
      }
    : null;

  return { nextRenewal, totalDueNext30DaysCents, busiestPeriod, largestUpcomingPayment };
}

export function runInsightsEngine(subscriptions: Subscription[], isPremium: boolean): EngineOutput {
  const active = subscriptions.filter((s) => s.status === "active");
  const today = todayIso();
  const ctx: EngineContext = { subscriptions, active, todayIso: today, isPremium };

  const nonHealthRules = [...FREE_RULES, ...(isPremium ? PREMIUM_RULES : [])];
  const results = nonHealthRules
    .map((rule) => rule.evaluate(ctx))
    .filter((r): r is InsightResult => r !== null);

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

  const savingsRecommendations = computeSavingsRecommendations(subscriptions);
  const monthlySavingsCents = computeTotalPotentialSavingsMonthlyCents(savingsRecommendations);

  const healthScore = computeHealthScore(ctx);
  const optimizationScore = computeOptimizationScore(ctx, monthlySavingsCents * 12);

  const totalMonthlyCents = monthlyTotalCents(active);
  const longest = active.length > 0 ? [...active].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] : null;

  return {
    healthScore,
    optimizationScore,
    stats: {
      totalMonthlyCents,
      totalYearlyCents: totalMonthlyCents * 12,
      activeCount: active.length,
      newSubscriptionsThisMonth: recentGrowthCount(active, today, 30),
      longestRunning: longest
        ? { subscriptionId: longest.id, name: longest.name, createdAt: longest.createdAt.toISOString().slice(0, 10) }
        : null,
      spendBySource: computeSpendBySource(subscriptions),
      billingCycles: computeSpendByBillingCycle(subscriptions),
      topMerchants: computeTopMerchantsBySpend(subscriptions),
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
