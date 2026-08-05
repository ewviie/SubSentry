import type { EngineContext, HealthRating, HealthScoreResult, InsightResult } from "./types";
import { HEALTH_RULES } from "./rules/health";

// The health score is nothing but the sum of every health rule's
// scoreImpact, clamped 0-100 — there is no separate hard-coded scoring
// path. Add or reweight a rule in rules/health.ts and the score (and its
// breakdown) change automatically; this function never special-cases a
// rule by id.
export function computeHealthScore(ctx: EngineContext): HealthScoreResult | null {
  if (ctx.active.length === 0) return null;

  const results = HEALTH_RULES.map((rule) => rule.evaluate(ctx)).filter(
    (r): r is InsightResult => r !== null,
  );

  const breakdown = results
    .filter((r) => r.scoreImpact !== undefined)
    .map((r) => ({ label: r.title, delta: r.scoreImpact! }))
    .sort((a, b) => b.delta - a.delta);

  const rawScore = 100 + breakdown.reduce((sum, b) => sum + b.delta, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const rating: HealthRating =
    score >= 90 ? "Excellent" : score >= 75 ? "Very Good" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Needs Attention";

  return { score, rating, breakdown };
}
