import type { EngineContext } from "./types";
import { monthlyTotalCents } from "./signals";

// Distinct from health: health measures financial *wellness* (duplicates,
// concentration, clustering...), optimization measures *unrealized
// savings* as a share of current spend — 100 means nothing found to
// recover, lower means a larger fraction of spend is recoverable.
export function computeOptimizationScore(
  ctx: EngineContext,
  unrealizedYearlySavingsCents: number,
): { score: number; unrealizedYearlySavingsCents: number } | null {
  const monthlyTotal = monthlyTotalCents(ctx.active);
  if (monthlyTotal === 0) return null;

  const annualSpend = monthlyTotal * 12;
  const ratio = Math.min(unrealizedYearlySavingsCents / annualSpend, 1);
  const score = Math.round(100 - ratio * 100);
  return { score, unrealizedYearlySavingsCents };
}
