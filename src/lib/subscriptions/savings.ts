import type { Subscription, RealizedSavingsRecord } from "@/lib/db/schema";
import { monthlyCents, annualCents, formatCents, splitByPrimaryCurrency } from "./money";
import { forEachLikelyDuplicatePair, computeFunctionalOverlapGroups, findSmallSubscriptionsCluster, smallSubscriptionsClusterTitle } from "./insights";
import { findStaleSubscriptions } from "./staleness";

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
export type SavingsRecommendationType = "duplicate" | "functional_overlap" | "small_subscriptions" | "stale";

// Phase 8: "confirmed" is deterministic name-match evidence (the only type
// this file ever credits with a real monthlySavingsCents); "review" means
// real data supports *looking into it*, not that money is provably on the
// table (functional overlap, several small subscriptions adding up, or a
// subscription nobody has reviewed in a long time).
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
  // The true annual figure for a "duplicate" recommendation, computed via
  // annualCents(b.amountCents, b.billingCycle) directly from the redundant
  // subscription — NOT monthlySavingsCents * 12. monthlySavingsCents is
  // already monthlyCents()-rounded (a real rounding step for yearly/
  // quarterly/weekly cycles, e.g. a $99.99/yr redundant subscription
  // rounds to 833 cents/mo); multiplying that back by 12 would give $99.96,
  // not the real $99.99. 0 for functional_overlap/small_subscriptions, same
  // as monthlySavingsCents, for the same "not a proven saving" reason.
  annualSavingsCents: number;
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
  // Currency monthlySavingsCents/impactCents are denominated in. For
  // "duplicate" this is the target (redundant) subscription's own currency;
  // for "functional_overlap"/"small_subscriptions" it's the group/cluster's
  // single shared currency (both already refuse to form a mixed-currency
  // group — see computeFunctionalOverlapGroups/findSmallSubscriptionsCluster).
  currency: string;
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
  const alreadyFlagged = new Set<string>();
  forEachLikelyDuplicatePair(active, (a, b) => {
    if (alreadyFlagged.has(b.id)) return;
    alreadyFlagged.add(b.id);

    const savings = monthlyCents(b.amountCents, b.billingCycle);
    const annualSavings = annualCents(b.amountCents, b.billingCycle);
    // Identical raw names (not just namesLikelyMatch's fuzzy sense — two
    // subscriptions both literally called "Netflix") produce "Netflix and
    // Netflix look like duplicates" if the two names are just concatenated
    // — reads like generated copy that never accounted for its own most
    // common case. Renewal date is real, already-stored data (not a
    // fabricated distinguisher) and is what actually tells the two apart
    // in the description below, the same way the badge next to each row
    // in the list already does.
    const sameName = a.name === b.name;
    recommendations.push({
      id: `duplicate-${a.id}-${b.id}`,
      type: "duplicate",
      title: sameName
        ? `Two ${a.name} subscriptions look like duplicates`
        : `${a.name} and ${b.name} look like duplicates`,
      description: sameName
        ? `These look like the same service — one renews ${a.nextRenewalDate}, the other ${b.nextRenewalDate}. If the one renewing ${b.nextRenewalDate} is the stale one, canceling it saves you money every month.`
        : `These look like the same service. If ${b.name} is the stale one, canceling it saves you money every month.`,
      actionLabel: `Review ${b.name}`,
      monthlySavingsCents: savings,
      annualSavingsCents: annualSavings,
      impactCents: savings,
      evidenceTier: "confirmed",
      urgencyDays: soonestUrgencyDays([a, b], todayIso),
      targetSubscriptionId: b.id,
      involvedSubscriptionIds: [a.id, b.id],
      currency: b.currency,
    });
  });

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
  for (const { label, subscriptions: subs, combinedMonthlyCents, currency } of computeFunctionalOverlapGroups(active)) {
    const priciest = [...subs].sort(
      (a, b) => monthlyCents(b.amountCents, b.billingCycle) - monthlyCents(a.amountCents, a.billingCycle),
    )[0];
    const verb = subs.length === 2 ? "Both provide" : "These all provide";
    const needAllOf = subs.length === 2 ? "both" : "all of them";
    recommendations.push({
      id: `overlap-${subs.map((s) => s.id).sort().join("-")}`,
      type: "functional_overlap",
      title: subs.map((s) => s.name).join(" + "),
      description: `${verb} ${label.toLowerCase()} functionality. ${formatCents(combinedMonthlyCents, currency)}/mo combined. If you primarily use one, review whether you need ${needAllOf}.`,
      actionLabel: `Review ${priciest.name}`,
      monthlySavingsCents: 0,
      annualSavingsCents: 0,
      impactCents: combinedMonthlyCents,
      evidenceTier: "review",
      urgencyDays: soonestUrgencyDays(subs, todayIso),
      targetSubscriptionId: priciest.id,
      involvedSubscriptionIds: subs.map((s) => s.id),
      currency,
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
      annualSavingsCents: 0,
      impactCents: smallCluster.combinedMonthlyCents,
      evidenceTier: "review",
      urgencyDays: soonestUrgencyDays(smallCluster.subscriptions, todayIso),
      targetSubscriptionId: priciest.id,
      involvedSubscriptionIds: smallCluster.subscriptions.map((s) => s.id),
      currency: smallCluster.currency,
    });
  }

  // 4. Stale — never reviewed, or not reviewed in a long time (see
  // staleness.ts's own STALE_THRESHOLD_DAYS comment). Same "review, not a
  // proven saving" tier as functional overlap/small subscriptions: nobody
  // having looked at a subscription in 4+ months doesn't prove it's
  // unwanted, only that it's worth a quick "still using this?" check —
  // this app has no usage data to claim more than that. One recommendation
  // per stale subscription (not grouped, unlike overlap/small-subscription
  // clusters) since each is its own independent thing to individually
  // decide on, not a collective pattern.
  for (const { subscription, daysSinceReviewed, everReviewed } of findStaleSubscriptions(active, new Date(`${todayIso}T00:00:00Z`).getTime())) {
    const monthly = monthlyCents(subscription.amountCents, subscription.billingCycle);
    recommendations.push({
      id: `stale-${subscription.id}`,
      type: "stale",
      title: `Still using ${subscription.name}?`,
      description: everReviewed
        ? `You haven't reviewed this in ${daysSinceReviewed} days. It costs ${formatCents(monthly, subscription.currency)}/mo — worth a quick check before it renews again.`
        : `Added ${daysSinceReviewed} days ago and never reviewed. It costs ${formatCents(monthly, subscription.currency)}/mo — worth a quick check before it renews again.`,
      actionLabel: `Review ${subscription.name}`,
      monthlySavingsCents: 0,
      annualSavingsCents: 0,
      impactCents: monthly,
      evidenceTier: "review",
      urgencyDays: daysUntil(subscription.nextRenewalDate, todayIso),
      targetSubscriptionId: subscription.id,
      involvedSubscriptionIds: [subscription.id],
      currency: subscription.currency,
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
      // impactCents is only comparable when both recommendations share a
      // currency — this app has no exchange rate, so raw cents from two
      // different currencies is not a real magnitude comparison, the same
      // "never sum/compare cents across currencies" rule
      // sumMonthlyCentsIfSingleCurrency/splitByPrimaryCurrency already
      // follow elsewhere (release-review finding #5: a £20/mo GBP finding
      // used to outrank an $18/mo USD one purely because 2000 > 1800 in raw
      // cents). A cross-currency pair ties here and falls through to
      // urgencyDays instead of a fabricated ranking.
      (a.currency === b.currency ? b.impactCents - a.impactCents : 0) ||
      a.urgencyDays - b.urgencyDays,
  );
}

// Shared by computeTotalPotentialSavingsMonthlyCents/YearlyCents below:
// every "duplicate" recommendation, each distinct redundant subscription
// counted at most once (same identity rule as insights.ts's
// computePotentialSavingsMonthlyCents — a subscription flagged as the
// redundant half of more than one pair doesn't get double-counted),
// restricted to active's primary currency. Deduping before restricting to
// the primary currency (not after) means a popular duplicate target
// appearing in multiple pairs can't inflate its own currency's count more
// than once.
//
// Release-review follow-up finding: this dedup used to sum
// monthlySavingsCents/annualSavingsCents straight across every recommendation
// regardless of currency — each recommendation's own `currency` field
// comment already documents that summing raw cents across currencies is
// fabricated math (the same rule sumMonthlyCentsIfSingleCurrency/
// splitByPrimaryCurrency/the impactCents tiebreak above already follow),
// but neither total actually applied it. A GBP duplicate's savings could
// silently inflate a USD-denominated total (or vice versa) by however many
// raw cents the other currency's pair happened to be worth.
function primaryCurrencyDuplicateRecommendations(recommendations: SavingsRecommendation[]): SavingsRecommendation[] {
  const countedIds = new Set<string>();
  const deduped: SavingsRecommendation[] = [];
  for (const rec of recommendations) {
    if (rec.type !== "duplicate") continue;
    if (countedIds.has(rec.targetSubscriptionId)) continue;
    countedIds.add(rec.targetSubscriptionId);
    deduped.push(rec);
  }
  return splitByPrimaryCurrency(deduped).included;
}

export function computeTotalPotentialSavingsMonthlyCents(recommendations: SavingsRecommendation[]): number {
  return primaryCurrencyDuplicateRecommendations(recommendations).reduce(
    (sum, rec) => sum + rec.monthlySavingsCents,
    0,
  );
}

// Same currency-safe, identity-deduped set as computeTotalPotentialSavingsMonthlyCents
// above, but sums each recommendation's own annualSavingsCents rather than
// scaling the monthly total by 12 (release-review finding #4: engine.ts
// used to compute `monthlySavingsCents * 12`, double-rounding on top of
// monthlySavingsCents' own monthlyCents() rounding for yearly/quarterly/
// weekly redundant subscriptions — a $99.99/yr duplicate reported as
// $99.96/yr instead of the real $99.99).
export function computeTotalPotentialSavingsYearlyCents(recommendations: SavingsRecommendation[]): number {
  return primaryCurrencyDuplicateRecommendations(recommendations).reduce(
    (sum, rec) => sum + rec.annualSavingsCents,
    0,
  );
}

// Retention pass: a caller that needs the currency this total is actually
// denominated in (weekly-digest-job.ts's own digest, which has no other
// reliable way to know it) — deliberately NOT re-derived by calling
// splitByPrimaryCurrency on the caller's own recommendation list a second
// time. primaryCurrencyDuplicateRecommendations' own dedup-by-target step
// happens BEFORE its currency selection; re-running splitByPrimaryCurrency
// on an un-deduped or differently-filtered list can pick a different
// "majority" currency at the edges (e.g. a duplicate pair whose two raw
// rows both count before dedup but only one counts after), which would
// silently mislabel this exact total's currency. Reusing the one already-
// correct code path both narrow totals above already call is what
// guarantees this can never happen.
export function computeTotalPotentialSavings(recommendations: SavingsRecommendation[]): {
  monthlyCents: number;
  yearlyCents: number;
  currency: string | null;
} {
  const counted = primaryCurrencyDuplicateRecommendations(recommendations);
  return {
    monthlyCents: counted.reduce((sum, rec) => sum + rec.monthlySavingsCents, 0),
    yearlyCents: counted.reduce((sum, rec) => sum + rec.annualSavingsCents, 0),
    currency: counted[0]?.currency ?? null,
  };
}

// The other half of "potential vs. actually happened" — everything above
// this point in the file answers "what could you save"; this answers "what
// have you actually stopped paying for." Phase 8 Intelligence, opportunity
// #2: reads from the persisted `realizedSavings` ledger (schema.ts —
// queries.ts's getRealizedSavings), NOT from a live scan of
// `subscriptions WHERE status = 'canceled'` the way this function used to
// work. Every row it's given is already a snapshot taken at the exact
// moment a subscription was genuinely canceled (see schema.ts's own header
// comment on `realizedSavings` for the full write-side reasoning); editing
// or deleting that subscription afterward cannot change or erase what this
// function reports, by construction, not by convention this function has to
// re-enforce itself.
//
// Deliberately NOT called "confirmed savings" anywhere in this app's UI —
// "confirmed" already means something specific and different here
// (SavingsCard/SavingsOpportunitiesCard use "confirmed duplicates" to mean
// "deterministic name match, not a fuzzy AI guess"). A second, differently-
// defined "confirmed ___" figure on the same product would conflate two
// concepts a user has no way to tell apart from the word alone. Callers
// should use "realized" / "money saved" in copy instead.
//
// Two things this number stays honest about, on purpose:
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
//   all null when the ledger spans more than one currency — an honest gap,
//   not a wrong number — leaving canceledCount (currency-independent) as
//   the only thing still shown in that case.
export interface RealizedSavings {
  monthlyCents: number | null;
  yearlyCents: number | null;
  currency: string | null;
  canceledCount: number;
}

export function computeRealizedSavings(records: RealizedSavingsRecord[]): RealizedSavings {
  if (records.length === 0) return { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 0 };

  // Case-insensitive on purpose (CodeRabbit review, originally against this
  // function's own live-scan predecessor) — validation.ts already lowercases
  // currency for every subscription created/edited through the app's own
  // form, so this is defense-in-depth rather than a reachable bug today, but
  // this function's whole job is refusing to silently sum mismatched
  // currencies; comparing "usd" and "USD" as different ones would produce
  // exactly the false "mixed currency, no total" gap this function exists
  // to avoid.
  const currency = records[0].currency.toLowerCase();
  const singleCurrency = records.every((r) => r.currency.toLowerCase() === currency);
  if (!singleCurrency) return { monthlyCents: null, yearlyCents: null, currency: null, canceledCount: records.length };

  const totalMonthlyCents = records.reduce((sum, r) => sum + monthlyCents(r.amountCents, r.billingCycle), 0);
  // Not totalMonthlyCents * 12 — see money.ts's own annualCents comment.
  const totalYearlyCents = records.reduce((sum, r) => sum + annualCents(r.amountCents, r.billingCycle), 0);
  return { monthlyCents: totalMonthlyCents, yearlyCents: totalYearlyCents, currency, canceledCount: records.length };
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

// Monetization Council P0: "gate savings-opportunity list depth by plan."
//
// Every "confirmed" recommendation (evidenceTier === "confirmed", which
// today only ever means a deterministic duplicate-name match — see this
// file's own header comment) is ALWAYS fully visible, on principle, for
// every plan. This app's own duplicate-detection promise ("you're not
// paying twice for the same thing") is never behind a paywall anywhere
// else in the product (health.duplicates, the dashboard's own duplicate
// check callout, and the /subscriptions list's own duplicate badges are
// all free and ungated) — gating it here specifically, on this one list,
// while leaving it free everywhere else, wouldn't be a real restriction,
// it would just be an inconsistency a user could route around by looking
// at a different page. So there is nothing to gate: only "review"-tier
// findings (functional_overlap, small_subscriptions — plausible, not
// proof) are ever withheld, and only beyond the single highest-priority
// one, which stays visible so a free-plan user still sees a real,
// specific example of what the review tier looks like.
//
// `teased` deliberately mirrors the "amount honestly involved, in a
// caller-checkable dollar figure" convention this file already uses for
// impactCents elsewhere — never a vague "upgrade for more" with no number
// behind it. totalCents/currency are null (not a wrong number) when the
// withheld items don't share one currency, the same "honest gap" rule
// splitByPrimaryCurrency/computeRealizedSavings already follow.
export interface SavingsTease {
  count: number;
  totalCents: number | null;
  currency: string | null;
}

export interface SavingsVisibility {
  visible: SavingsRecommendation[];
  // null exactly when nothing is being withheld — including for every
  // Premium caller, and for a Free caller whose review-tier findings all
  // already fit within the one always-visible slot.
  teased: SavingsTease | null;
}

export function splitSavingsRecommendationsByPlan(
  recommendations: SavingsRecommendation[],
  isPremium: boolean,
): SavingsVisibility {
  if (isPremium) return { visible: recommendations, teased: null };

  const reviewIds = new Set<string>();
  let reviewSeen = 0;
  for (const rec of recommendations) {
    if (rec.evidenceTier !== "review") continue;
    reviewSeen += 1;
    if (reviewSeen === 1) reviewIds.add(rec.id);
  }

  // Preserves the original relative order (the same priority order
  // computeSavingsRecommendations already sorted into) rather than
  // reordering confirmed-before-review, so a Free caller's list is a
  // strict prefix-like subset of what Premium sees, never a reshuffled one.
  const visible = recommendations.filter((rec) => rec.evidenceTier === "confirmed" || reviewIds.has(rec.id));
  const hidden = recommendations.filter((rec) => rec.evidenceTier === "review" && !reviewIds.has(rec.id));

  if (hidden.length === 0) return { visible, teased: null };

  const currency = hidden[0].currency;
  const sameCurrency = hidden.every((rec) => rec.currency === currency);
  return {
    visible,
    teased: {
      count: hidden.length,
      totalCents: sameCurrency ? hidden.reduce((sum, rec) => sum + rec.impactCents, 0) : null,
      currency: sameCurrency ? currency : null,
    },
  };
}
