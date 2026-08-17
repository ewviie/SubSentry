import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { formatCents } from "@/lib/subscriptions/money";
import type { EngineContext, InsightRule } from "../types";
import {
  monthlyTotalCents,
  findDuplicates,
  categoryConcentration,
  findRenewalCluster,
  findExpensiveOutliers,
  recentGrowthCount,
} from "../signals";

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
    // monthlySavingsCents is the one number the Optimization score (see
    // engine.ts) actually sums — the description below is derived from it
    // (monthlySavingsCents * 12), not from estimatedSavingsCents directly,
    // so the two can never quietly disagree by a few cents the way they did
    // before this was reconciled: round(x/12)*12 != x in general, and this
    // rule's own text is the one place that rounding was visible to a user.
    const monthlySavingsCents = Math.round(estimatedSavingsCents / 12);
    return {
      ruleId: this.id,
      title: "You could save by switching to annual plans",
      description: `If providers that bill you monthly offer an annual plan at a typical discount, switching could save an estimated ${formatCents(monthlySavingsCents * 12)}/year.`,
      severity: "info",
      category: "optimization",
      premium: true,
      subscriptionIds: monthlySubs.map((s) => s.id),
      monthlySavingsCents,
    };
  },
};

// A premium.functional_overlap rule used to live here, independently
// deriving "3+ subscriptions share a category" as a stricter, count-gated
// version of the free-tier concentration check. Removed rather than fixed
// in place: once category-equality-as-overlap was replaced (see
// lib/subscriptions/savings.ts's computeFunctionalOverlapGroups) with real
// functional-group evidence, the free-tier SavingsOpportunitiesCard already
// surfaces every genuine 2+ overlap accurately — a premium-only rule
// re-deriving the same evidence at an arbitrary "3+" threshold would either
// (a) silently duplicate a finding SavingsOpportunitiesCard already shows,
// reproducing the exact double-render problem an earlier phase already
// fixed for a different pair of cards, or (b) keep an arbitrary count gate
// with no evidence behind the specific number "3" — the kind of threshold
// this phase's audit was asked to remove, not relocate.

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

// Count alone ("4+ renewals the same week") used to be sufficient to claim
// "a real cash-flow crunch risk" — a manufactured alarm with no relation to
// whether the actual dollar amount is unusual. 4 renewals of $2 each is not
// a cash-flow risk; 2 renewals totaling $2,000 against a normal $200/mo
// baseline is. This now requires the same genuine-spike evidence as
// health.ts's renewal_risk rule (the clustered amount well above typical
// monthly spend) before using "critical"/risk language at all — clustering
// with no such evidence isn't surfaced by this rule (it's still visible,
// proportionally, via the free-tier renewal_risk health rule).
const riskRenewalCluster: InsightRule = {
  id: "premium.risk_renewal_cluster",
  name: "Risk: renewal cluster with an unusually large amount due",
  description: "A renewal cluster whose total is well above typical monthly spend — not clustering by count alone.",
  severity: "critical",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const cluster = findRenewalCluster(ctx.active, ctx.todayIso);
    if (!cluster || cluster.subscriptionIds.length < 4) return null;
    const monthly = monthlyTotalCents(ctx.active);
    if (monthly === 0 || cluster.totalCents <= monthly * 1.5) return null;
    return riskResult(
      riskRenewalCluster,
      `${cluster.subscriptionIds.length} renewals due the same week, well above typical spend`,
      `Starting ${cluster.windowStartIso}, ${formatCents(cluster.totalCents)} is due within 7 days — notably more than your typical month.`,
      "critical",
      cluster.subscriptionIds,
    );
  },
};

// This app only knows when a subscription row was *added to SubSentry*
// (createdAt), not when it actually started — a bulk CSV import of years of
// bank history adds all of them "in the last 30 days" by this measure. The
// old copy ("Subscription count is growing rapidly... before recurring
// cost compounds further") claimed a real spending-growth trend this data
// can't prove. Reworded to state only what's actually known, and dropped
// from "critical" to "warning" — a big batch of adds is worth a look, not
// alarm, especially since it's very plausibly just an import.
const riskRapidGrowth: InsightRule = {
  id: "premium.risk_rapid_growth",
  name: "A large batch of subscriptions added recently",
  description: "10+ subscriptions added to SubSentry in the last 30 days — reflects import/entry activity, not proven spending growth.",
  severity: "warning",
  category: "usage",
  premium: true,
  evaluate(ctx: EngineContext) {
    const added = recentGrowthCount(ctx.active, ctx.todayIso);
    if (added < 10) return null;
    return riskResult(
      riskRapidGrowth,
      `${added} subscriptions were added to SubSentry in the last 30 days`,
      "This reflects when they were added here, not necessarily when they actually started — worth a skim if that many are genuinely new.",
      "warning",
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
  riskHighConcentration,
  riskRenewalCluster,
  riskRapidGrowth,
  riskCategoryConcentration,
  riskExpensiveDuplicate,
];
