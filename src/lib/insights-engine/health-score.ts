import type {
  EngineContext,
  HealthConfidence,
  HealthDimensionKey,
  HealthDimensionResult,
  HealthDimensionStatus,
  HealthRating,
  HealthScoreResult,
  InsightResult,
} from "./types";
import { HEALTH_RULES } from "./rules/health";
import { overdueRenewals } from "./signals";
import { splitByPrimaryCurrency } from "@/lib/subscriptions/money";

// Phase 7.2 rewrite. See rules/health.ts's own header comment for the full
// "why" (the old flat model gave every -3/-4/-5 equal footing regardless of
// how predictive it actually was, which is how "83/100 Very Good" ended up
// next to genuinely concerning numbers). Now: every health rule declares
// which of 5 dimensions its finding belongs to, each dimension is scored
// independently on its own 0-100 scale, and the overall score is a weighted
// combination, not a flat sum, so a real problem in a heavily-weighted
// dimension (redundancy, spending) moves the number more than a soft signal
// in a weakly-weighted one (growth, where this app's evidence is genuinely
// thin; see rules/health.ts's recentGrowth comment). Add or reweight a
// rule in rules/health.ts and both the dimension and overall score change
// automatically; nothing here special-cases a rule by id.
//
// Rebalance pass (post-7.2): the dimension model above was sound, but in
// practice most accounts landed at 90-100 "Excellent" regardless of whether
// they had real, evidenced problems. Not because the rules were wrong, but
// because (a) each rule's point value was tuned small enough that even a
// genuine finding barely dented its dimension, and (b) a weighted average
// across 5 dimensions lets one bad dimension get diluted by four clean ones
// sitting at their 100 ceiling. Fixed on both sides: rules/health.ts's
// STRONG/MEDIUM/WEAK tiers are bigger (see that file's own comment), and
// computeHealthScore below adds a bounded extra deduction based on the
// single worst dimension so a real problem can't fully hide behind clean
// ones. Neither change touches what counts as a problem, a rule's dimension,
// or the relative dimension weights: an account with zero genuine negative
// evidence anywhere still reaches the same 90-100 it always did.

const DIMENSION_LABELS: Record<HealthDimensionKey, string> = {
  spending: "Spending",
  redundancy: "Redundancy",
  growth: "Growth",
  renewal: "Renewals",
  hygiene: "Subscription hygiene",
};

// Redundancy and spending are weighted highest: confirmed duplicates,
// functional overlap, and spending concentration are the most directly
// actionable, best-evidenced signals this app can compute. Growth is
// weighted lowest deliberately: this app cannot distinguish "genuinely new
// spending" from "old subscription imported today" (see rules/health.ts),
// so it shouldn't be allowed to swing the overall score as much as
// dimensions built on firmer evidence. Sums to 1.
const DIMENSION_WEIGHTS: Record<HealthDimensionKey, number> = {
  spending: 0.2,
  redundancy: 0.3,
  growth: 0.1,
  renewal: 0.2,
  hygiene: 0.2,
};

const DIMENSION_ORDER: HealthDimensionKey[] = ["spending", "redundancy", "growth", "renewal", "hygiene"];

// Deliberately NOT a pure function of the netted score. A dimension can
// have an unrelated positive and negative finding at once (e.g. spending:
// "balanced across categories" +5 alongside a genuine expensive outlier
// -11). The positive doesn't address or mitigate the negative, it's a
// different fact about a different aspect of the same dimension, so their
// net (94) clearing the "good" cutoff would read as "nothing to flag" when
// there plainly is something. "good" is reserved for dimensions with zero
// negative evidence at all; any real negative finding caps the status at
// "watch"/"attention" by score, never lets an unrelated bonus buy it back
// to "good" (caught in review; this is the fix, not a hypothetical).
function statusForScore(score: number, hasNegativeEvidence: boolean): HealthDimensionStatus {
  if (!hasNegativeEvidence) return "good";
  return score >= 55 ? "watch" : "attention";
}

// A dimension whose score defaulted to 100 with literally zero contributing
// rules (e.g. a single brand-new subscription: spending/growth/renewal can
// each have nothing to say yet) would otherwise silently read as a perfect,
// confidently-"good" dimension, a real dishonest-precision bug caught in
// review, not a hypothetical one. "unknown" makes that gap visible instead
// of hiding it behind a green dot; see computeHealthScore's overall-score
// step for how it's kept out of the weighted average too.

function summarizeDimension(key: HealthDimensionKey, results: InsightResult[]): string {
  if (results.length === 0) {
    // No rule in this dimension had an opinion at all (e.g. zero spend, or
    // too little data for any signal to apply): an honest "nothing to
    // report" rather than a fabricated positive.
    return "Not enough data to say anything specific yet.";
  }
  // The single finding with the largest |scoreImpact| is the one most
  // responsible for this dimension's score, that's what a user actually
  // wants to know "why" about, not an arbitrary first-fired rule.
  const most = [...results].sort((a, b) => Math.abs(b.scoreImpact ?? 0) - Math.abs(a.scoreImpact ?? 0))[0];
  return most.title;
}

// Phase 8 Part 7: "for every dimension: ... recommended action." Keyed by
// ruleId rather than duplicated as a field on every rule in rules/health.ts:
// the action text is a UI-facing rephrasing of a finding this module
// already fully owns the presentation for (see summarizeDimension above,
// same pattern), so it lives in one place instead of twenty. Only rules
// with a real negative branch appear here on purpose: a rule with no
// negative case (health.long_running, health.canceled_history) never has
// anything to recommend fixing, and any ruleId not listed here correctly
// falls back to null via the lookup below rather than needing an explicit
// "no action" entry for every positive-only rule.
//
// Wording note (raised in local-council review, Compliance lens): every
// string here is deliberately a review prompt ("review," "compare,"
// "confirm"), never an unconditional instruction. This app suggests what
// to look at, it never claims to know a subscription is unwanted, and it
// never implies SubSentry itself would act on a user's behalf (same
// "informational, not a claim of action taken" boundary savings.ts's own
// computeRealizedSavings comment already documents for "confirmed"/
// "realized" language). Keep new entries to that same register.
// Exported (not just used internally) specifically so a test can assert
// every key here still matches a real HEALTH_RULES id, caught in
// local-council review (Maintainability/Simplicity lenses): this table is
// coupled by a bare string to `id` fields declared in a different file
// (rules/health.ts), and a typo or rename on either side used to compile
// clean and silently degrade to a missing action with no test failure. See
// health-score.test.ts's "every RULE_RECOMMENDED_ACTION key matches a real
// rule id" test, that's the guard, not documentation discipline alone.
export const RULE_RECOMMENDED_ACTION: Partial<Record<string, string>> = {
  "health.duplicates": "Review the redundant subscription and cancel it if it's no longer needed.",
  "health.functional_overlap": "Compare the overlapping subscriptions and decide if you need more than one.",
  "health.concentration": "Review your spending in the category that's dominating your monthly total.",
  "health.expensive_outliers": "Review your outsized subscription and confirm it's still worth the cost.",
  "health.portfolio_concentration": "Review the subscription making up most of your spend and confirm it's still worth the cost.",
  "health.price_increases": "Review whether the new price is still worth paying: switch, downgrade, or cancel if not.",
  "health.small_subscriptions_add_up": "Review your smaller subscriptions for any that have gone unused.",
  "health.recent_growth": "Skim what was recently added to confirm it's all genuinely new.",
  "health.renewal_risk": "Review what's due soon; spread out renewals if that's avoidable.",
  "health.overdue_renewals": "Update the renewal date, or mark it canceled if it no longer applies.",
  "health.uncategorized_imports": "Set the right category for your uncategorized imported subscriptions.",
  "health.reactivation": "Confirm the reactivated subscription is intentional, not an accidental re-signup.",
};

// Only recommends acting on real negative evidence: a dimension whose
// dominant (or only) finding is positive has nothing to fix, so this
// returns null rather than manufacturing a task out of good news (the same
// hasNegativeEvidence concept statusForScore already applies to the status
// dot, applied here to the action text too).
function recommendedActionFor(results: InsightResult[]): string | null {
  const negative = results.filter((r) => (r.scoreImpact ?? 0) < 0);
  if (negative.length === 0) return null;
  const dominant = [...negative].sort((a, b) => Math.abs(b.scoreImpact ?? 0) - Math.abs(a.scoreImpact ?? 0))[0];
  return RULE_RECOMMENDED_ACTION[dominant.ruleId] ?? null;
}

// Confidence reflects how much real evidence backs this score, not a
// fabricated "we've been watching you for months" claim, just an honest
// read of two things already in the data: how many active subscriptions
// exist to reason about, and how long this account has actually had data in
// it (the earliest subscription's own createdAt, across any status: the
// only real "history depth" signal this schema has; see PART 9/15's own
// comment in the brief this rewrite implements, no invented history).
function computeConfidence(ctx: EngineContext): HealthConfidence {
  const oldestCreatedAt = ctx.subscriptions.reduce<Date | null>(
    (oldest, s) => (oldest === null || s.createdAt < oldest ? s.createdAt : oldest),
    null,
  );
  // Number.isFinite guards a malformed todayIso (or, in principle, an
  // invalid stored createdAt) producing NaN and silently corrupting every
  // threshold check below it: falls back to "no history" (the same value
  // an unknown oldestCreatedAt already gets), never a fabricated number.
  const rawHistoryDays = oldestCreatedAt
    ? (new Date(`${ctx.todayIso}T00:00:00Z`).getTime() - oldestCreatedAt.getTime()) / 86_400_000
    : 0;
  const historyDays = Number.isFinite(rawHistoryDays) ? Math.floor(rawHistoryDays) : 0;

  if (ctx.active.length < 2 || historyDays < 7) {
    return {
      level: "low",
      reason:
        ctx.active.length < 2
          ? "Based on very few active subscriptions: most signals need at least 2 to mean anything."
          : "Based on limited subscription history.",
    };
  }
  if (ctx.active.length <= 3 || historyDays < 30) {
    return { level: "medium", reason: "Based on a small amount of subscription history." };
  }

  // Health Score v2: nearly every dollar-based signal in this model
  // (concentration, outliers, renewal exposure, the duplicate share
  // multiplier) is restricted to active's primary currency
  // (splitByPrimaryCurrency) — a subscription in a different currency
  // simply doesn't participate in that math. That's the right behavior for
  // each individual signal (this app has no exchange rate to convert with),
  // but it was previously invisible at the confidence level: an account
  // where a meaningful share of subscriptions sit outside the primary
  // currency had most of its money-based evidence quietly computed over a
  // minority of its portfolio, with nothing telling the user their score
  // rests on incomplete coverage. Capped at medium (never silently
  // defaulting to "high" just because subscription count and history depth
  // both look good) rather than lowered further to "low" — the excluded
  // subscriptions aren't a data-quality problem, this app genuinely lacks
  // the exchange-rate data to do better, so the honest signal here is
  // "meaningfully incomplete," not "unreliable."
  const { included } = splitByPrimaryCurrency(ctx.active);
  if (included.length / ctx.active.length < 0.7) {
    return {
      level: "medium",
      reason: "A meaningful share of your subscriptions are in a different currency and weren't included in dollar-based signals.",
    };
  }

  // Health Score v2 adversarial-audit fix: an active subscription whose
  // renewal date has already passed is real bookkeeping neglect (see
  // rules/health.ts's overdue rule), but it's also a live signal that this
  // app's own "active" status for that row might not reflect reality — the
  // service could genuinely still be running with a stale date, or it
  // could have been canceled elsewhere and never updated here. Either way,
  // once a large share of the active set is in that state, every
  // dollar-based figure computed FROM "active" (spend totals, concentration
  // shares, renewal exposure) rests on a membership list that's meaningfully
  // in doubt — a data-reliability gap this model had no way to surface
  // before (caught by the audit's "multiple overdue renewals" calibration
  // fixture: 3 of 4 active subscriptions overdue still reported "high"
  // confidence). Capped at medium, same reasoning as the currency-coverage
  // check above: overdue bookkeeping isn't proof any specific subscription
  // is wrong, so "meaningfully incomplete" is the honest read, not "low."
  // 30% is deliberately higher than a single forgotten renewal (which
  // shouldn't cost confidence at all — see this file's own overdue-renewal
  // rule, a WEAK/MEDIUM scoring signal, not a confidence one) but low
  // enough to catch a portfolio where "active" is genuinely questionable
  // for a meaningful chunk of it.
  const overdueShare = overdueRenewals(ctx.active, ctx.todayIso).length / ctx.active.length;
  if (overdueShare >= 0.3) {
    return {
      level: "medium",
      reason: "Several active subscriptions have renewal dates that have already passed, so this score may be based on subscriptions that aren't actually still active.",
    };
  }

  return { level: "high" };
}

// precomputedHealthResults is optional: every existing caller (this file's
// own tests included) omits it and gets the original behavior — HEALTH_RULES
// evaluated right here. engine.ts is the one caller that now passes its own
// already-evaluated results (release-review finding #8: engine.ts used to
// evaluate the same HEALTH_RULES a second, independent time just to build
// its own `results`/`positive`/`warnings` arrays, so every request paid for
// the O(n^2) duplicate/overlap passes inside those rules twice, and the two
// separately-maintained exclusion filters could silently drift apart). Must
// be the full, unfiltered result of evaluating HEALTH_RULES against this
// same ctx — NOT engine.ts's own display-filtered subset (which drops
// health.duplicates' warning branch for its own presentational reasons) —
// or the score/dimension breakdown below would silently lose that finding
// too.
export function computeHealthScore(
  ctx: EngineContext,
  precomputedHealthResults?: InsightResult[],
): HealthScoreResult | null {
  if (ctx.active.length === 0) return null;

  const results =
    precomputedHealthResults ??
    HEALTH_RULES.map((rule) => rule.evaluate(ctx)).filter((r): r is InsightResult => r !== null);

  const breakdown = results
    .filter((r) => r.scoreImpact !== undefined)
    .map((r) => ({ label: r.title, delta: r.scoreImpact! }))
    .sort((a, b) => b.delta - a.delta);

  const dimensions: HealthDimensionResult[] = DIMENSION_ORDER.map((key) => {
    const dimensionResults = results.filter((r) => r.dimension === key);
    const dimensionBreakdown = dimensionResults
      .filter((r) => r.scoreImpact !== undefined)
      .map((r) => ({ label: r.title, delta: r.scoreImpact! }))
      .sort((a, b) => b.delta - a.delta);
    const rawScore = 100 + dimensionBreakdown.reduce((sum, b) => sum + b.delta, 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const hasNegativeEvidence = dimensionBreakdown.some((b) => b.delta < 0);
    return {
      key,
      label: DIMENSION_LABELS[key],
      score,
      status: dimensionResults.length === 0 ? "unknown" : statusForScore(score, hasNegativeEvidence),
      summary: summarizeDimension(key, dimensionResults),
      recommendedAction: recommendedActionFor(dimensionResults),
      breakdown: dimensionBreakdown,
    };
  });

  // Renormalized across only the dimensions that actually had evidence: an
  // "unknown" dimension's placeholder 100 must not silently inflate the
  // overall score the way a real "good" 100 would. In today's rule set,
  // knownWeight can never be 0: hygiene's overdue-renewals rule fires
  // unconditionally whenever active.length > 0 (guaranteed by the early
  // return above). That's a cross-module invariant living in rules/
  // health.ts, not something this function can enforce on its own, so the
  // fallback below doesn't rely on it holding forever; an edit to
  // health.ts that made every rule conditionally null shouldn't turn this
  // into a divide-by-zero NaN score.
  const knownDimensions = dimensions.filter((d) => d.status !== "unknown");
  const knownWeight = knownDimensions.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d.key], 0);
  const overallRaw =
    knownWeight > 0
      ? knownDimensions.reduce((sum, d) => sum + d.score * DIMENSION_WEIGHTS[d.key], 0) / knownWeight
      : 100;

  // A straight weighted average lets a genuinely bad dimension hide behind
  // clean ones: even redundancy (0.3, the heaviest weight) sitting at 40/100
  // (two confirmed duplicate pairs, a real problem) only pulls the overall
  // average down to ~82 when the other four dimensions default to their 100
  // ceiling, because it's still only 30% of the sum. That reads as "Very
  // Good" for an account with a genuine redundancy problem, which is exactly
  // the credibility gap this whole rebalance exists to close (see
  // rules/health.ts's own rebalance-pass comment for the per-rule half of
  // this fix). This adds a small additional deduction based on how far the
  // single *worst* known dimension sits below 90, on top of, not instead
  // of, the weighted average, and capped (35 points as of Health Score v2,
  // was 15) so it can move a rating band but can never single-handedly tank
  // the score on its own.
  // The threshold is deliberately 90, not just the "attention" cutoff
  // (55): the goal isn't only to catch severe problems (the bigger
  // per-rule tiers in rules/health.ts already do that on their own); it's
  // that *any* dimension with real, evidenced negative findings, even one
  // moderate one, the realistic "average, not exceptional" account this
  // whole pass is about, should keep the overall score out of the 90-100
  // band reserved for accounts with nothing real to flag anywhere. A
  // dimension genuinely at 90+ (no negative evidence, or evidence too minor
  // to matter) never triggers this at all.
  const worstKnownScore = knownDimensions.length > 0 ? Math.min(...knownDimensions.map((d) => d.score)) : 100;
  // Health Score v2: cap raised 15->35 and multiplier 0.2->0.38. Calibration
  // testing (health-score.test.ts's "many confirmed duplicates" style
  // fixtures) found the v1 cap couldn't do its own job once a single
  // dimension is pinned at its architectural floor (e.g. redundancy at 40,
  // confirmedDuplicateSeverity's own -60 ceiling): even at that floor the
  // old cap of 20 could only ever pull a ~82 raw weighted average down to
  // ~62, still reading as "Good" for an account with a genuinely severe,
  // single-dimension redundancy problem. The new constants were tuned
  // against two fixed points: a single *moderate* duplicate in an
  // otherwise-clean small portfolio must stay >=70 (not "artificially
  // tanked" — see this file's own "single confirmed duplicate" test), while
  // a dimension pinned at its worst possible floor must land in "Fair," not
  // "Good." A weight-aware version of this term (scaling the multiplier by
  // how heavily the worst dimension is weighted) was tried first and
  // rejected: it double-counts the exact same "this duplicate is a big
  // share of a small portfolio" fact that confirmedDuplicateSeverity's own
  // g(share) term already prices in at the per-rule level, over-punishing
  // the moderate case below its own floor.
  const worstDimensionPenalty = Math.min(35, Math.max(0, (90 - worstKnownScore) * 0.38));

  // New in v2: a real problem confined to a *single* dimension is already
  // handled by worstDimensionPenalty above. This term only activates when
  // *multiple* dimensions independently show genuine, evidenced problems at
  // once — confirmed duplicates AND high concentration AND poor renewal
  // hygiene together is a materially worse portfolio than any one of those
  // alone, and a straight weighted average has no way to reflect that a
  // compounding pattern is worse than an isolated one.
  //
  // Adversarial-audit fix: the first shipped version of this term counted
  // *how many* known dimensions scored below 70 (excluding the worst one,
  // already handled above) and multiplied that discrete count by a flat 6.
  // A randomized invariant sweep (health-score.invariants.test.ts) found a
  // real, reproducible case where that discrete count let adding a
  // confirmed duplicate *improve* the overall score: an unrelated dimension
  // (spending, via categoryConcentration's own share-of-total threshold —
  // see that rule's own comment; unrelated to and unchanged by this pass)
  // happened to cross the 70 line the same moment the new duplicate was
  // added — diluted upward purely because total spend grew — which by
  // itself zeroed out an entire 6-point spreadPenalty bucket the base
  // portfolio had been sitting in, a swing larger than the genuine new
  // redundancy penalty. The count-based step function had no way to tell
  // "just barely below 70" apart from "deeply, severely below 70": both
  // counted as one full unit either way, so crossing the line by half a
  // point could flip the same 6-point bucket a severe problem would.
  //
  // Replaced with a continuous measure of the same underlying idea:
  // "shortfall below 70," summed across every known dimension EXCEPT the
  // single worst one (still worstDimensionPenalty's exclusive job, same
  // exclusion as before — this never double-counts the worst dimension
  // twice). A dimension sitting at 68 now contributes a shortfall of just
  // 2, not a full discrete "unit" identical to a dimension sitting at 20;
  // scaled down (x0.25) so the common "two moderately bad dimensions"
  // shape lands in a similar range the old flat-6 tuning targeted, without
  // a hard step anywhere. This doesn't claim to make every possible
  // adversarial combination of ratio-based rules perfectly monotonic under
  // every conceivable edit (see this file's own header note on that
  // structural limit) — it removes the specific, provable cliff this
  // term itself was contributing.
  const shortfalls = knownDimensions.map((d) => Math.max(0, 70 - d.score)).sort((a, b) => b - a);
  const excessShortfall = shortfalls.slice(1).reduce((sum, s) => sum + s, 0);
  const spreadPenalty = Math.min(18, Math.round(excessShortfall * 0.25));

  const score = Math.max(0, Math.min(100, Math.round(overallRaw - worstDimensionPenalty - spreadPenalty)));

  // Slightly tighter top bands than a naive 90/75/60/40 split: "Excellent"
  // and "Very Good" should mean genuinely little to flag across all 5
  // dimensions, not just a high average that a couple of strong dimensions
  // could produce while one dimension is quietly struggling.
  const rating: HealthRating =
    score >= 92 ? "Excellent" : score >= 80 ? "Very Good" : score >= 65 ? "Good" : score >= 45 ? "Fair" : "Needs Attention";

  return { score, rating, confidence: computeConfidence(ctx), dimensions, breakdown };
}
