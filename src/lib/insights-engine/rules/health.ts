import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { formatCents } from "@/lib/subscriptions/money";
import type { EngineContext, InsightRule, HealthDimensionKey } from "../types";
import {
  monthlyTotalCents,
  findDuplicates,
  categoryConcentration,
  findRenewalCluster,
  findExpensiveOutliers,
  longRunningSubscriptions,
  recentGrowthCount,
  upcomingRenewalTotalCents,
  canceledCount,
  overdueRenewals,
  uncategorizedImports,
} from "../signals";
import { computeFunctionalOverlapGroups, findSmallSubscriptionsCluster, smallSubscriptionsClusterTitle } from "@/lib/subscriptions/insights";

// Phase 7.2 rewrite. The old model was one flat list where every rule's
// scoreImpact competed against every other rule's on a single shared 100
// baseline — a hand-tuned -3 here, a -5 there, with no way to tell whether
// the resulting number reflected genuine risk or just how many rules
// happened to fire. That produced real credibility problems: "83/100 Very
// Good" next to $173.93/mo, 7 renewals clustered together, and a $719.88/yr
// outlier read as reassuring when a user's own eyes said otherwise.
//
// Every rule below now also declares a `dimension` (see types.ts's
// HealthDimensionKey) — health-score.ts scores each dimension independently
// on its own 0-100 scale, then combines them with weights that reflect how
// predictive each dimension actually is (redundancy/spending matter more to
// "is this account healthy" than growth, which this app has weak evidence
// for at all — see the growth rule's own comment). Evidence tiers used
// throughout, not arbitrary numbers: STRONG (confirmed duplicate, proven
// cash-flow risk) moves a dimension ~20-25 points; MEDIUM (plausible
// overlap, spending concentration, an outsized subscription) ~10-12; WEAK
// (a soft, low-confidence signal like recent growth) ~4-6.
//
// Several rules the old model scored are gone entirely, not just
// reweighted, because the brief the audit worked from is explicit that they
// were never legitimate health signals: monthly-vs-annual billing mix and
// raw subscription count. Monthly billing is not inherently unhealthy;
// having many subscriptions is not inherently unhealthy. Scoring either was
// manufacturing a warning to populate the UI, which is exactly what this
// rewrite exists to stop doing.

const STRONG = 20;
const MEDIUM = 11;
const WEAK = 5;

// Shared by every rule below that lists subscription names in its
// description (outliers, small-subscriptions, overdue renewals,
// uncategorized imports) — all four were joining an unbounded list with no
// cap (caught in CodeRabbit review on the newest of the four,
// uncategorized_imports, but the same latent issue existed in the other
// three: a user with many flagged subscriptions at once would get a
// description that's one long unreadable comma-separated line). Caps at 3
// names, same threshold `high_yearly_spend` in insights.ts already uses
// for a similar reason.
const NAME_LIST_MAX = 3;
function formatNameList(names: string[]): string {
  if (names.length <= NAME_LIST_MAX) return names.join(", ");
  return `${names.slice(0, NAME_LIST_MAX).join(", ")}, and ${names.length - NAME_LIST_MAX} more`;
}

const duplicates: InsightRule = {
  id: "health.duplicates",
  name: "Confirmed duplicate subscriptions",
  description: "Near-identical subscription names — the strongest redundancy signal this app can compute deterministically.",
  severity: "warning",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const pairs = findDuplicates(ctx.active);
    if (pairs.length === 0) {
      return {
        ruleId: this.id,
        title: "No confirmed duplicates",
        description: "Nothing looks redundant — you're not paying twice for the same thing.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "redundancy" satisfies HealthDimensionKey,
        scoreImpact: 8,
      };
    }
    const ids = pairs.flatMap((p) => [p.keep.id, p.redundant.id]);
    return {
      ruleId: this.id,
      title: pairs.length === 1 ? "1 confirmed duplicate subscription" : `${pairs.length} confirmed duplicate subscriptions`,
      description: pairs.map((p) => `${p.keep.name} and ${p.redundant.name}`).join("; "),
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: ids,
      dimension: "redundancy" satisfies HealthDimensionKey,
      scoreImpact: -Math.min(pairs.length * STRONG, 40),
      monthlySavingsCents: pairs.reduce((sum, p) => sum + p.monthlySavingsCents, 0),
    };
  },
};

// Distinct from — and deliberately weaker than — confirmed duplicates
// above: two subscriptions genuinely solving the same problem (Spotify +
// Apple Music) is plausible evidence, not proof either is redundant (a
// household could use both). See computeFunctionalOverlapGroups' own
// comment for why category equality alone was replaced with this. Only
// returns a result when overlap is actually found — the absence of overlap
// is already covered by the duplicates rule's own positive case, so this
// doesn't crowd the dimension with a second "nothing found" message.
const functionalOverlap: InsightRule = {
  id: "health.functional_overlap",
  name: "Functional overlap",
  description: "2+ subscriptions resolving to the same curated functional-overlap group (music streaming, creative tools, ...).",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const groups = computeFunctionalOverlapGroups(ctx.active);
    if (groups.length === 0) return null;
    const ids = groups.flatMap((g) => g.subscriptions.map((s) => s.id));
    return {
      ruleId: this.id,
      title: groups.length === 1 ? "1 possible functional overlap" : `${groups.length} possible functional overlaps`,
      description: groups.map((g) => `${g.subscriptions.map((s) => s.name).join(" + ")} (${g.label.toLowerCase()})`).join("; "),
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: ids,
      dimension: "redundancy" satisfies HealthDimensionKey,
      scoreImpact: -Math.min(groups.length * MEDIUM, 22),
    };
  },
};

const concentration: InsightRule = {
  id: "health.concentration",
  name: "Spending concentration",
  description: "One category eating an outsized share of monthly spend — a real spending-pattern signal, not a claim about waste.",
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
        dimension: "spending" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    // Double-counting guard (caught in local-council review, Devil's
    // Advocate lens): a category with exactly one subscription in it that
    // ALSO happens to be a real cost outlier would otherwise be penalized
    // twice for one fact — once here ("Streaming is concentrated") and
    // once by the outliers rule below ("this subscription costs way more
    // than the rest"). When the dominant category's only contributor is
    // already an outlier, this is the same underlying story told a second
    // way, not two independent spending problems — the outliers rule
    // already covers it with the more specific framing, so this stays
    // silent rather than double-penalizing the spending dimension for a
    // single subscription. A category with 2+ contributors never hits this
    // — concentration is still real, independent evidence there.
    if (c.subscriptionIds.length === 1) {
      const outlierIds = new Set(findExpensiveOutliers(ctx.active).map((o) => o.subscription.id));
      if (outlierIds.has(c.subscriptionIds[0])) return null;
    }
    return {
      ruleId: this.id,
      title: `${CATEGORY_LABELS[c.category]} is concentrated`,
      description: `${CATEGORY_LABELS[c.category]} makes up ${Math.round(c.share * 100)}% of your monthly spend.`,
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: c.subscriptionIds,
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: -MEDIUM,
    };
  },
};

const outliers: InsightRule = {
  id: "health.expensive_outliers",
  name: "Expensive subscriptions",
  description: "Subscriptions costing at least 2x the group's mean annual cost — a real outlier, not a judgment that it's unaffordable.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const found = findExpensiveOutliers(ctx.active);
    if (found.length === 0) {
      if (ctx.active.length < 2) return null; // outlier detection needs 2+ to mean anything
      return {
        ruleId: this.id,
        title: "No outsized subscriptions",
        description: "Nothing costs dramatically more than the rest of your subscriptions.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "spending" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 outsized subscription" : `${found.length} outsized subscriptions`,
      description: formatNameList(found.map((o) => `${o.subscription.name} (${formatCents(o.annualCents)}/yr)`)),
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: found.map((o) => o.subscription.id),
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: -Math.min(found.length * MEDIUM, 22),
    };
  },
};

// "Death by a thousand cuts" — see findSmallSubscriptionsCluster's own
// comment for the full relative-threshold reasoning. Complementary to,
// never contradictory with, the outliers rule above: "nothing is
// individually outsized" and "several small ones add up" can both be true
// facts about the same portfolio at once (health-score.ts's status
// decoupling already handles a dimension carrying both a positive and a
// negative finding honestly). Only a negative case exists here — there's
// no positive-evidence version of "your small subscriptions don't add up
// to anything," so this stays silent (returns null) rather than manufacture
// a bonus for the absence of a pattern that most portfolios don't have
// anyway.
const smallSubscriptionsAddUp: InsightRule = {
  id: "health.small_subscriptions_add_up",
  name: "Small subscriptions add up",
  description: "Several individually-cheap subscriptions whose combined cost is a material share of total spend.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const cluster = findSmallSubscriptionsCluster(ctx.active);
    if (!cluster) return null;
    return {
      ruleId: this.id,
      title: smallSubscriptionsClusterTitle(cluster),
      description: `${formatNameList(cluster.subscriptions.map((s) => s.name))} are each well below your typical subscription cost here, but together they're ${Math.round(cluster.shareOfTotal * 100)}% of your monthly spend.`,
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: cluster.subscriptions.map((s) => s.id),
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: -MEDIUM,
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
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: WEAK,
    };
  },
};

// Deliberately the weakest-evidence dimension in this whole model. This app
// only knows when a subscription row was *added to SubSentry*
// (createdAt) — it has no idea whether that reflects a genuinely new
// subscription or a long-standing one imported for the first time (a CSV
// import of 10 years of bank history adds 10 years of subscriptions "in the
// last 30 days" by this measure). The bar is set high (5+, not the old
// model's 3+) and the wording never claims real spending growth is
// happening — only what's actually known: rows landed in SubSentry
// recently. See health-score.ts's confidence calculation, which also
// factors this same uncertainty in.
const recentGrowth: InsightRule = {
  id: "health.recent_growth",
  name: "Recently added to SubSentry",
  description: "Subscriptions added to SubSentry in the last 30 days — reflects import/entry activity, not proven spending growth.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const added = recentGrowthCount(ctx.active, ctx.todayIso);
    if (added < 5) {
      if (ctx.active.length < 2) return null;
      return {
        ruleId: this.id,
        title: "Steady subscription count",
        description: "No large batch of subscriptions was added to SubSentry in the last 30 days.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "growth" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    return {
      ruleId: this.id,
      title: `${added} subscriptions were added to SubSentry in the last 30 days`,
      description: "This reflects when they were added here, not necessarily when they actually started — worth a look if that many are genuinely new.",
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: [],
      dimension: "growth" satisfies HealthDimensionKey,
      scoreImpact: -WEAK,
    };
  },
};

// Replaces two old rules (renewal_clustering and renewal_spike) with one:
// clustering by itself — several renewals landing the same week — is not
// automatically unhealthy (a user could have 3 cheap subscriptions renew
// the same week and feel nothing), so it's surfaced as neutral, zero-impact
// context whenever it's the only evidence. The score only moves when
// there's genuine cash-flow-risk evidence: the amount actually due in the
// next 30 days is well above what a typical month costs.
const renewalRisk: InsightRule = {
  id: "health.renewal_risk",
  name: "Upcoming renewal load",
  description: "Total due in the next 30 days vs. a typical month's spend — clustering alone is neutral; a genuine spike is what actually matters.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const monthly = monthlyTotalCents(ctx.active);
    const cluster = findRenewalCluster(ctx.active, ctx.todayIso);
    if (monthly === 0) return null;
    const upcoming = upcomingRenewalTotalCents(ctx.active, ctx.todayIso);
    const isSpike = upcoming > monthly * 1.5;

    if (isSpike) {
      const clusterNote = cluster ? ` (${cluster.subscriptionIds.length} of them land within the same week)` : "";
      return {
        ruleId: this.id,
        title: "More than usual is due in the next 30 days",
        description: `${formatCents(upcoming)} is due in the next 30 days, above your typical monthly spend${clusterNote}.`,
        severity: "warning",
        category: "health",
        premium: false,
        subscriptionIds: cluster?.subscriptionIds ?? [],
        dimension: "renewal" satisfies HealthDimensionKey,
        scoreImpact: -MEDIUM,
      };
    }
    if (cluster) {
      // Informational only — see this rule's own comment on why clustering
      // alone never moves the score.
      return {
        ruleId: this.id,
        title: `${cluster.subscriptionIds.length} renewals land the same week`,
        description: `Starting ${cluster.windowStartIso}, ${formatCents(cluster.totalCents)} is due within 7 days — in line with your typical monthly spend.`,
        severity: "info",
        category: "health",
        premium: false,
        subscriptionIds: cluster.subscriptionIds,
        dimension: "renewal" satisfies HealthDimensionKey,
        scoreImpact: 0,
      };
    }
    if (ctx.active.length < 3) return null;
    return {
      ruleId: this.id,
      title: "Renewals are well spread out",
      description: "No week has several bills landing at once.",
      severity: "positive",
      category: "health",
      premium: false,
      subscriptionIds: [],
      dimension: "renewal" satisfies HealthDimensionKey,
      scoreImpact: WEAK,
    };
  },
};

const overdue: InsightRule = {
  id: "health.overdue_renewals",
  name: "Overdue renewal dates",
  description: "An active subscription whose renewal date has already passed — real bookkeeping neglect, not a guess about usage.",
  severity: "warning",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const found = overdueRenewals(ctx.active, ctx.todayIso);
    if (found.length === 0) {
      if (ctx.active.length === 0) return null;
      return {
        ruleId: this.id,
        title: "No overdue renewal dates",
        description: "Every active subscription's renewal date is up to date.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "hygiene" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 overdue renewal date" : `${found.length} overdue renewal dates`,
      description: `${formatNameList(found.map((s) => s.name))}: renewal date already passed. If still active, update the date; if not, mark it canceled.`,
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: found.map((s) => s.id),
      dimension: "hygiene" satisfies HealthDimensionKey,
      scoreImpact: -Math.min(found.length * MEDIUM, 22),
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
      dimension: "hygiene" satisfies HealthDimensionKey,
      scoreImpact: Math.min(count * WEAK, 15),
    };
  },
};

// "The product should tell users when SubSentry itself needs better data"
// (Phase 8 brief) — this is the one hygiene signal that's honestly about
// *this app's* classification gap, not the user's own record-keeping. Only
// counts imported rows (see uncategorizedImports' own comment on why a
// manually-chosen "Other" is a legitimate, deliberate answer, not a gap).
// Positive branch only fires when there's something to be positive ABOUT
// (at least one imported subscription exists) — an all-manual account
// saying "all your imports are categorized" would be a vacuous, borrowed
// compliment for zero actual imports.
const uncategorizedImportsRule: InsightRule = {
  id: "health.uncategorized_imports",
  name: "Uncategorized imported subscriptions",
  description: "Imported subscriptions SubSentry's merchant classifier couldn't confidently categorize — a data gap on this app's side, not a judgment about the subscription.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const imported = ctx.active.filter((s) => s.source !== "manual");
    if (imported.length === 0) return null;
    const found = uncategorizedImports(ctx.active);
    if (found.length === 0) {
      return {
        ruleId: this.id,
        title: "All imported subscriptions are categorized",
        description: "SubSentry recognized every imported subscription's merchant.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "hygiene" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 imported subscription couldn't be categorized" : `${found.length} imported subscriptions couldn't be categorized`,
      description: `${formatNameList(found.map((s) => s.name))}: SubSentry didn't recognize the merchant, so these are filed under "Other." Setting the right category yourself improves your category breakdown and concentration signals.`,
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: found.map((s) => s.id),
      dimension: "hygiene" satisfies HealthDimensionKey,
      scoreImpact: -WEAK,
    };
  },
};

export const HEALTH_RULES: InsightRule[] = [
  duplicates,
  functionalOverlap,
  concentration,
  outliers,
  smallSubscriptionsAddUp,
  longRunning,
  recentGrowth,
  renewalRisk,
  overdue,
  canceledHistory,
  uncategorizedImportsRule,
];
