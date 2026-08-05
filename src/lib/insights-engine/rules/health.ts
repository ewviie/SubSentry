import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { formatCents } from "@/lib/subscriptions/money";
import type { EngineContext, InsightRule } from "../types";
import {
  monthlyTotalCents,
  findDuplicates,
  categoryConcentration,
  findRenewalCluster,
  findExpensiveOutliers,
  longRunningSubscriptions,
  billingCycleCounts,
  recentGrowthCount,
  upcomingRenewalTotalCents,
  canceledCount,
} from "../signals";

// Every rule here is category:"health" and always returns a result when it
// has an opinion (bonus OR penalty) — the health score is the sum of every
// fired rule's `scoreImpact`, so "no hard-coded checks" holds literally:
// health-score.ts never special-cases any of this, it just sums whatever
// these rules return. Weights are hand-tuned but centralized here, one rule
// = one line item in the "How your score was calculated" breakdown.

const duplicates: InsightRule = {
  id: "health.duplicates",
  name: "Duplicate or likely-unused subscriptions",
  description: "Penalizes near-identical subscription names — the same signal /savings uses to flag a likely-redundant subscription.",
  severity: "warning",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const pairs = findDuplicates(ctx.active);
    if (pairs.length === 0) {
      return {
        ruleId: this.id,
        title: "No duplicate subscriptions",
        description: "Nothing looks redundant — you're not paying twice for the same thing.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        scoreImpact: 4,
      };
    }
    const ids = pairs.flatMap((p) => [p.keep.id, p.redundant.id]);
    return {
      ruleId: this.id,
      title: pairs.length === 1 ? "1 likely duplicate subscription" : `${pairs.length} likely duplicate subscriptions`,
      description: pairs.map((p) => `${p.keep.name} and ${p.redundant.name}`).join("; "),
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: ids,
      scoreImpact: -Math.min(pairs.length * 8, 24),
      monthlySavingsCents: pairs.reduce((sum, p) => sum + p.monthlySavingsCents, 0),
    };
  },
};

const concentration: InsightRule = {
  id: "health.concentration",
  name: "Spending concentration",
  description: "One category eating an outsized share of monthly spend.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const c = categoryConcentration(ctx.active);
    if (!c) return null; // zero spend or only one category — "balanced" doesn't apply, no opinion
    if (c.share < 0.4) {
      return {
        ruleId: this.id,
        title: "Balanced spending across categories",
        description: "No single category dominates your monthly spend.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        scoreImpact: 5,
      };
    }
    return {
      ruleId: this.id,
      title: `${CATEGORY_LABELS[c.category]} is concentrated`,
      description: `${CATEGORY_LABELS[c.category]} makes up ${Math.round(c.share * 100)}% of your monthly spend.`,
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: c.subscriptionIds,
      scoreImpact: -6,
    };
  },
};

const outliers: InsightRule = {
  id: "health.expensive_outliers",
  name: "Expensive subscriptions",
  description: "Subscriptions costing at least 2x the group's mean annual cost.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const found = findExpensiveOutliers(ctx.active);
    if (found.length === 0) return null;
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 outsized subscription" : `${found.length} outsized subscriptions`,
      description: found.map((o) => `${o.subscription.name} (${formatCents(o.annualCents)}/yr)`).join(", "),
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: found.map((o) => o.subscription.id),
      scoreImpact: -Math.min(found.length * 3, 6),
    };
  },
};

const renewalClustering: InsightRule = {
  id: "health.renewal_clustering",
  name: "Renewal clustering",
  description: "Several renewals landing within the same 7-day window.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const cluster = findRenewalCluster(ctx.active, ctx.todayIso);
    if (!cluster) {
      if (ctx.active.length < 3) return null;
      return {
        ruleId: this.id,
        title: "Renewals are well spread out",
        description: "No week has several bills landing at once.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        scoreImpact: 3,
      };
    }
    return {
      ruleId: this.id,
      title: `${cluster.subscriptionIds.length} renewals land the same week`,
      description: `Starting ${cluster.windowStartIso}, ${formatCents(cluster.totalCents)} is due within 7 days.`,
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: cluster.subscriptionIds,
      scoreImpact: -5,
    };
  },
};

const billingMix: InsightRule = {
  id: "health.billing_mix",
  name: "Monthly vs annual billing mix",
  description: "Whether any spend is captured on annual/quarterly plans, which typically discount vs. paying monthly.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    if (ctx.active.length < 3) return null;
    const counts = billingCycleCounts(ctx.active);
    const hasLongerCycle = counts.yearly > 0 || counts.quarterly > 0;
    return hasLongerCycle
      ? {
          ruleId: this.id,
          title: "Using annual or quarterly billing where available",
          description: "At least one subscription is on a longer billing cycle, which typically costs less than paying monthly.",
          severity: "positive",
          category: "health",
          premium: false,
          subscriptionIds: [],
          scoreImpact: 3,
        }
      : {
          ruleId: this.id,
          title: "No subscriptions use annual or quarterly billing",
          description: "None of your subscriptions use an annual or quarterly plan — those often cost less over a year.",
          severity: "info",
          category: "health",
          premium: false,
          subscriptionIds: [],
          scoreImpact: -3,
        };
  },
};

const subscriptionCount: InsightRule = {
  id: "health.subscription_count",
  name: "Subscription count",
  description: "A high active count is harder to track and audit for redundancy.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    if (ctx.active.length <= 15) return null;
    return {
      ruleId: this.id,
      title: `${ctx.active.length} active subscriptions is a lot to track`,
      description: "Worth a periodic audit — more subscriptions means more surface area for duplicates and forgotten renewals.",
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: [],
      scoreImpact: -3,
    };
  },
};

const canceledHistory: InsightRule = {
  id: "health.canceled_history",
  name: "Canceled subscription history",
  description: "Having actually canceled things you no longer use is a positive habit, not a neutral fact.",
  severity: "positive",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const count = canceledCount(ctx.subscriptions);
    if (count === 0) return null;
    return {
      ruleId: this.id,
      title: `${count} subscription${count === 1 ? "" : "s"} canceled when no longer needed`,
      description: "You're actively pruning subscriptions you don't use.",
      severity: "positive",
      category: "health",
      premium: false,
      subscriptionIds: [],
      scoreImpact: Math.min(count * 2, 6),
    };
  },
};

const longRunning: InsightRule = {
  id: "health.long_running",
  name: "Long-running subscriptions",
  description: "Stable, year-plus subscriptions are a sign of deliberate spend, not runaway growth.",
  severity: "positive",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const found = longRunningSubscriptions(ctx.active, ctx.todayIso);
    if (found.length === 0) return null;
    return {
      ruleId: this.id,
      title: `${found.length} long-standing subscription${found.length === 1 ? "" : "s"}`,
      description: "You have subscriptions you've kept for over a year — stable, deliberate spend.",
      severity: "positive",
      category: "health",
      premium: false,
      subscriptionIds: found.map((s) => s.id),
      scoreImpact: 2,
    };
  },
};

const recentGrowth: InsightRule = {
  id: "health.recent_growth",
  name: "Recent subscription growth",
  description: "A burst of new subscriptions in the last 30 days, before it compounds into forgotten renewals.",
  severity: "warning",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const added = recentGrowthCount(ctx.active, ctx.todayIso);
    if (added < 3) return null;
    return {
      ruleId: this.id,
      title: `${added} new subscriptions in the last 30 days`,
      description: "Subscription count is growing quickly — worth reviewing before it compounds.",
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: [],
      scoreImpact: -4,
    };
  },
};

const renewalSpike: InsightRule = {
  id: "health.renewal_spike",
  name: "Upcoming renewal spike",
  description: "Total due in the next 30 days vs. a typical month's spend.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const monthly = monthlyTotalCents(ctx.active);
    if (monthly === 0) return null;
    const upcoming = upcomingRenewalTotalCents(ctx.active, ctx.todayIso);
    if (upcoming <= monthly * 1.5) return null;
    return {
      ruleId: this.id,
      title: "Large renewal spike in the next 30 days",
      description: `${formatCents(upcoming)} is due in the next 30 days, well above your typical monthly spend.`,
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: [],
      scoreImpact: -4,
    };
  },
};

export const HEALTH_RULES: InsightRule[] = [
  duplicates,
  concentration,
  outliers,
  renewalClustering,
  billingMix,
  subscriptionCount,
  canceledHistory,
  longRunning,
  recentGrowth,
  renewalSpike,
];
