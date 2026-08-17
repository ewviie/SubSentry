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

// Phase 7.2 rewrite — see rules/health.ts's own header comment for the full
// "why" (the old flat model gave every -3/-4/-5 equal footing regardless of
// how predictive it actually was, which is how "83/100 Very Good" ended up
// next to genuinely concerning numbers). Now: every health rule declares
// which of 5 dimensions its finding belongs to, each dimension is scored
// independently on its own 0-100 scale, and the overall score is a weighted
// combination — not a flat sum — so a real problem in a heavily-weighted
// dimension (redundancy, spending) moves the number more than a soft signal
// in a weakly-weighted one (growth, where this app's evidence is genuinely
// thin — see rules/health.ts's recentGrowth comment). Add or reweight a
// rule in rules/health.ts and both the dimension and overall score change
// automatically; nothing here special-cases a rule by id.

const DIMENSION_LABELS: Record<HealthDimensionKey, string> = {
  spending: "Spending",
  redundancy: "Redundancy",
  growth: "Growth",
  renewal: "Renewals",
  hygiene: "Subscription hygiene",
};

// Redundancy and spending are weighted highest — confirmed duplicates,
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
// -11) — the positive doesn't address or mitigate the negative, it's a
// different fact about a different aspect of the same dimension, so their
// net (94) clearing the "good" cutoff would read as "nothing to flag" when
// there plainly is something. "good" is reserved for dimensions with zero
// negative evidence at all; any real negative finding caps the status at
// "watch"/"attention" by score, never lets an unrelated bonus buy it back
// to "good". (Caught in review — this is the fix, not a hypothetical.)
function statusForScore(score: number, hasNegativeEvidence: boolean): HealthDimensionStatus {
  if (!hasNegativeEvidence) return "good";
  return score >= 55 ? "watch" : "attention";
}

// A dimension whose score defaulted to 100 with literally zero contributing
// rules (e.g. a single brand-new subscription: spending/growth/renewal can
// each have nothing to say yet) would otherwise silently read as a perfect,
// confidently-"good" dimension — a real dishonest-precision bug caught in
// review, not a hypothetical one. "unknown" makes that gap visible instead
// of hiding it behind a green dot; see computeHealthScore's overall-score
// step for how it's kept out of the weighted average too.

function summarizeDimension(key: HealthDimensionKey, results: InsightResult[]): string {
  if (results.length === 0) {
    // No rule in this dimension had an opinion at all (e.g. zero spend, or
    // too little data for any signal to apply) — an honest "nothing to
    // report" rather than a fabricated positive.
    return "Not enough data to say anything specific yet.";
  }
  // The single finding with the largest |scoreImpact| is the one most
  // responsible for this dimension's score — that's what a user actually
  // wants to know "why" about, not an arbitrary first-fired rule.
  const most = [...results].sort((a, b) => Math.abs(b.scoreImpact ?? 0) - Math.abs(a.scoreImpact ?? 0))[0];
  return most.title;
}

// Phase 8 Part 7: "for every dimension: ... recommended action." Keyed by
// ruleId rather than duplicated as a field on every rule in rules/health.ts
// — the action text is a UI-facing rephrasing of a finding this module
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
// "confirm"), never an unconditional instruction — this app suggests what
// to look at, it never claims to know a subscription is unwanted, and it
// never implies SubSentry itself would act on a user's behalf (same
// "informational, not a claim of action taken" boundary savings.ts's own
// computeRealizedSavings comment already documents for "confirmed"/
// "realized" language). Keep new entries to that same register.
// Exported (not just used internally) specifically so a test can assert
// every key here still matches a real HEALTH_RULES id — caught in
// local-council review (Maintainability/Simplicity lenses): this table is
// coupled by a bare string to `id` fields declared in a different file
// (rules/health.ts), and a typo or rename on either side used to compile
// clean and silently degrade to a missing action with no test failure. See
// health-score.test.ts's "every RULE_RECOMMENDED_ACTION key matches a real
// rule id" test — that's the guard, not documentation discipline alone.
export const RULE_RECOMMENDED_ACTION: Partial<Record<string, string>> = {
  "health.duplicates": "Review the redundant subscription and cancel it if it's no longer needed.",
  "health.functional_overlap": "Compare the overlapping subscriptions and decide if you need more than one.",
  "health.concentration": "Review your spending in the category that's dominating your monthly total.",
  "health.expensive_outliers": "Review your outsized subscription — confirm it's still worth the cost.",
  "health.small_subscriptions_add_up": "Review your smaller subscriptions for any that have gone unused.",
  "health.recent_growth": "Skim what was recently added to confirm it's all genuinely new.",
  "health.renewal_risk": "Review what's due soon — spread out renewals if that's avoidable.",
  "health.overdue_renewals": "Update the renewal date, or mark it canceled if it no longer applies.",
  "health.uncategorized_imports": "Set the right category for your uncategorized imported subscriptions.",
};

// Only recommends acting on real negative evidence — a dimension whose
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

// Confidence reflects how much real evidence backs this score — not a
// fabricated "we've been watching you for months" claim, just an honest
// read of two things already in the data: how many active subscriptions
// exist to reason about, and how long this account has actually had data in
// it (the earliest subscription's own createdAt, across any status — the
// only real "history depth" signal this schema has; see PART 9/15's own
// comment in the brief this rewrite implements — no invented history).
function computeConfidence(ctx: EngineContext): HealthConfidence {
  const oldestCreatedAt = ctx.subscriptions.reduce<Date | null>(
    (oldest, s) => (oldest === null || s.createdAt < oldest ? s.createdAt : oldest),
    null,
  );
  // Number.isFinite guards a malformed todayIso (or, in principle, an
  // invalid stored createdAt) producing NaN and silently corrupting every
  // threshold check below it — falls back to "no history" (the same value
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
          ? "Based on very few active subscriptions — most signals need at least 2 to mean anything."
          : "Based on limited subscription history.",
    };
  }
  if (ctx.active.length <= 3 || historyDays < 30) {
    return { level: "medium", reason: "Based on a small amount of subscription history." };
  }
  return { level: "high" };
}

export function computeHealthScore(ctx: EngineContext): HealthScoreResult | null {
  if (ctx.active.length === 0) return null;

  const results = HEALTH_RULES.map((rule) => rule.evaluate(ctx)).filter(
    (r): r is InsightResult => r !== null,
  );

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

  // Renormalized across only the dimensions that actually had evidence — an
  // "unknown" dimension's placeholder 100 must not silently inflate the
  // overall score the way a real "good" 100 would. In today's rule set,
  // knownWeight can never be 0: hygiene's overdue-renewals rule fires
  // unconditionally whenever active.length > 0 (guaranteed by the early
  // return above). That's a cross-module invariant living in rules/
  // health.ts, not something this function can enforce on its own, so the
  // fallback below doesn't rely on it holding forever — an edit to
  // health.ts that made every rule conditionally null shouldn't turn this
  // into a divide-by-zero NaN score.
  const knownDimensions = dimensions.filter((d) => d.status !== "unknown");
  const knownWeight = knownDimensions.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d.key], 0);
  const overallRaw =
    knownWeight > 0
      ? knownDimensions.reduce((sum, d) => sum + d.score * DIMENSION_WEIGHTS[d.key], 0) / knownWeight
      : 100;
  const score = Math.max(0, Math.min(100, Math.round(overallRaw)));

  // Slightly tighter top bands than a naive 90/75/60/40 split — "Excellent"
  // and "Very Good" should mean genuinely little to flag across all 5
  // dimensions, not just a high average that a couple of strong dimensions
  // could produce while one dimension is quietly struggling.
  const rating: HealthRating =
    score >= 92 ? "Excellent" : score >= 80 ? "Very Good" : score >= 65 ? "Good" : score >= 45 ? "Fair" : "Needs Attention";

  return { score, rating, confidence: computeConfidence(ctx), dimensions, breakdown };
}
