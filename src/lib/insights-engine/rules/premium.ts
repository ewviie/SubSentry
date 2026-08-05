import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { formatCents } from "@/lib/subscriptions/money";
import type { Subscription } from "@/lib/db/schema";
import type { EngineContext, InsightRule } from "../types";
import { monthlyTotalCents, findDuplicates, categoryConcentration, findRenewalCluster, findExpensiveOutliers, recentGrowthCount } from "../signals";

// Conservative, clearly-labeled assumption (not a real per-provider
// discount, which this app has no way to know) — every string this
// generates says "estimated"/"could" rather than asserting a fact, the same
// honesty convention the rest of the app follows for anything it can't
// verify (see analytics.ts's comment on why growth is a real proxy, not a
// guess).
const ASSUMED_ANNUAL_PLAN_DISCOUNT = 0.15;

// "AI Spending Coach": deterministic, structured suggestions — the actual
// LLM prose layer already exists (src/lib/ai/provider.ts's
// narrateInsights), this rule produces the structured finding that layer
// would narrate, same split insights.ts already establishes between
// deterministic detection and optional prose.
const annualSwitchSavings: InsightRule = {
  id: "premium.annual_switch_savings",
  name: "AI Spending Coach: annual plan savings",
  description: "Estimated savings if monthly subscriptions had an annual-plan equivalent, using a conservative assumed discount.",
  severity: "info",
  category: "optimization",
  premium: true,
  evaluate(ctx: EngineContext) {
    const monthlySubs = ctx.active.filter((s) => s.billingCycle === "monthly");
    if (monthlySubs.length === 0) return null;
    const totalAnnualCents = monthlySubs.reduce((sum, s) => sum + s.amountCents * 12, 0);
    const estimatedSavingsCents = Math.round(totalAnnualCents * ASSUMED_ANNUAL_PLAN_DISCOUNT);
    if (estimatedSavingsCents < 500) return null;
    return {
      ruleId: this.id,
      title: "You could save by switching to annual plans",
      description: `If providers that bill you monthly offer an annual plan at a typical discount, switching could save an estimated ${formatCents(estimatedSavingsCents)}/year.`,
      severity: "info",
      category: "optimization",
      premium: true,
      subscriptionIds: monthlySubs.map((s) => s.id),
      monthlySavingsCents: Math.round(estimatedSavingsCents / 12),
    };
  },
};

const functionalOverlap: InsightRule = {
  id: "premium.functional_overlap",
  name: "AI Spending Coach: functional overlap",
  description: "3+ active subscriptions in the same category — a stricter, count-based signal than the free concentration check.",
  severity: "info",
  category: "optimization",
  premium: true,
  evaluate(ctx: EngineContext) {
    const byCategory = new Map<Subscription["category"], Subscription[]>();
    for (const s of ctx.active) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
    const [category, subs] = Array.from(byCategory.entries()).sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    if (!category || subs.length < 3) return null;
    return {
      ruleId: this.id,
      title: `${subs.length} subscriptions overlap in ${CATEGORY_LABELS[category].toLowerCase()}`,
      description: `${subs.map((s) => s.name).join(", ")} all serve a similar purpose — worth checking if you need all of them.`,
      severity: "info",
      category: "optimization",
      premium: true,
      subscriptionIds: subs.map((s) => s.id),
    };
  },
};

function riskResult(rule: InsightRule, title: string, description: string, severity: "warning" | "critical", subscriptionIds: string[]) {
  return {
    ruleId: rule.id,
    title,
    description,
    severity,
    category: "usage" as const,
    premium: true,
    subscriptionIds,
  };
}

const riskHighConcentration: InsightRule = {
  id: "premium.risk_high_spend_concentration",
  name: "Risk: spend concentrated in a few subscriptions",
  description: "Expensive-outlier subscriptions making up most of total annual spend.",
  severity: "critical",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const outliers = findExpensiveOutliers(ctx.active);
    if (outliers.length === 0) return null;
    const totalAnnual = ctx.active.reduce((sum, s) => sum + s.amountCents * (s.billingCycle === "monthly" ? 12 : s.billingCycle === "yearly" ? 1 : s.billingCycle === "quarterly" ? 4 : 52), 0);
    const outlierAnnual = outliers.reduce((sum, o) => sum + o.annualCents, 0);
    if (totalAnnual === 0 || outlierAnnual / totalAnnual < 0.5) return null;
    return riskResult(
      riskHighConcentration,
      "Spend is concentrated in a few expensive subscriptions",
      `${outliers.map((o) => o.subscription.name).join(", ")} account for over half your annual spend.`,
      "critical",
      outliers.map((o) => o.subscription.id),
    );
  },
};

const riskRenewalCluster: InsightRule = {
  id: "premium.risk_renewal_cluster",
  name: "Risk: many renewals in a short period",
  description: "4+ renewals landing within the same 7-day window.",
  severity: "critical",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const cluster = findRenewalCluster(ctx.active, ctx.todayIso);
    if (!cluster || cluster.subscriptionIds.length < 4) return null;
    return riskResult(
      riskRenewalCluster,
      `${cluster.subscriptionIds.length} renewals due the same week`,
      `Starting ${cluster.windowStartIso}, ${formatCents(cluster.totalCents)} is due within 7 days — a real cash-flow crunch risk.`,
      "critical",
      cluster.subscriptionIds,
    );
  },
};

const riskRapidGrowth: InsightRule = {
  id: "premium.risk_rapid_growth",
  name: "Risk: rapidly increasing subscription count",
  description: "5+ new subscriptions added in the last 30 days.",
  severity: "critical",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const added = recentGrowthCount(ctx.active, ctx.todayIso);
    if (added < 5) return null;
    return riskResult(
      riskRapidGrowth,
      "Subscription count is growing rapidly",
      `${added} subscriptions added in the last 30 days — review before recurring cost compounds further.`,
      "critical",
      [],
    );
  },
};

const riskCategoryConcentration: InsightRule = {
  id: "premium.risk_category_concentration",
  name: "Risk: heavy concentration in one category",
  description: "A single category making up 60%+ of monthly spend.",
  severity: "critical",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const c = categoryConcentration(ctx.active);
    if (!c || c.share < 0.6) return null;
    return riskResult(
      riskCategoryConcentration,
      `${CATEGORY_LABELS[c.category]} dominates your spend`,
      `${Math.round(c.share * 100)}% of monthly spend is in ${CATEGORY_LABELS[c.category].toLowerCase()} alone.`,
      "critical",
      c.subscriptionIds,
    );
  },
};

const riskExpensiveDuplicate: InsightRule = {
  id: "premium.risk_expensive_duplicate",
  name: "Risk: expensive likely-unused subscription",
  description: "A duplicate whose redundant cost alone is a large share of total monthly spend.",
  severity: "critical",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const total = monthlyTotalCents(ctx.active);
    if (total === 0) return null;
    const expensive = findDuplicates(ctx.active).find((p) => p.monthlySavingsCents / total >= 0.2);
    if (!expensive) return null;
    return riskResult(
      riskExpensiveDuplicate,
      `${expensive.redundant.name} is an expensive, likely-unused subscription`,
      `Its ${formatCents(expensive.monthlySavingsCents)}/mo alone is over 20% of your total monthly spend.`,
      "critical",
      [expensive.redundant.id],
    );
  },
};

export const PREMIUM_RULES: InsightRule[] = [
  annualSwitchSavings,
  functionalOverlap,
  riskHighConcentration,
  riskRenewalCluster,
  riskRapidGrowth,
  riskCategoryConcentration,
  riskExpensiveDuplicate,
];
