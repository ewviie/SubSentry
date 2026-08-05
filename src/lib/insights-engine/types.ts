import type { Subscription } from "@/lib/db/schema";

// Reusable across the dashboard, /savings, /analytics, and future premium
// surfaces — a rule never touches the DB or React; it's a pure function of
// EngineContext. New checks are added by pushing a rule into rules/*.ts,
// never by editing engine.ts.
export interface EngineContext {
  subscriptions: Subscription[]; // all, any status
  active: Subscription[]; // status === "active", precomputed once for every rule
  todayIso: string; // YYYY-MM-DD
  isPremium: boolean;
}

export type InsightSeverity = "positive" | "info" | "warning" | "critical";
export type InsightCategory = "health" | "cost" | "renewals" | "optimization" | "usage";

export interface InsightResult {
  ruleId: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  category: InsightCategory;
  premium: boolean;
  subscriptionIds: string[];
  // Only set on category:"health" rules — the signed contribution this
  // finding makes to the 0-100 health score. Every other category leaves
  // this undefined; they inform, they don't score.
  scoreImpact?: number;
  monthlySavingsCents?: number;
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

export interface HealthScoreResult {
  score: number;
  rating: HealthRating;
  breakdown: HealthBreakdownEntry[];
}
