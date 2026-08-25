import type { Subscription } from "@/lib/db/schema";
import { monthlyCents, annualCents, formatCents, splitByPrimaryCurrency } from "./money";
import { CATEGORY_LABELS } from "./labels";
import { resolveOverlapGroup, type OverlapGroup } from "@/lib/imports/merchant-normalizer";

export type InsightType =
  | "expensive_category"
  | "overdue_renewal"
  | "high_yearly_spend"
  | "possible_overlap";

export interface ComputedInsight {
  type: InsightType;
  title: string;
  description: string;
  severity: "info" | "warning";
  subscriptionIds: string[];
  // Only set on possible_overlap insights that identify a specific
  // subscription as the actionable "cancel this one" candidate — the
  // same-category "N subscriptions in this category" variant below doesn't
  // recommend which one to cancel, so it's never attached there. Keeps the
  // aggregate savings figure traceable to a genuine, specific opportunity
  // rather than a guess.
  potentialSavingsMonthlyCents?: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Two subscription names count as a likely duplicate if, once lowercased
// and stripped of punctuation/whitespace, one contains the other (catches
// "Netflix" vs "Netflix Premium", "Disney+" vs "disney plus"-ish variants)
// or they're within a small edit distance of each other.
//
// Exported for reuse by src/lib/imports/merchant-normalizer.ts, which needs
// the same edit-distance primitive but NOT this exact matching threshold —
// raw bank-statement merchant strings ("SQ *SPOTIFY 858-402-1234 CA") need an
// aggressive noise-stripping pass before edit distance is meaningful, which
// this function was never designed for (it's tuned for comparing two already
// clean, user-typed subscription names). The importer writes its own
// stripping + matching logic and imports only the low-level primitives below.
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Takes already-normalized names — computeInsights() normalizes each active
// subscription's name once, outside the O(n²) comparison loop below, rather
// than recomputing it on every pair.
//
// Exported so savings.ts's computeSavingsRecommendations can use the exact
// same identity rule instead of maintaining its own copy of this function.
// The two used to be byte-for-byte duplicated across both files — real risk,
// not just untidy: the dashboard hero card's "confirmed duplicates" total
// (computePotentialSavingsMonthlyCents, this file), the Savings-opportunities
// card, and the Optimization score (savings.ts, via this shared function)
// all depend on agreeing on what counts as a duplicate. A future tweak to
// the matching threshold in one copy and not the other would silently
// reintroduce the exact "two different numbers for the same thing"
// inconsistency already fixed once on the dashboard hero card.
export function namesLikelyMatch(normA: string, normB: string): boolean {
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.length >= 4 && normB.length >= 4 && (normA.includes(normB) || normB.includes(normA))) {
    return true;
  }
  // Edit distance is always >= the length difference, so anything more than
  // 2 apart can never pass the <= 2 threshold below — skip the O(n*m)
  // levenshtein computation entirely for those pairs.
  if (Math.abs(normA.length - normB.length) > 2) return false;
  return levenshtein(normA, normB) <= 2;
}

// Defensive ceiling on the O(n²) fuzzy name-matching pass specifically —
// distinct from MAX_ACTIVE_SUBSCRIPTIONS (2000, lib/billing/plan.ts's
// storage/create-time ceiling). That limit bounds how many rows an account
// can ever have; this bounds how many of those rows this specific quadratic
// comparison runs over on every dashboard/insights/savings computation.
// Benchmarked directly: 2000 active subscriptions with worst-case (uniform
// length, so namesLikelyMatch's length-difference short-circuit never
// fires) names took 30+ seconds of blocking CPU time for a single pass —
// and this comparison runs independently up to four times per page load
// (this file's own duplicate/functional-overlap passes, savings.ts, and
// insights-engine/signals.ts each iterate it separately). That's a real,
// reachable CPU-exhaustion DoS an authenticated user can trigger just by
// holding a large subscription list — no attack tooling required. No
// legitimate user tracks anywhere near this many (see plan.ts's own
// comment on MAX_ACTIVE_SUBSCRIPTIONS); comparisons beyond the cap are
// simply skipped, so duplicate detection degrades gracefully instead of
// the app hanging.
export const MAX_DUPLICATE_COMPARISON_SUBSCRIPTIONS = 300;

// Shared O(n²)-bounded pair iterator for fuzzy name-duplicate detection —
// used by this file's own possible_overlap/functional-overlap passes,
// savings.ts's duplicate recommendation, and
// insights-engine/signals.ts's findDuplicates, so the cap above and the
// nested-loop shape live in exactly one place instead of four copies of
// the same logic drifting independently.
export function forEachLikelyDuplicatePair(
  active: Subscription[],
  callback: (a: Subscription, b: Subscription) => void,
): void {
  const bounded =
    active.length > MAX_DUPLICATE_COMPARISON_SUBSCRIPTIONS
      ? active.slice(0, MAX_DUPLICATE_COMPARISON_SUBSCRIPTIONS)
      : active;
  const normalized = bounded.map((s) => normalizeName(s.name));
  for (let i = 0; i < bounded.length; i++) {
    for (let j = i + 1; j < bounded.length; j++) {
      if (namesLikelyMatch(normalized[i], normalized[j])) callback(bounded[i], bounded[j]);
    }
  }
}

// All detection here is deterministic — plain computation over data already
// in Postgres, not an LLM call. See src/lib/ai/provider.ts's narrateInsights
// for the optional layer that turns these into looser prose; the detection
// itself stays instant, free, and 100% reproducible regardless of whether
// that optional step runs.
export function computeInsights(allSubscriptions: Subscription[]): ComputedInsight[] {
  const insights: ComputedInsight[] = [];
  const active = allSubscriptions.filter((s) => s.status === "active");
  if (active.length === 0) return insights;

  // Restricted to active's primary currency (splitByPrimaryCurrency) —
  // summing raw cents across currencies into one "% of monthly spend"
  // figure would be fabricated math (currency is unvalidated free text on
  // this schema). A subscription in a non-primary currency simply doesn't
  // participate in this signal, same disposition as
  // computeFunctionalOverlapGroups/findSmallSubscriptionsCluster below.
  const { currency: primaryCurrency, included: primaryActive } = splitByPrimaryCurrency(active);
  const monthlyTotal = primaryActive.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);

  // 1. Expensive category — one category eating an outsized share of spend.
  if (monthlyTotal > 0 && primaryCurrency) {
    const byCategory = new Map<Subscription["category"], { cents: number; ids: string[] }>();
    for (const s of primaryActive) {
      const entry = byCategory.get(s.category) ?? { cents: 0, ids: [] };
      entry.cents += monthlyCents(s.amountCents, s.billingCycle);
      entry.ids.push(s.id);
      byCategory.set(s.category, entry);
    }
    const [topCategory, topEntry] = Array.from(byCategory.entries()).sort(
      (a, b) => b[1].cents - a[1].cents,
    )[0];
    const share = topEntry.cents / monthlyTotal;
    if (byCategory.size > 1 && share >= 0.4) {
      insights.push({
        type: "expensive_category",
        title: `${CATEGORY_LABELS[topCategory]} is your biggest expense`,
        description: `${CATEGORY_LABELS[topCategory]} makes up ${Math.round(share * 100)}% of your monthly spend (${formatCents(topEntry.cents, primaryCurrency)}/mo). Worth a look if that's higher than expected.`,
        severity: "info",
        subscriptionIds: topEntry.ids,
      });
    }
  }

  // 2. Overdue renewal — active subscription whose renewal date has passed,
  // suggesting it was cancelled elsewhere or the date was never updated.
  // One card per subscription used to mean 2 overdue subscriptions produced
  // 2 nearly-identical cards side by side — real duplication, not just a
  // visual density problem. A single subscription still gets its own
  // specific, more useful phrasing; 2+ get one combined card so the section
  // doesn't repeat the same sentence with the name swapped out.
  const today = todayISO();
  const overdue = active.filter((s) => s.nextRenewalDate < today);
  if (overdue.length === 1) {
    const s = overdue[0];
    insights.push({
      type: "overdue_renewal",
      title: `${s.name}'s renewal date has passed`,
      description: `${s.name} was due to renew on ${s.nextRenewalDate}. If it's still active, update the date. If not, mark it canceled.`,
      severity: "warning",
      subscriptionIds: [s.id],
    });
  } else if (overdue.length > 1) {
    const names = overdue.map((s) => s.name);
    const namesList =
      names.length > 3 ? `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more` : names.join(", ");
    insights.push({
      type: "overdue_renewal",
      title: `${overdue.length} subscriptions have overdue renewals`,
      description: `${namesList} were due to renew but the date hasn't been updated. If they're still active, update the dates. If not, mark them canceled.`,
      severity: "warning",
      subscriptionIds: overdue.map((s) => s.id),
    });
  }

  // 3. High yearly spend — subscriptions costing meaningfully more than a
  // typical subscription for this user (relative outlier, not a fixed
  // dollar threshold, so it scales with each user's own spending level).
  // Restricted to primaryActive — "2x the mean" only means something when
  // every figure compared is the same currency (same rationale as
  // signals.ts's findExpensiveOutliers, which this insight independently
  // duplicates for the free-tier /insights surface).
  if (primaryActive.length >= 2) {
    const annualCosts = primaryActive.map((s) => ({
      sub: s,
      annual: annualCents(s.amountCents, s.billingCycle),
    }));
    const meanAnnual = annualCosts.reduce((sum, c) => sum + c.annual, 0) / annualCosts.length;
    const outliers = annualCosts
      .filter((c) => c.annual >= meanAnnual * 2 && c.annual >= 3000)
      .sort((a, b) => b.annual - a.annual);
    for (const { sub, annual } of outliers.slice(0, 2)) {
      insights.push({
        type: "high_yearly_spend",
        title: `${sub.name} adds up fast`,
        description: `${sub.name} costs ${formatCents(annual, sub.currency)}/year, more than double what you spend on a typical subscription here.`,
        severity: "info",
        subscriptionIds: [sub.id],
      });
    }
  }

  // 4. Possible overlap/duplicates — same or near-identical names, or
  // multiple active subscriptions in the same category.
  forEachLikelyDuplicatePair(active, (a, b) => {
    const savings = monthlyCents(b.amountCents, b.billingCycle);
    insights.push({
      type: "possible_overlap",
      title: `Possible duplicate: ${a.name} and ${b.name}`,
      description: `These look like the same service. If one is stale, canceling it saves ${formatCents(savings, b.currency)}/mo.`,
      severity: "warning",
      subscriptionIds: [a.id, b.id],
      potentialSavingsMonthlyCents: savings,
    });
  });
  // Category alone is too broad a redundancy signal — Adobe and Dropbox are
  // both "software" but solve nothing similar; this used to flag any 2+
  // subscriptions sharing a raw category. Now only fires when 2+ active
  // subscriptions resolve to the SAME curated functional-overlap group (see
  // computeFunctionalOverlapGroups below) — evidence that they actually
  // solve the same problem, not just belong to the same broad bucket.
  for (const { label, subscriptions: subs, combinedMonthlyCents, currency } of computeFunctionalOverlapGroups(active)) {
    insights.push({
      type: "possible_overlap",
      title: subs.map((s) => s.name).join(" + "),
      description: `${subs.map((s) => s.name).join(", ")} all provide ${label.toLowerCase()} functionality: ${formatCents(combinedMonthlyCents, currency)}/mo combined. Worth checking whether you need all of them.`,
      severity: "info",
      subscriptionIds: subs.map((s) => s.id),
    });
  }

  return insights;
}

export interface FunctionalOverlapGroupResult {
  group: OverlapGroup;
  label: string;
  subscriptions: Subscription[];
  combinedMonthlyCents: number;
  // The currency combinedMonthlyCents is denominated in — every member of
  // `subscriptions` shares this currency by construction (see the
  // same-currency join below), so callers can format the total correctly
  // instead of defaulting to formatCents' own "usd" fallback.
  currency: string;
}

// Groups active subscriptions by genuine functional-overlap group — see
// merchant-normalizer.ts's resolveOverlapGroup/OVERLAP_GROUP_LABELS for the
// curated group definitions and the evidence bar for including a merchant in
// one. Category answers "what kind of service"; this answers "does this
// solve the same problem as another subscription I'm paying for" — a
// materially stricter question. A subscription whose name doesn't resolve
// to a known merchant with an assigned group contributes nothing here — no
// group is the honest default, never a guess.
//
// Lives here (not savings.ts, the more obvious "savings-adjacent logic"
// home) specifically so savings.ts can import it — savings.ts already
// depends on this file for normalizeName/namesLikelyMatch, and the reverse
// import would be circular.
//
// Excludes the redundant half of any confirmed-duplicate pair (same
// identity rule as this file's own possible_overlap duplicate check just
// above): two near-identical names resolving to the same merchant — e.g.
// "Netflix" and "Netflix Premium" — would otherwise ALSO satisfy "2+
// subscriptions in the video_streaming group" and get flagged a second
// time as a functional_overlap, a confusing double-signal for one piece of
// evidence (and, in health.ts, a double penalty to the same redundancy
// dimension for the same underlying finding). The kept half stays eligible,
// so a genuinely distinct third service (e.g. Disney+ alongside a Netflix/
// Netflix Premium duplicate pair) still surfaces as a real overlap.
export function computeFunctionalOverlapGroups(active: Subscription[]): FunctionalOverlapGroupResult[] {
  const alreadyDuplicateFlagged = new Set<string>();
  forEachLikelyDuplicatePair(active, (_a, b) => {
    alreadyDuplicateFlagged.add(b.id);
  });

  // currency is unvalidated free text on this schema (see money.ts's own
  // comment on formatCents) — two subscriptions in the same functional
  // group can genuinely be in different currencies. Summing raw cents
  // across currencies would produce a number wearing a real one's
  // formatting (the exact rule computeRealizedSavings/
  // sumMonthlyCentsIfSingleCurrency already enforce elsewhere) — caught in
  // CodeRabbit review; this file was the one place that pattern had been
  // missed. A subscription joins a group only if its currency matches the
  // group's first (reference) member; a currency-mismatched subscription
  // simply doesn't participate in that group's total, rather than
  // corrupting it. If that leaves the group below the 2-subscription floor,
  // it honestly doesn't form at all — no fabricated cross-currency group.
  const byGroup = new Map<OverlapGroup, { label: string; subscriptions: Subscription[] }>();
  for (const s of active) {
    if (alreadyDuplicateFlagged.has(s.id)) continue;
    const resolved = resolveOverlapGroup(s.name);
    if (!resolved) continue;
    const entry = byGroup.get(resolved.group);
    if (entry) {
      if (entry.subscriptions[0].currency !== s.currency) continue;
      entry.subscriptions.push(s);
    } else {
      byGroup.set(resolved.group, { label: resolved.label, subscriptions: [s] });
    }
  }
  return Array.from(byGroup.entries())
    .filter(([, entry]) => entry.subscriptions.length >= 2)
    .map(([group, entry]) => ({
      group,
      label: entry.label,
      subscriptions: entry.subscriptions,
      combinedMonthlyCents: entry.subscriptions.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0),
      currency: entry.subscriptions[0].currency,
    }));
}

export interface SmallSubscriptionsCluster {
  subscriptions: Subscription[];
  combinedMonthlyCents: number;
  shareOfTotal: number;
  currency: string;
}

// "Death by a thousand cuts": no single subscription here is expensive
// enough to trip health.expensive_outliers, but several individually-cheap
// ones can still add up to a real, easy-to-miss chunk of monthly spend.
// Deliberately relative, not a fixed dollar bar (Phase 8's own instruction:
// prefer comparisons to the user's own portfolio over an arbitrary
// universal threshold): "small" means at or below half this account's own
// mean monthly cost, so an evenly-priced portfolio (nothing meaningfully
// cheaper than anything else) can never trigger this by construction — it
// only fires when the data actually shows a lopsided mix of a few pricier
// subscriptions and several notably cheaper ones whose sum is still
// material (>=20% of total spend). Both the "small" bar and the 20% floor
// are needed: without the first, this would just re-describe "the cheaper
// half of any portfolio" (mathematically ~50% by construction for any
// distribution); without the second, 3 tiny subscriptions summing to 2% of
// spend would count as "adding up," which they don't.
const SMALL_RELATIVE_TO_MEAN = 0.5;
const SMALL_CLUSTER_MIN_COUNT = 3;
const SMALL_CLUSTER_MIN_SHARE = 0.2;

// The portfolio "mean" this whole detector is built on has one denominator
// currency by construction — the same "never sum across currencies" rule
// computeRealizedSavings/sumMonthlyCentsIfSingleCurrency already enforce
// elsewhere (caught in CodeRabbit review; this function was the one place
// it had been missed, since a mixed-currency portfolio is rare but the
// schema's free-text currency column genuinely allows it). A currency-mixed
// active list bails out entirely — a per-currency partition would be
// possible, but "several small subscriptions add up" is a whole-portfolio
// pattern; a partial, single-currency-subset version of it isn't the same
// finding, and this rule already stays silent on plenty of real portfolios
// (< 4 active, no lopsided mix) rather than force an answer.
export function findSmallSubscriptionsCluster(active: Subscription[]): SmallSubscriptionsCluster | null {
  if (active.length < 4) return null; // need enough subscriptions for "small vs. typical" to mean anything
  const currency = active[0].currency;
  if (!active.every((s) => s.currency === currency)) return null;
  const withCosts = active.map((s) => ({ sub: s, monthly: monthlyCents(s.amountCents, s.billingCycle) }));
  const total = withCosts.reduce((sum, c) => sum + c.monthly, 0);
  if (total === 0) return null;
  const mean = total / withCosts.length;
  const small = withCosts.filter((c) => c.monthly > 0 && c.monthly <= mean * SMALL_RELATIVE_TO_MEAN);
  if (small.length < SMALL_CLUSTER_MIN_COUNT) return null;
  const combinedMonthlyCents = small.reduce((sum, c) => sum + c.monthly, 0);
  const shareOfTotal = combinedMonthlyCents / total;
  if (shareOfTotal < SMALL_CLUSTER_MIN_SHARE) return null;
  return {
    subscriptions: small.map((c) => c.sub).sort((a, b) => monthlyCents(a.amountCents, a.billingCycle) - monthlyCents(b.amountCents, b.billingCycle)),
    combinedMonthlyCents,
    shareOfTotal,
    currency,
  };
}

// Shared title formatting for the two independent callers that both
// surface a SmallSubscriptionsCluster as a user-facing finding — health.ts
// (the health-score dimension) and savings.ts (the Smart Savings
// opportunity card). Extracted after local-council review (Simplicity
// lens) found the exact same title template copy-pasted in both files,
// with the *description* directly below it already unintentionally
// drifted apart between the two (savings.ts had gained an extra sentence
// health.ts never got). The title has no reason to ever differ between the
// two surfaces, so it's a shared fact now, not two copies to keep in sync
// by hand; the descriptions stay separately authored on purpose — the
// health-score summary is deliberately terser than the savings card's
// fuller, action-oriented copy, matching how every other rule pair in this
// codebase (e.g. health.duplicates vs. savings.ts's duplicate block)
// already writes distinct descriptions for the same underlying fact.
export function smallSubscriptionsClusterTitle(cluster: SmallSubscriptionsCluster): string {
  return `${cluster.subscriptions.length} smaller subscriptions add up to ${formatCents(cluster.combinedMonthlyCents, cluster.currency)}/mo`;
}

// Sums each *distinct* subscription's cost at most once, even if it turns
// up as the redundant half of more than one duplicate pair (e.g. three
// near-identical names all matching each other) — otherwise the same
// subscription's cost could be counted two or three times and the headline
// figure would overstate what canceling the flagged duplicates actually
// saves.
export function computePotentialSavingsMonthlyCents(insights: ComputedInsight[]): number {
  const countedIds = new Set<string>();
  let total = 0;
  for (const insight of insights) {
    if (insight.potentialSavingsMonthlyCents === undefined) continue;
    const redundantId = insight.subscriptionIds[1];
    if (countedIds.has(redundantId)) continue;
    countedIds.add(redundantId);
    total += insight.potentialSavingsMonthlyCents;
  }
  return total;
}

// The health score itself moved to src/lib/insights-engine (computeHealthScore
// there, backed by HEALTH_RULES) — a weighted, rule-based system replacing
// this file's old 3-factor pass/fail version. computeInsights/ComputedInsight
// above stay here unchanged: they still drive the dashboard's Insights
// section, /subscriptions' savings stat, and SavingsCard's duplicate list.
