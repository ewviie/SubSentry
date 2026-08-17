import type { Subscription } from "@/lib/db/schema";
import { monthlyCents, formatCents } from "./money";
import { normalizeName, namesLikelyMatch, computeFunctionalOverlapGroups, findSmallSubscriptionsCluster, smallSubscriptionsClusterTitle } from "./insights";

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
export type SavingsRecommendationType = "duplicate" | "functional_overlap" | "small_subscriptions";

// Phase 8: "confirmed" is deterministic name-match evidence (the only type
// this file ever credits with a real monthlySavingsCents); "review" means
// real data supports *looking into it*, not that money is provably on the
// table (functional overlap, or several small subscriptions adding up).
// Drives getSavingsPriority below — a review-only finding can be "medium"
// impact if the dollar amount involved is large, but never "high": that
// label is reserved for money a cancellation would deterministically
// recover, and review-only findings never clear that bar by construction.
export type SavingsEvidenceTier = "confirmed" | "review";

export interface SavingsRecommendation {
  id: string;
  type: SavingsRecommendationType;
  title: string;
  description: string;
  actionLabel: string;
  // 0 for functional_overlap/small_subscriptions — neither is proof any
  // specific subscription is redundant (a household could genuinely use
  // multiple streaming services; several cheap subscriptions might all be
  // wanted), so this is flagged as worth a look, never credited with a
  // dollar figure it can't back up. The combined cost is still shown in the
  // description — real, known data — just not claimed as money that would
  // be saved. See impactCents below for the prioritization-only figure.
  monthlySavingsCents: number;
  // The real dollar amount actually involved in this finding, whether or
  // not it's a proven saving — equal to monthlySavingsCents for a
  // duplicate, and the combined cost of the group/cluster otherwise. Exists
  // so opportunity prioritization (getSavingsPriority, and this function's
  // own final sort) can rank "3 overlapping streaming services at $45/mo
  // combined" above "2 overlapping VPNs at $6/mo combined" without having
  // to pretend either one is a guaranteed saving to do it.
  impactCents: number;
  evidenceTier: SavingsEvidenceTier;
  // Days from today until the soonest involved subscription's next
  // renewal — negative if already overdue. A real, already-stored-data
  // urgency signal (Phase 8 Part 6's "renewal proximity" prioritization
  // input): reviewing a duplicate that's about to renew again is more
  // time-sensitive than one that won't renew for months, even at an
  // identical dollar amount.
  urgencyDays: number;
  targetSubscriptionId: string;
  involvedSubscriptionIds: string[];
}

function daysUntil(dateIso: string, todayIso: string): number {
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  const target = new Date(`${dateIso}T00:00:00Z`).getTime();
  const days = Math.round((target - today) / 86_400_000);
  // A malformed todayIso or stored date must not leak NaN into
  // urgencyDays — same guard health-score.ts's computeConfidence already
  // applies to its own date arithmetic, for the same reason: NaN would
  // silently corrupt every comparison/sort that reads this field.
  return Number.isFinite(days) ? days : 0;
}

function soonestUrgencyDays(subs: Subscription[], todayIso: string): number {
  // Every real caller passes 2+ subscriptions (a pair or group), but
  // Math.min(...[]) is Infinity, not a thrown error — guard explicitly
  // rather than let a future empty-array call site silently produce a
  // recommendation that always sorts dead last.
  if (subs.length === 0) return 0;
  return Math.min(...subs.map((s) => daysUntil(s.nextRenewalDate, todayIso)));
}

// todayIso is a parameter (not computed internally via `new Date()`, unlike
// this module's sibling insights.ts) specifically so urgencyDays stays
// deterministic and testable — every other date-sensitive function in this
// file family reads real wall-clock time internally, but none of them had a
// day-granularity ranking signal riding on it before now. Defaults to the
// real current date so both existing call sites (savings/page.tsx,
// engine.ts) keep working with zero changes.
export function computeSavingsRecommendations(
  allSubscriptions: Subscription[],
  todayIso: string = new Date().toISOString().slice(0, 10),
): SavingsRecommendation[] {
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
        impactCents: savings,
        evidenceTier: "confirmed",
        urgencyDays: soonestUrgencyDays([active[i], active[j]], todayIso),
        targetSubscriptionId: active[j].id,
        involvedSubscriptionIds: [active[i].id, active[j].id],
      });
    }
  }

  // 2. Functional overlap — category alone is too broad a redundancy signal
  // (Adobe and Dropbox are both "software" but solve nothing similar; the
  // old category_concentration check this replaces would flag any 2+
  // subscriptions sharing a category, category-agnostic to whether they
  // actually compete). This only fires when 2+ active subscriptions resolve
  // to the SAME curated functional-overlap group — see
  // computeFunctionalOverlapGroups/merchant-normalizer.ts's
  // resolveOverlapGroup for the evidence behind each group, and why most
  // merchants deliberately have no group at all (no group is the honest
  // default, never a guess). No specific subscription is provably redundant
  // even within a real group (a household could genuinely use both), so
  // this recommends reviewing the group's priciest subscription rather than
  // crediting a dollar figure no real signal supports — same convention the
  // type it replaces used.
  for (const { label, subscriptions: subs, combinedMonthlyCents } of computeFunctionalOverlapGroups(active)) {
    const priciest = [...subs].sort(
      (a, b) => monthlyCents(b.amountCents, b.billingCycle) - monthlyCents(a.amountCents, a.billingCycle),
    )[0];
    const verb = subs.length === 2 ? "Both provide" : "These all provide";
    const needAllOf = subs.length === 2 ? "both" : "all of them";
    recommendations.push({
      id: `overlap-${subs.map((s) => s.id).sort().join("-")}`,
      type: "functional_overlap",
      title: subs.map((s) => s.name).join(" + "),
      description: `${verb} ${label.toLowerCase()} functionality. ${formatCents(combinedMonthlyCents)}/mo combined. If you primarily use one, review whether you need ${needAllOf}.`,
      actionLabel: `Review ${priciest.name}`,
      monthlySavingsCents: 0,
      impactCents: combinedMonthlyCents,
      evidenceTier: "review",
      urgencyDays: soonestUrgencyDays(subs, todayIso),
      targetSubscriptionId: priciest.id,
      involvedSubscriptionIds: subs.map((s) => s.id),
    });
  }

  // 3. Small subscriptions adding up — see findSmallSubscriptionsCluster's
  // own comment for the relative-threshold evidence. Same "review, not a
  // proven saving" convention as functional overlap: nothing here says any
  // of these specific subscriptions is unwanted, only that together they're
  // a material, easy-to-miss chunk of spend. Reviewing the cluster's
  // priciest member first mirrors the overlap block above — a concrete
  // starting point rather than "go look at all 4 of these."
  const smallCluster = findSmallSubscriptionsCluster(active);
  if (smallCluster) {
    const priciest = [...smallCluster.subscriptions].sort(
      (a, b) => monthlyCents(b.amountCents, b.billingCycle) - monthlyCents(a.amountCents, a.billingCycle),
    )[0];
    recommendations.push({
      id: `small-${smallCluster.subscriptions.map((s) => s.id).sort().join("-")}`,
      type: "small_subscriptions",
      title: smallSubscriptionsClusterTitle(smallCluster),
      description: `${smallCluster.subscriptions.map((s) => s.name).join(", ")} are each well below your typical subscription cost here — but combined, they're ${Math.round(smallCluster.shareOfTotal * 100)}% of your monthly spend. Worth a look if some have gone unused.`,
      actionLabel: `Review ${priciest.name}`,
      monthlySavingsCents: 0,
      impactCents: smallCluster.combinedMonthlyCents,
      evidenceTier: "review",
      urgencyDays: soonestUrgencyDays(smallCluster.subscriptions, todayIso),
      targetSubscriptionId: priciest.id,
      involvedSubscriptionIds: smallCluster.subscriptions.map((s) => s.id),
    });
  }

  // Opportunity prioritization (Phase 8 Part 6): highest priority tier
  // first (see getSavingsPriority — evidence tier + dollar impact, not
  // dollar amount alone). Within the same tier, evidenceTier breaks the
  // tie before dollar amount — caught in local-council review (Devil's
  // Advocate lens): a "medium" review-only overlap and a "medium" confirmed
  // duplicate could otherwise land in either order, sorted purely by
  // impactCents, so a larger-but-unproven overlap could rank ahead of a
  // smaller-but-guaranteed duplicate saving with only a badge (easy to
  // miss while skimming) distinguishing them. Confirmed evidence now always
  // sorts first within a shared tier. Real dollar amount, then urgency
  // (soonest renewal first), are the final, explainable tiebreakers — never
  // a silent black-box score, every input here is a real field on the
  // recommendation itself.
  const priorityRank: Record<SavingsPriority, number> = { high: 3, medium: 2, low: 1 };
  const evidenceRank: Record<SavingsEvidenceTier, number> = { confirmed: 1, review: 0 };
  return recommendations.sort(
    (a, b) =>
      priorityRank[getSavingsPriority(b)] - priorityRank[getSavingsPriority(a)] ||
      evidenceRank[b.evidenceTier] - evidenceRank[a.evidenceTier] ||
      b.impactCents - a.impactCents ||
      a.urgencyDays - b.urgencyDays,
  );
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

  // Case-insensitive on purpose (CodeRabbit review) — validation.ts already
  // lowercases currency for every subscription created/edited through the
  // app's own form, so this is defense-in-depth rather than a reachable bug
  // today, but this function's whole job is refusing to silently sum
  // mismatched currencies; comparing "usd" and "USD" as different ones
  // would produce exactly the false "mixed currency, no total" gap this
  // function exists to avoid.
  const currency = canceled[0].currency.toLowerCase();
  const singleCurrency = canceled.every((s) => s.currency.toLowerCase() === currency);
  if (!singleCurrency) return { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: canceled.length };

  const totalMonthlyCents = canceled.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
  return { monthlyCents: totalMonthlyCents, yearlyCents: totalMonthlyCents * 12, currency, canceledCount: canceled.length };
}

export type SavingsPriority = "high" | "medium" | "low";

// Presentational bucketing, but no longer a read on monthlySavingsCents
// alone (Phase 8 Part 6 — "do not simply sort by dollar amount," and
// crucially, a review-only finding's monthlySavingsCents is always 0 by
// design, which used to bucket every functional_overlap/small_subscriptions
// finding as "low" regardless of how much money was actually involved: a
// $60/mo three-way streaming overlap read identically to a $2/mo VPN one).
// Now reads impactCents (the real dollar amount involved, proven or not)
// together with evidenceTier:
// - "high" is reserved for confirmed, deterministic-match savings above the
//   threshold — money a cancellation would actually recover.
// - review-only findings (functional_overlap, small_subscriptions) can
//   reach "medium" when the amount involved is large, but never "high" —
//   that label would overstate certainty this evidence tier doesn't have.
// - anything with $0 genuinely involved is "low" regardless of tier.
const HIGH_IMPACT_THRESHOLD_CENTS = 1500; // $15/mo

export function getSavingsPriority(recommendation: SavingsRecommendation): SavingsPriority {
  if (recommendation.impactCents <= 0) return "low";
  if (recommendation.evidenceTier === "confirmed") {
    return recommendation.impactCents >= HIGH_IMPACT_THRESHOLD_CENTS ? "high" : "medium";
  }
  return recommendation.impactCents >= HIGH_IMPACT_THRESHOLD_CENTS ? "medium" : "low";
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
