import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";

// Reusable across the dashboard, /savings, /analytics, and future premium
// surfaces — a rule never touches the DB or React; it's a pure function of
// EngineContext. New checks are added by pushing a rule into rules/*.ts,
// never by editing engine.ts.
export interface EngineContext {
  subscriptions: Subscription[]; // all, any status
  active: Subscription[]; // status === "active", precomputed once for every rule
  todayIso: string; // YYYY-MM-DD
  isPremium: boolean;
  // Every price-history row this user has, grouped by subscriptionId — one
  // bulk query (queries.ts's getAllPriceHistoryForUser), not fetched
  // per-subscription, so a rule that needs it (health.price_increases)
  // never becomes an N+1. Optional, not required: every existing rule and
  // every existing test-built EngineContext predates this field and has no
  // reason to care about it — a rule that does defaults a missing map to
  // "no history known," never throws.
  priceHistoryBySubscriptionId?: Map<string, SubscriptionPriceHistory[]>;
}

export type InsightSeverity = "positive" | "info" | "warning" | "critical";
export type InsightCategory = "health" | "cost" | "renewals" | "optimization" | "usage";

// Health scoring is no longer one flat point list — see health-score.ts's
// own header comment for why (a single -3/-4/-5 list gives every signal
// equal weight regardless of how predictive it actually is, which is how a
// hand-tuned model produced "83/100 Very Good" next to genuinely concerning
// underlying numbers). Every category:"health" rule now also declares which
// of these 5 dimensions its finding belongs to; non-health rules
// (free/premium) never set this.
export type HealthDimensionKey = "spending" | "redundancy" | "growth" | "renewal" | "hygiene";

export interface InsightResult {
  ruleId: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  category: InsightCategory;
  premium: boolean;
  subscriptionIds: string[];
  // Only set on category:"health" rules — the signed contribution this
  // finding makes to its dimension's own 0-100 score. Every other category
  // leaves this undefined; they inform, they don't score.
  scoreImpact?: number;
  // Only set on category:"health" rules — which of the 5 dimensions this
  // finding's scoreImpact applies to.
  dimension?: HealthDimensionKey;
  monthlySavingsCents?: number;
  // Currency monthlySavingsCents is denominated in — only set alongside
  // monthlySavingsCents. Consumers rendering that figure (Quick Wins'
  // badge) must format it with this rather than assuming USD.
  currency?: string;
}

export interface InsightRule {
  id: string;
  name: string;
  description: string;
  severity: InsightSeverity;
  category: InsightCategory;
  premium: boolean;
  evaluate(context: EngineContext): InsightResult | null;
}

export interface HealthBreakdownEntry {
  label: string;
  delta: number;
}

export type HealthRating = "Excellent" | "Very Good" | "Good" | "Fair" | "Needs Attention";

// 🟢/🟡/🟠 in the UI — a coarser, more scannable read than the raw 0-100
// dimension score, calibrated the same way the overall rating is (see
// health-score.ts's RATING_THRESHOLDS). "unknown" is distinct from "good":
// it means no rule in that dimension had enough evidence to form an opinion
// at all (e.g. a single brand-new subscription — see health-score.ts's own
// comment on why this can't be allowed to silently read as a perfect
// score), not that the evidence looked healthy.
export type HealthDimensionStatus = "good" | "watch" | "attention" | "unknown";

export interface HealthDimensionResult {
  key: HealthDimensionKey;
  label: string;
  score: number; // 0-100, this dimension only
  status: HealthDimensionStatus;
  // One line explaining *why* — the single positive/negative finding with
  // the largest |scoreImpact| in this dimension, or an honest "nothing
  // notable" default when nothing fired.
  summary: string;
  // A short next step for the dominant *negative* finding, or null when
  // there's nothing to act on (the dimension is clean, or has no evidence
  // at all) — never a manufactured task out of good news. See
  // health-score.ts's recommendedActionFor.
  recommendedAction: string | null;
  breakdown: HealthBreakdownEntry[];
}

export type HealthConfidenceLevel = "high" | "medium" | "low";

export interface HealthConfidence {
  level: HealthConfidenceLevel;
  // Only set for medium/low — high confidence needs no caveat.
  reason?: string;
}

export interface HealthScoreResult {
  score: number;
  rating: HealthRating;
  confidence: HealthConfidence;
  dimensions: HealthDimensionResult[];
  // Flat, all-dimensions breakdown — kept for callers that want the old
  // "every finding, one list" view (e.g. a full audit trail) rather than
  // the new per-dimension grouping.
  breakdown: HealthBreakdownEntry[];
}
