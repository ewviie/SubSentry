import type { Subscription } from "@/lib/db/schema";
import { monthlyCents, formatCents } from "./money";
import { normalizeName, levenshtein } from "./insights";
import { CATEGORY_LABELS } from "./labels";

// A dedicated, actionable savings engine — distinct from insights.ts's
// dashboard-summary cards (which surface one headline number + a link to
// "the first" duplicate). This computes every real opportunity, each with
// its own recommended action and a specific subscription to act on, for the
// standalone /savings page. Reuses insights.ts's normalizeName/levenshtein
// primitives rather than re-deriving fuzzy-match logic a second time.
//
// Same "deterministic, not fabricated" rule insights.ts already follows:
// every dollar figure here comes from a real pairwise duplicate match, never
// a guessed "you could probably save X%" estimate with no data behind it.
export type SavingsRecommendationType = "duplicate" | "category_concentration";

export interface SavingsRecommendation {
  id: string;
  type: SavingsRecommendationType;
  title: string;
  description: string;
  actionLabel: string;
  // 0 for category_concentration — clustering isn't proof of redundancy,
  // so it's flagged as worth a look, not credited with a dollar figure it
  // can't back up.
  monthlySavingsCents: number;
  targetSubscriptionId: string;
  involvedSubscriptionIds: string[];
}

function namesLikelyMatch(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 4 && normB.length >= 4 && (normA.includes(normB) || normB.includes(normA))) {
    return true;
  }
  if (Math.abs(normA.length - normB.length) > 2) return false;
  return levenshtein(normA, normB) <= 2;
}

export function computeSavingsRecommendations(allSubscriptions: Subscription[]): SavingsRecommendation[] {
  const active = allSubscriptions.filter((s) => s.status === "active");
  const recommendations: SavingsRecommendation[] = [];

  // 1. Duplicates — same identity rule as insights.ts's possible_overlap:
  // the second (redundant) half of each matching pair is the recommended
  // cancel target, credited with its own monthly cost as the savings.
  const normalizedNames = active.map((s) => normalizeName(s.name));
  const alreadyFlagged = new Set<string>();
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (!namesLikelyMatch(normalizedNames[i], normalizedNames[j])) continue;
      if (alreadyFlagged.has(active[j].id)) continue;
      alreadyFlagged.add(active[j].id);

      const savings = monthlyCents(active[j].amountCents, active[j].billingCycle);
      recommendations.push({
        id: `duplicate-${active[i].id}-${active[j].id}`,
        type: "duplicate",
        title: `${active[i].name} and ${active[j].name} look like duplicates`,
        description: `These look like the same service. If ${active[j].name} is the stale one, canceling it saves you money every month.`,
        actionLabel: `Review ${active[j].name}`,
        monthlySavingsCents: savings,
        targetSubscriptionId: active[j].id,
        involvedSubscriptionIds: [active[i].id, active[j].id],
      });
    }
  }

  // 2. Category concentration — no specific subscription is provably
  // redundant, so this recommends reviewing the category's single most
  // expensive subscription (the biggest opportunity *if* something in this
  // cluster turns out to be cuttable) rather than crediting a dollar figure
  // no real signal supports.
  const byCategory = new Map<Subscription["category"], Subscription[]>();
  for (const s of active) {
    byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);
  }
  for (const [category, subs] of byCategory) {
    if (subs.length < 2) continue;
    const priciest = [...subs].sort(
      (a, b) => monthlyCents(b.amountCents, b.billingCycle) - monthlyCents(a.amountCents, a.billingCycle),
    )[0];
    const combined = subs.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
    recommendations.push({
      id: `category-${category}`,
      type: "category_concentration",
      title: `${subs.length} active ${CATEGORY_LABELS[category].toLowerCase()} subscriptions`,
      description: `${subs.map((s) => s.name).join(", ")}: ${formatCents(combined)} combined per month. Worth checking whether you need all of them.`,
      actionLabel: `Review ${priciest.name}`,
      monthlySavingsCents: 0,
      targetSubscriptionId: priciest.id,
      involvedSubscriptionIds: subs.map((s) => s.id),
    });
  }

  return recommendations.sort((a, b) => b.monthlySavingsCents - a.monthlySavingsCents);
}

// Same identity rule as insights.ts's computePotentialSavingsMonthlyCents:
// each distinct redundant subscription counted at most once, even if it
// shows up as the redundant half of more than one duplicate pair.
export function computeTotalPotentialSavingsMonthlyCents(recommendations: SavingsRecommendation[]): number {
  const countedIds = new Set<string>();
  let total = 0;
  for (const rec of recommendations) {
    if (rec.type !== "duplicate") continue;
    if (countedIds.has(rec.targetSubscriptionId)) continue;
    countedIds.add(rec.targetSubscriptionId);
    total += rec.monthlySavingsCents;
  }
  return total;
}

export type SavingsPriority = "high" | "medium" | "low";

// Presentational bucketing only — no new data, just a threshold read on the
// same monthlySavingsCents this module already computes deterministically.
// category_concentration recommendations are always $0 (see the file-header
// comment on why: clustering isn't proof of redundancy) and always bucket
// to "low" as a result — that's intentional, not a missing case: a $0
// recommendation is "worth a look," never "high impact."
const HIGH_IMPACT_THRESHOLD_CENTS = 1500; // $15/mo

export function getSavingsPriority(recommendation: SavingsRecommendation): SavingsPriority {
  if (recommendation.monthlySavingsCents >= HIGH_IMPACT_THRESHOLD_CENTS) return "high";
  if (recommendation.monthlySavingsCents > 0) return "medium";
  return "low";
}

// Shared label/variant lookup for priority badges — lives here (not in the
// "use client" SavingsRecommendationCard) so Server Components can import
// it directly. A Server Component importing a plain constant from a "use
// client" module crosses the RSC client-boundary and silently resolves to
// undefined at render time instead of erroring, which is exactly what
// happened when insight-panels.tsx (server) first imported these from
// savings-recommendation-card.tsx (client): the badges rendered as empty
// pills. "success"/"secondary"/"outline" reuse existing Badge variants —
// "high" reuses the same green as every other positive-money signal in the
// app (the emerald brand accent), not a new bespoke color.
export const PRIORITY_LABEL = { high: "High impact", medium: "Medium impact", low: "Worth a look" } as const;
export const PRIORITY_BADGE_VARIANT = { high: "success", medium: "secondary", low: "outline" } as const;
