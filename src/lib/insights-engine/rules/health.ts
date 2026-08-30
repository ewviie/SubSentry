import { CATEGORY_LABELS } from "@/lib/subscriptions/labels";
import { formatCents, splitByPrimaryCurrency } from "@/lib/subscriptions/money";
import type { EngineContext, InsightRule, HealthDimensionKey } from "../types";
import {
  monthlyTotalCents,
  annualTotalCents,
  findDuplicates,
  categoryConcentration,
  categoryConcentrationImpact,
  findRenewalCluster,
  findExpensiveOutliers,
  expensiveOutlierMagnitudeFactor,
  longRunningSubscriptions,
  recentGrowthCount,
  upcomingRenewalTotalCents,
  nonReactivatedCanceledCount,
  overdueRenewals,
  uncategorizedImports,
  findPriceIncreases,
  hasEnoughPriceHistoryToEvaluate,
  priceIncreaseSeverity,
  confirmedDuplicateSeverity,
  portfolioConcentration,
  portfolioConcentrationPenalty,
  renewalExposurePenalty,
  reactivationCandidates,
  hasRepeatedPriceChanges,
} from "../signals";
import { computeFunctionalOverlapGroups, findSmallSubscriptionsCluster, smallSubscriptionsClusterTitle } from "@/lib/subscriptions/insights";

// Phase 7.2 rewrite. The old model was one flat list where every rule's
// scoreImpact competed against every other rule's on a single shared 100
// baseline: a hand-tuned -3 here, a -5 there, with no way to tell whether
// the resulting number reflected genuine risk or just how many rules
// happened to fire. That produced real credibility problems: "83/100 Very
// Good" next to $173.93/mo, 7 renewals clustered together, and a $719.88/yr
// outlier read as reassuring when a user's own eyes said otherwise.
//
// Every rule below now also declares a `dimension` (see types.ts's
// HealthDimensionKey). health-score.ts scores each dimension independently
// on its own 0-100 scale, then combines them with weights that reflect how
// predictive each dimension actually is (redundancy/spending matter more to
// "is this account healthy" than growth, which this app has weak evidence
// for at all; see the growth rule's own comment). Evidence tiers used
// throughout, not arbitrary numbers: MEDIUM (plausible overlap, spending
// concentration, an outsized subscription) moves a dimension 16 points;
// WEAK (a soft, low-confidence signal like recent growth) 8. See the
// rebalance-pass comment further down for why these are bigger than the
// original 20/11/5.
//
// Health Score v2: confirmed duplicates (the strongest, best-evidenced
// signal this app computes) no longer uses a flat per-instance tier at
// all — confirmedDuplicateSeverity (signals.ts) replaces the old flat
// "-30 per pair, capped at 60" with a magnitude- and count-aware formula,
// specifically so a trivial-dollar duplicate and a portfolio-dominating one
// no longer score identically. See that function's own comment for the
// exact shape; see HEALTH_SCORE_V2_PROPOSAL.md for the full calibration
// this was checked against.
//
// Several rules the old model scored are gone entirely, not just
// reweighted, because the brief the audit worked from is explicit that they
// were never legitimate health signals: monthly-vs-annual billing mix and
// raw subscription count. Monthly billing is not inherently unhealthy;
// having many subscriptions is not inherently unhealthy. Scoring either was
// manufacturing a warning to populate the UI, which is exactly what this
// rewrite exists to stop doing.
//
// Rebalance pass: the original 20/11/5 tiers made "100/100 Excellent" the
// default outcome for almost any account, not just a genuinely well-managed
// one. A single confirmed duplicate, the strongest, highest-weighted signal
// this app can compute, only cost the *overall* score ~6 points (redundancy
// dropping from 100 to 80, at 30% weight, diluted by four other dimensions
// still parked at their 100 ceiling). That's not "meaningful," it's a
// rounding error. Tiers roughly 1.5x'd (and each rule's multi-instance cap
// scaled with it, same ratio as before) so a real, single finding in the
// heaviest-weighted dimension is enough to visibly drop out of "Excellent,"
// while a dimension with zero negative evidence is completely unaffected.
// This changes how much a *problem* costs, not what counts as one, and a
// genuinely clean account still reaches the same 90-100 it always did (see
// computeHealthScore's worstDimensionPenalty comment for the other half of
// this fix: even bigger per-rule tiers still get diluted away by four clean
// dimensions unless the aggregation itself accounts for it).
const MEDIUM = 16;
const WEAK = 8;

// Shared by every rule below that lists subscription names in its
// description (outliers, small-subscriptions, overdue renewals,
// uncategorized imports). All four were joining an unbounded list with no
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
  description: "Near-identical subscription names: the strongest redundancy signal this app can compute deterministically.",
  severity: "warning",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const pairs = findDuplicates(ctx.active);
    if (pairs.length === 0) {
      return {
        ruleId: this.id,
        title: "No confirmed duplicates",
        description: "Nothing looks redundant, you're not paying twice for the same thing.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "redundancy" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    const ids = pairs.flatMap((p) => [p.keep.id, p.redundant.id]);
    // Health Score v2: magnitude- and count-aware severity (see
    // confirmedDuplicateSeverity's own comment) replaces the old flat
    // "-STRONG per pair, capped at 60" — a $10 duplicate in a $2,000/mo
    // portfolio and the same $10 duplicate in a $50/mo portfolio no longer
    // score identically. Restricted to active's primary currency for the
    // share calculation, same reasoning as every other spend-share signal
    // in this codebase (categoryConcentration, findExpensiveOutliers): a
    // share only means something when numerator and denominator are the
    // same currency.
    const redundantMonthlyCents = pairs.reduce((sum, p) => sum + p.monthlySavingsCents, 0);
    // "Stale" — already surfaced on /savings and dismissed, and still
    // unresolved today (the pair still exists) — real, stored evidence
    // (dismissedSavingsRecommendations, via ctx.dismissedRecommendationIds)
    // that this exact finding was already shown once and never acted on,
    // not an inferred pattern. Uses the same deterministic id
    // computeSavingsRecommendations builds for this exact pair
    // (savings.ts's `duplicate-${keep.id}-${redundant.id}`) so this can
    // only ever match a real recommendation this user actually dismissed.
    const hasStaleDismissal = pairs.some((p) => ctx.dismissedRecommendationIds?.has(`duplicate-${p.keep.id}-${p.redundant.id}`));
    return {
      ruleId: this.id,
      title: pairs.length === 1 ? "1 confirmed duplicate subscription" : `${pairs.length} confirmed duplicate subscriptions`,
      description: pairs.map((p) => `${p.keep.name} and ${p.redundant.name}`).join("; "),
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: ids,
      dimension: "redundancy" satisfies HealthDimensionKey,
      scoreImpact: confirmedDuplicateSeverity(pairs.length, redundantMonthlyCents, monthlyTotalCents(ctx.active), hasStaleDismissal),
      // Sums each pair's redundant-subscription cost. Duplicate pairs are
      // near-always the same currency as the rest of this user's portfolio
      // in practice; a genuinely mixed-currency set of simultaneous
      // duplicate pairs (rare — needs 2+ separate name-matches in 2+
      // different currencies at once) would still sum here, a known,
      // narrower edge case than the ones this pass fixes.
      monthlySavingsCents: redundantMonthlyCents,
      currency: pairs[0]?.redundant.currency,
    };
  },
};

// Distinct from, and deliberately weaker than, confirmed duplicates
// above: two subscriptions genuinely solving the same problem (Spotify +
// Apple Music) is plausible evidence, not proof either is redundant (a
// household could use both). See computeFunctionalOverlapGroups' own
// comment for why category equality alone was replaced with this. Only
// returns a result when overlap is actually found: the absence of overlap
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
      scoreImpact: -Math.min(groups.length * MEDIUM, 32),
    };
  },
};

const concentration: InsightRule = {
  id: "health.concentration",
  name: "Spending concentration",
  description: "One category eating an outsized share of monthly spend: a real spending-pattern signal, not a claim about waste.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const c = categoryConcentration(ctx.active);
    if (!c) return null; // zero spend or only one category: "balanced" doesn't apply, no opinion
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
        // Adversarial-audit fix: continuous in share, not a flat WEAK — see
        // categoryConcentrationImpact's own comment for why a flat swing
        // across this exact boundary was a real, exploitable cliff.
        scoreImpact: categoryConcentrationImpact(c.share),
      };
    }
    // Double-counting guard (caught in local-council review, Devil's
    // Advocate lens): a category with exactly one subscription in it that
    // ALSO happens to be a real cost outlier would otherwise be penalized
    // twice for one fact: once here ("Streaming is concentrated") and
    // once by the outliers rule below ("this subscription costs way more
    // than the rest"). When the dominant category's only contributor is
    // already an outlier, this is the same underlying story told a second
    // way, not two independent spending problems. The outliers rule
    // already covers it with the more specific framing, so this stays
    // silent rather than double-penalizing the spending dimension for a
    // single subscription. A category with 2+ contributors never hits
    // this: concentration is still real, independent evidence there.
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
      scoreImpact: categoryConcentrationImpact(c.share),
    };
  },
};

const outliers: InsightRule = {
  id: "health.expensive_outliers",
  name: "Expensive subscriptions",
  description: "Subscriptions costing at least 2x the group's mean annual cost: a real outlier, not a judgment that it's unaffordable.",
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
    // Health Score v2 audit fix: magnitude-aware, not just count-aware —
    // see expensiveOutlierMagnitudeFactor's own comment for why a flat
    // per-count penalty under-counted the "one subscription eating the
    // vast majority of spend" case. found is already sorted descending by
    // annualCents, so found[0] is the single largest outlier; its own share
    // of primary-currency annual spend is what drives the factor. Denominator
    // guarded (>0 whenever `found` is non-empty by construction — an
    // outlier needs annualCents >= 3000, so the total can't be zero), but
    // written defensively rather than assumed.
    const { included: primaryActive } = splitByPrimaryCurrency(ctx.active);
    const totalAnnual = annualTotalCents(primaryActive);
    const topShare = totalAnnual > 0 ? found[0].annualCents / totalAnnual : 0;
    const magnitudeFactor = expensiveOutlierMagnitudeFactor(topShare);
    const penalty = Math.min(32, Math.round(found.length * MEDIUM * magnitudeFactor));
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 outsized subscription" : `${found.length} outsized subscriptions`,
      description: formatNameList(found.map((o) => `${o.subscription.name} (${formatCents(o.annualCents, o.subscription.currency)}/yr)`)),
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: found.map((o) => o.subscription.id),
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: -penalty,
    };
  },
};

// Health Score v2: "does one subscription dominate overall spend,"
// independent of category — portfolioConcentration (signals.ts) uses a
// normalized HHI so a perfectly even split never reads as concentrated
// regardless of subscription count. Deliberately negative-only, same
// pattern as functionalOverlap/smallSubscriptionsAddUp: a well-spread
// portfolio has nothing new to say beyond what health.expensive_outliers'
// own positive branch already covers, so this never manufactures a second
// "well spread" bonus for the same absence of evidence.
//
// Mutual exclusion with health.expensive_outliers (not a numeric max — see
// portfolioConcentration's own comment): if this metric's single biggest
// contributor is already one of the subscriptions expensive_outliers
// flagged, this stays silent. Both are different measurements of the same
// underlying fact ("one subscription is disproportionately large"); this
// rule only has something new to add when the imbalance comes from several
// merely-large-but-not-2x-mean subscriptions instead of one clear outlier.
const portfolioConcentrationRule: InsightRule = {
  id: "health.portfolio_concentration",
  name: "Overall spend concentration",
  description: "One subscription eating an outsized share of total spend, regardless of category — a normalized HHI over per-subscription share.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const concentration = portfolioConcentration(ctx.active);
    if (!concentration) return null;
    const outlierIds = new Set(findExpensiveOutliers(ctx.active).map((o) => o.subscription.id));
    if (outlierIds.has(concentration.topSubscriptionId)) return null;
    const impact = portfolioConcentrationPenalty(concentration.normalizedHHI);
    if (impact === 0) return null;
    const top = ctx.active.find((s) => s.id === concentration.topSubscriptionId);
    return {
      ruleId: this.id,
      title: "Spend is concentrated in one subscription",
      description: top
        ? `${top.name} makes up ${Math.round(concentration.topShare * 100)}% of your total monthly spend.`
        : `One subscription makes up ${Math.round(concentration.topShare * 100)}% of your total monthly spend.`,
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: top ? [top.id] : [],
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: impact,
    };
  },
};

// North Star Part: "meaningful price increases" was the one signal type
// explicitly called out as high-value and currently missing entirely. The
// infrastructure (subscriptionPriceHistory, computeLatestPriceChange) has
// existed since Phase 9, but was only ever surfaced passively, one
// subscription at a time, on that subscription's own detail page. Nobody
// was told proactively. This is the same real, already-recorded history,
// no new detection heuristic, no estimate, just finally checked across the
// whole active portfolio and folded into the same score/Quick-Wins/"What
// SubSentry noticed" machinery every other health rule already feeds.
// Returns null (not a fabricated positive) for an account with too little
// recorded history to have an opinion yet; see
// hasEnoughPriceHistoryToEvaluate's own comment.
//
// Honest scope, not oversold (product council review, Devil's Advocate
// lens): no import path (Gmail/Plaid/TrueLayer/CSV) writes a
// subscriptionPriceHistory row for an *existing* subscription today.
// Imports only ever create new rows (see schema.ts's own comment on that
// table). The only writer is a user's own edit (updateSubscription). So
// today this can only ever fire in response to a price the user themselves
// typed in. Proactively surfacing and scoring it across the whole
// portfolio (instead of only on that one subscription's own detail page)
// is still real, new value, but this does not yet "catch" a price hike a
// provider raised quietly in the background. Wiring import-side price
// reconciliation (detection.ts already fuzzy-matches a detected charge
// against an existing active subscription by name; it just never compares
// the amount or writes history) is the natural next step that would make
// this genuinely proactive.
const priceIncreases: InsightRule = {
  id: "health.price_increases",
  name: "Price increases",
  description: "Active subscriptions whose price genuinely went up since SubSentry first recorded it: real observed history, never an estimate.",
  severity: "warning",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const historyMap = ctx.priceHistoryBySubscriptionId ?? new Map();
    if (!hasEnoughPriceHistoryToEvaluate(ctx.active, historyMap)) return null;
    const found = findPriceIncreases(ctx.active, historyMap);
    if (found.length === 0) {
      return {
        ruleId: this.id,
        // Not an unqualified "No price increases": hasEnoughPriceHistoryToEvaluate's
        // bar is "at least one active subscription has history," so this
        // positive can legitimately fire having only ever checked a small
        // slice of a larger portfolio. The title says so explicitly (product
        // council review, Fintech/Trust lens) rather than reading as a
        // portfolio-wide assurance a skimming user would take at face value.
        title: "No price increases in your tracked history",
        description: "Every subscription SubSentry has price history for has stayed the same price or gotten cheaper.",
        severity: "positive",
        category: "health",
        premium: false,
        subscriptionIds: [],
        dimension: "spending" satisfies HealthDimensionKey,
        scoreImpact: WEAK,
      };
    }
    // Final-calibration-review fix: magnitude- and count-aware, via
    // priceIncreaseSeverity — see that function's own comment for why the
    // old flat "-16 per increase, saturating at 2 occurrences" let a
    // portfolio where every subscription's price nearly doubled score
    // identically to one where two rose modestly. `repeated` (2+ recorded
    // changes on at least one subscription in the trailing year) is now a
    // small multiplier inside that same formula rather than a separate
    // additive kicker, so it scales consistently with the rest of the
    // penalty instead of being a flat bonus that could occasionally push
    // the old fixed cap past its own ceiling.
    const repeated = hasRepeatedPriceChanges(ctx.active, historyMap, ctx.todayIso);
    const totalAnnualDeltaCents = found.reduce((sum, f) => sum + f.change.annualDeltaCents, 0);
    const { included: primaryActive } = splitByPrimaryCurrency(ctx.active);
    const totalAnnualCents = annualTotalCents(primaryActive);
    const penalty = priceIncreaseSeverity(found.length, totalAnnualDeltaCents, totalAnnualCents, repeated);
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 subscription got more expensive" : `${found.length} subscriptions got more expensive`,
      description: `${formatNameList(
        found.map((f) => `${f.subscription.name} (+${Math.round(f.change.percentChange)}%, ${formatCents(f.change.annualDeltaCents, f.change.currency)}/yr)`),
      )}, based on SubSentry's own recorded price history.${repeated ? " At least one of these has changed price more than once in the last year." : ""}`,
      severity: "warning",
      category: "health",
      premium: false,
      subscriptionIds: found.map((f) => f.subscription.id),
      dimension: "spending" satisfies HealthDimensionKey,
      scoreImpact: penalty,
    };
  },
};

// "Death by a thousand cuts." See findSmallSubscriptionsCluster's own
// comment for the full relative-threshold reasoning. Complementary to,
// never contradictory with, the outliers rule above: "nothing is
// individually outsized" and "several small ones add up" can both be true
// facts about the same portfolio at once (health-score.ts's status
// decoupling already handles a dimension carrying both a positive and a
// negative finding honestly). Only a negative case exists here: there's
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
      description: "You have subscriptions you've kept for over a year: stable, deliberate spend.",
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
// (createdAt). It has no idea whether that reflects a genuinely new
// subscription or a long-standing one imported for the first time (a CSV
// import of 10 years of bank history adds 10 years of subscriptions "in the
// last 30 days" by this measure). The bar is set high (5+, not the old
// model's 3+) and the wording never claims real spending growth is
// happening, only what's actually known: rows landed in SubSentry
// recently. See health-score.ts's confidence calculation, which also
// factors this same uncertainty in.
const recentGrowth: InsightRule = {
  id: "health.recent_growth",
  name: "Recently added to SubSentry",
  description: "Subscriptions added to SubSentry in the last 30 days: reflects import/entry activity, not proven spending growth.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const added = recentGrowthCount(ctx.active, ctx.todayIso);
    // Health Score v2: the raw "5+" floor is unchanged (never MORE strict
    // than before at small counts) but is now paired with a rate check —
    // a large, healthy portfolio adding 5 new subscriptions is a
    // completely different fact from a 6-subscription portfolio doing the
    // same thing, and the old model scored both identically. `rate < 0.15`
    // only ever *loosens* the old gate (a large portfolio crossing the raw
    // floor at a low rate now stays positive instead of being flagged), it
    // never tightens it — every fixture that used to fire negative at a
    // small active count still does, since added<5 alone already exits to
    // the positive branch below.
    const rate = ctx.active.length > 0 ? added / ctx.active.length : 0;
    if (added < 5 || rate < 0.15) {
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
    // Tiered by rate, not a flat -WEAK regardless of how large a share of
    // the portfolio just changed — a portfolio that's half-new (rate>=0.5)
    // is a materially different fact from one that's crossed the raw floor
    // at, say, 20%. Capped at the same -WEAK (8) the old model always used,
    // so this pass makes the signal more precisely targeted, not harsher
    // overall — growth stays this model's deliberately lowest-weighted,
    // lowest-confidence dimension either way.
    const penalty = rate >= 0.5 ? WEAK : rate >= 0.3 ? Math.round(WEAK * 0.75) : Math.round(WEAK * 0.5);
    return {
      ruleId: this.id,
      title: `${added} subscriptions were added to SubSentry in the last 30 days`,
      description: "This reflects when they were added here, not necessarily when they actually started. Worth a look if that many are genuinely new.",
      severity: "info",
      category: "health",
      premium: false,
      subscriptionIds: [],
      dimension: "growth" satisfies HealthDimensionKey,
      scoreImpact: -penalty,
    };
  },
};

// Replaces two old rules (renewal_clustering and renewal_spike) with one:
// clustering by itself, several renewals landing the same week, is not
// automatically unhealthy (a user could have 3 cheap subscriptions renew
// the same week and feel nothing), so it's surfaced as neutral, zero-impact
// context whenever it's the only evidence. The score only moves when
// there's genuine cash-flow-risk evidence: the amount actually due in the
// next 30 days is well above what a typical month costs.
const renewalRisk: InsightRule = {
  id: "health.renewal_risk",
  name: "Upcoming renewal load",
  description: "Total due in the next 30 days vs. a typical month's spend. Clustering alone is neutral; a genuine spike is what actually matters.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    // Both sides restricted to active's primary currency (monthlyTotalCents
    // itself is currency-agnostic — the guard lives at the call site, same
    // as engine.ts's stats) so "above your typical monthly spend" always
    // compares two figures in the same currency.
    const { currency, included: primaryActive } = splitByPrimaryCurrency(ctx.active);
    const monthly = monthlyTotalCents(primaryActive);
    const cluster = findRenewalCluster(ctx.active, ctx.todayIso);
    if (monthly === 0) return null;
    const upcoming = upcomingRenewalTotalCents(ctx.active, ctx.todayIso);
    // Health Score v2: renewalExposurePenalty (signals.ts) replaces the old
    // binary "upcoming > monthly * 1.5" cliff with a continuous curve —
    // softer at the margin (starts accumulating at 1.3x instead of nothing
    // until 1.5x) but reaches a harsher ceiling (-32 vs. the old flat -16)
    // for a genuinely severe spike. See that function's own comment for the
    // exact shape.
    const ratio = upcoming / monthly;
    const exposurePenalty = renewalExposurePenalty(ratio);

    if (exposurePenalty < 0) {
      const clusterNote = cluster ? ` (${cluster.subscriptionIds.length} of them land within the same week)` : "";
      return {
        ruleId: this.id,
        title: "More than usual is due in the next 30 days",
        description: `${formatCents(upcoming, currency ?? undefined)} is due in the next 30 days, above your typical monthly spend${clusterNote}.`,
        severity: "warning",
        category: "health",
        premium: false,
        subscriptionIds: cluster?.subscriptionIds ?? [],
        dimension: "renewal" satisfies HealthDimensionKey,
        scoreImpact: exposurePenalty,
      };
    }
    if (cluster && cluster.currency) {
      // Informational only, see this rule's own comment on why clustering
      // alone never moves the score.
      return {
        ruleId: this.id,
        title: `${cluster.subscriptionIds.length} renewals land the same week`,
        description: `Starting ${cluster.windowStartIso}, ${formatCents(cluster.totalCents, cluster.currency)} is due within 7 days, in line with your typical monthly spend.`,
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
  description: "An active subscription whose renewal date has already passed: real bookkeeping neglect, not a guess about usage.",
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
      scoreImpact: -Math.min(found.length * MEDIUM, 32),
    };
  },
};

// Health Score v2 audit fix: uses nonReactivatedCanceledCount, not the raw
// canceledCount, specifically so a canceled subscription that's since come
// back (name-matches a currently-active one — health.reactivation already
// penalizes that same fact from the active side) isn't ALSO credited here
// as evidence of "actively pruning what you don't use." Before this fix,
// those two findings were computed in total isolation and could net out to
// a wash (or a net positive once the dimension score clamped at 100),
// hiding a real churn signal behind a clean-looking hygiene dimension — see
// nonReactivatedCanceledCount's own comment for the calibration fixture
// that caught it. A genuinely resolved cancellation (nothing active shares
// its name) still gets full, uncomplicated credit.
const canceledHistory: InsightRule = {
  id: "health.canceled_history",
  name: "Canceled subscription history",
  description: "Having actually canceled things you no longer use is a positive habit, not a neutral fact — unless it came right back.",
  severity: "positive",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const count = nonReactivatedCanceledCount(ctx.subscriptions);
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
      scoreImpact: Math.min(count * WEAK, 24),
    };
  },
};

// "The product should tell users when SubSentry itself needs better data"
// (Phase 8 brief). This is the one hygiene signal that's honestly about
// *this app's* classification gap, not the user's own record-keeping. Only
// counts imported rows (see uncategorizedImports' own comment on why a
// manually-chosen "Other" is a legitimate, deliberate answer, not a gap).
// Positive branch only fires when there's something to be positive ABOUT
// (at least one imported subscription exists): an all-manual account
// saying "all your imports are categorized" would be a vacuous, borrowed
// compliment for zero actual imports.
const uncategorizedImportsRule: InsightRule = {
  id: "health.uncategorized_imports",
  name: "Uncategorized imported subscriptions",
  description: "Imported subscriptions SubSentry's merchant classifier couldn't confidently categorize: a data gap on this app's side, not a judgment about the subscription.",
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

// Health Score v2: an active subscription whose normalized name matches a
// *canceled* one on this same account — real, already-stored evidence
// (both rows already exist in `subscriptions`; only `status` differs) that
// something once marked done came back. Deliberately makes no claim about
// why (a household re-subscribing in December is completely normal) — this
// is a fact worth confirming, not a behavioral judgment, and it's why the
// penalty is a flat, uncounted -WEAK regardless of how many matches exist
// rather than scaling per instance the way health.duplicates does: this
// evidence is inherently ambiguous (could be entirely intentional), so it
// doesn't get to move the score more just because it happened more than
// once. Negative-only, same pattern as functionalOverlap/
// smallSubscriptionsAddUp: "you've never reactivated anything" isn't a
// fact worth a manufactured bonus, canceledHistory already covers the
// positive side of this same underlying data (having canceled things at
// all).
const reactivation: InsightRule = {
  id: "health.reactivation",
  name: "Reactivated subscriptions",
  description: "An active subscription whose name matches one you'd previously marked canceled on this same account.",
  severity: "info",
  category: "health",
  premium: false,
  evaluate(ctx: EngineContext) {
    const found = reactivationCandidates(ctx.subscriptions, ctx.active);
    if (found.length === 0) return null;
    return {
      ruleId: this.id,
      title: found.length === 1 ? "1 reactivated subscription" : `${found.length} reactivated subscriptions`,
      description: `${formatNameList(found.map((s) => s.name))}: you'd previously marked a subscription with this name canceled. Worth confirming that's intentional.`,
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
  portfolioConcentrationRule,
  priceIncreases,
  smallSubscriptionsAddUp,
  longRunning,
  recentGrowth,
  renewalRisk,
  overdue,
  canceledHistory,
  uncategorizedImportsRule,
  reactivation,
];
