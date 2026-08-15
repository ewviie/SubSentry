import type { Subscription } from "@/lib/db/schema";
import { monthlyCents, formatCents } from "./money";
import { normalizeName, namesLikelyMatch } from "./insights";
import { CATEGORY_LABELS } from "./labels";

// A dedicated, actionable savings engine — distinct from insights.ts's
// dashboard-summary cards (which surface one headline number + a link to
// "the first" duplicate). This computes every real opportunity, each with
// its own recommended action and a specific subscription to act on, for the
// standalone /savings page. Reuses insights.ts's normalizeName/
// namesLikelyMatch primitives rather than re-deriving fuzzy-match logic a
// second time — the two used to keep separate, byte-for-byte-identical
// copies of the matching function; see namesLikelyMatch's own comment in
// insights.ts for why that was a real (not just untidy) risk.
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
      // Identical raw names (not just namesLikelyMatch's fuzzy sense — two
      // subscriptions both literally called "Netflix") produce "Netflix and
      // Netflix look like duplicates" if the two names are just concatenated
      // — reads like generated copy that never accounted for its own most
      // common case. Renewal date is real, already-stored data (not a
      // fabricated distinguisher) and is what actually tells the two apart
      // in the description below, the same way the badge next to each row
      // in the list already does.
      const sameName = active[i].name === active[j].name;
      recommendations.push({
        id: `duplicate-${active[i].id}-${active[j].id}`,
        type: "duplicate",
        title: sameName
          ? `Two ${active[i].name} subscriptions look like duplicates`
          : `${active[i].name} and ${active[j].name} look like duplicates`,
        description: sameName
          ? `These look like the same service — one renews ${active[i].nextRenewalDate}, the other ${active[j].nextRenewalDate}. If the one renewing ${active[j].nextRenewalDate} is the stale one, canceling it saves you money every month.`
          : `These look like the same service. If ${active[j].name} is the stale one, canceling it saves you money every month.`,
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

// The other half of "potential vs. actually happened" — everything above
// this point in the file answers "what could you save"; this answers "what
// have you actually stopped paying for." A canceled subscription's row is
// never deleted on cancel (only status flips — see queries.ts's
// updateSubscription; deleteSubscription is a separate, explicit action),
// so its amountCents/billingCycle are still real, readable data, not
// something this needs a new table to compute.
//
// Deliberately NOT called "confirmed savings" anywhere in this app's UI —
// "confirmed" already means something specific and different here
// (SavingsCard/SavingsOpportunitiesCard use "confirmed duplicates" to mean
// "deterministic name match, not a fuzzy AI guess"). A second, differently-
// defined "confirmed ___" figure on the same product would conflate two
// concepts a user has no way to tell apart from the word alone. Callers
// should use "realized" / "money saved" in copy instead.
//
// Three things this number is honest about, on purpose:
// - It's a live read of current status, not a ledger. Deleting a canceled
//   subscription (the existing "danger zone" action) removes it from this
//   total too, same as it removes everything else about that row — callers
//   should say so in the surrounding copy rather than let the number
//   silently drop with no explanation.
// - It counts "you marked this canceled in SubSentry," not "SubSentry
//   verified you stopped paying the merchant" (no billing-API integration
//   exists to confirm that, and Phase 6's cancellation guidance is explicit
//   that this app never claims to cancel anything). Copy should describe
//   the user's own action ("subscriptions you've canceled"), never imply
//   SubSentry itself produced the saving.
// - Same "never sum across currencies" rule money.ts's
//   sumMonthlyCentsIfSingleCurrency already enforces for the import-review
//   total: currency is unvalidated free text on this schema (any two
//   canceled subscriptions could genuinely be in different currencies), and
//   adding raw cents across currencies together would produce a number
//   wearing a real one's formatting. monthlyCents/yearlyCents/currency are
//   all null when the canceled set spans more than one currency — an honest
//   gap, not a wrong number — leaving canceledCount (currency-independent)
//   as the only thing still shown in that case.
export interface RealizedSavings {
  monthlyCents: number | null;
  yearlyCents: number | null;
  currency: string | null;
  canceledCount: number;
}

export function computeRealizedSavings(allSubscriptions: Subscription[]): RealizedSavings {
  const canceled = allSubscriptions.filter((s) => s.status === "canceled");
  if (canceled.length === 0) return { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 0 };

  const currency = canceled[0].currency;
  const singleCurrency = canceled.every((s) => s.currency === currency);
  if (!singleCurrency) return { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: canceled.length };

  const totalMonthlyCents = canceled.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
  return { monthlyCents: totalMonthlyCents, yearlyCents: totalMonthlyCents * 12, currency, canceledCount: canceled.length };
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
