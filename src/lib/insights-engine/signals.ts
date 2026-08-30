import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";
import { monthlyCents, annualCents, splitByPrimaryCurrency } from "@/lib/subscriptions/money";
import { forEachLikelyDuplicatePair, normalizeName } from "@/lib/subscriptions/insights";
import { computeLatestPriceChange, type PriceChange } from "@/lib/subscriptions/price-history";
import type { EngineContext } from "./types";

// Pure, side-effect-free computations shared by health/free/premium rules —
// each signal is computed once per rule that needs it (rules are cheap and
// this runs client-request-scoped, not hot-loop), keeping every rule file a
// thin "compute signal, format InsightResult" wrapper instead of
// re-deriving detection logic per rule.

export function monthlyTotalCents(active: Subscription[]): number {
  return active.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);
}

// Deliberately not monthlyTotalCents(active) * 12 — see money.ts's own
// annualCents comment for why that compounds a rounding step for every
// yearly/quarterly/weekly subscription instead of summing each one's own
// exact annual figure directly.
export function annualTotalCents(active: Subscription[]): number {
  return active.reduce((sum, s) => sum + annualCents(s.amountCents, s.billingCycle), 0);
}

export interface DuplicatePair {
  keep: Subscription;
  redundant: Subscription;
  monthlySavingsCents: number;
}

// Same identity rule as savings.ts/insights.ts: the second (later-indexed)
// half of a matching pair is the redundant one — reused here instead of
// re-imported from savings.ts to keep this module dependency-free of the
// standalone /savings page's own presentation-oriented types.
export function findDuplicates(active: Subscription[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const seenRedundant = new Set<string>();
  forEachLikelyDuplicatePair(active, (a, b) => {
    if (seenRedundant.has(b.id)) return;
    seenRedundant.add(b.id);
    pairs.push({
      keep: a,
      redundant: b,
      monthlySavingsCents: monthlyCents(b.amountCents, b.billingCycle),
    });
  });
  return pairs;
}

export interface CategoryConcentration {
  category: Subscription["category"];
  cents: number;
  share: number; // 0-1 of monthlyTotal
  subscriptionIds: string[];
  currency: string;
}

// Returns the single biggest category's share of spend, or null when spend
// is zero or everything is already in one category (nothing to "balance").
//
// Restricted to `active`'s primary currency (splitByPrimaryCurrency) before
// summing — currency is unvalidated free text on this schema, and summing
// raw cents across currencies into one "share of monthly spend" would
// silently combine, say, GBP and USD into a number wearing one currency's
// formatting. A subscription in a non-primary currency simply doesn't
// participate in this signal, same disposition as
// computeFunctionalOverlapGroups/findSmallSubscriptionsCluster elsewhere,
// rather than corrupting the total or refusing to answer entirely.
export function categoryConcentration(active: Subscription[]): CategoryConcentration | null {
  const { currency, included } = splitByPrimaryCurrency(active);
  const total = monthlyTotalCents(included);
  if (total === 0 || !currency) return null;
  const byCategory = new Map<Subscription["category"], { cents: number; ids: string[] }>();
  for (const s of included) {
    const entry = byCategory.get(s.category) ?? { cents: 0, ids: [] };
    entry.cents += monthlyCents(s.amountCents, s.billingCycle);
    entry.ids.push(s.id);
    byCategory.set(s.category, entry);
  }
  if (byCategory.size <= 1) return null;
  const [category, entry] = Array.from(byCategory.entries()).sort((a, b) => b[1].cents - a[1].cents)[0];
  return { category, cents: entry.cents, share: entry.cents / total, subscriptionIds: entry.ids, currency };
}

// Adversarial-audit fix: health.concentration used to swing between a flat
// +WEAK ("balanced," share < 0.4) and a flat -MEDIUM ("concentrated," share
// >= 0.4) — a full 24-point cliff landing on either side of one exact
// threshold. A randomized invariant sweep (health-score.invariants.test.ts)
// found this was the dominant, reproducible cause of a real violation of an
// explicitly required invariant ("adding a confirmed duplicate cannot
// improve the score"): adding ANY new subscription to a category other than
// the current leader dilutes that leader's share of a now-larger total —
// itself a genuine, correct fact — and if that dilution happened to cross
// 0.4 the same moment a duplicate was added elsewhere, the 24-point
// concentration swing outweighed the duplicate's own redundancy penalty.
// Every other threshold-driven signal in this model (confirmedDuplicateSeverity,
// portfolioConcentrationPenalty, renewalExposurePenalty,
// expensiveOutlierMagnitudeFactor) was already built continuous for exactly
// this reason; this was the one rule still using a hard step. Continuous
// across the same 0.4 boundary the wording (title/description) still uses
// to decide "balanced" vs "concentrated" phrasing — 0 exactly at 0.4 (no
// cliff), ramping to the original +8 ceiling by 0.15 or below and the
// original -16 ceiling by 0.7 or above, so the two pre-existing endpoints
// are unchanged and every existing calibration point (0.8 share -> -16,
// 3-way even split -> positive) still lands the same or a strictly
// intermediate value.
export function categoryConcentrationImpact(share: number): number {
  if (share <= 0.4) return Math.round(8 * Math.min(1, Math.max(0, (0.4 - share) / 0.25)));
  return -Math.round(16 * Math.min(1, (share - 0.4) / 0.3));
}

export interface RenewalCluster {
  windowStartIso: string;
  subscriptionIds: string[];
  // totalCents/currency describe only the subset of the cluster that's in
  // active's primary currency (splitByPrimaryCurrency) — subscriptionIds
  // itself stays the full cluster, since "several bills land the same
  // week" is a timing signal that doesn't depend on currency, but the
  // dollar total can't honestly include amounts from a different currency.
  // currency is null (and totalCents 0) only in the defensive case where
  // the cluster's window itself contains zero primary-currency members
  // (currently unreachable in practice — the primary currency is active's
  // majority, so a 3+ cluster almost always includes at least one).
  totalCents: number;
  currency: string | null;
}

// Active subscriptions whose next renewal falls within `windowDays` of the
// single busiest anchor date — a real "several bills land the same week"
// signal, not a guess. Returns null when nothing clusters (max cluster < 3).
export function findRenewalCluster(active: Subscription[], todayIso: string, windowDays = 7): RenewalCluster | null {
  const upcoming = active
    .filter((s) => s.nextRenewalDate >= todayIso)
    .sort((a, b) => a.nextRenewalDate.localeCompare(b.nextRenewalDate));
  if (upcoming.length < 3) return null;
  const primaryCurrency = splitByPrimaryCurrency(active).currency;

  let best: RenewalCluster | null = null;
  for (let i = 0; i < upcoming.length; i++) {
    const anchor = new Date(`${upcoming[i].nextRenewalDate}T00:00:00Z`);
    const windowEnd = new Date(anchor.getTime() + windowDays * 86_400_000);
    const inWindow = upcoming.filter((s) => {
      const d = new Date(`${s.nextRenewalDate}T00:00:00Z`);
      // Exclusive upper bound: with windowDays=7, anchor+0..anchor+6 is 7
      // distinct calendar days ("the same week"/"within 7 days", per every
      // caller's own copy). `d <= windowEnd` (windowEnd = anchor + 7 days)
      // used to include anchor+7 too — an 8-day span — letting
      // premium.risk_renewal_cluster's critical gate fire for renewals
      // that are actually more than a week apart (release-review finding #7).
      return d >= anchor && d < windowEnd;
    });
    if (inWindow.length >= 3 && (!best || inWindow.length > best.subscriptionIds.length)) {
      const primaryInWindow = inWindow.filter((s) => s.currency === primaryCurrency);
      best = {
        windowStartIso: upcoming[i].nextRenewalDate,
        subscriptionIds: inWindow.map((s) => s.id),
        totalCents: primaryInWindow.reduce((sum, s) => sum + s.amountCents, 0),
        currency: primaryInWindow.length > 0 ? primaryCurrency : null,
      };
    }
  }
  return best;
}

export interface ExpensiveOutlier {
  subscription: Subscription;
  annualCents: number;
}

// Subscriptions costing at least 2x the group's mean annual cost — a
// relative outlier detector that scales with each user's own spend rather
// than a fixed dollar threshold no single currency/cohort would fit.
//
// Restricted to the primary currency (splitByPrimaryCurrency): "2x the
// mean" only means something when every figure in the comparison is the
// same currency — a GBP subscription compared against a mean blended from
// USD amounts is not a real outlier signal, just an artifact of which
// currency happens to have more subscriptions. A non-primary-currency
// subscription is simply not evaluated for this signal, rather than
// distorting the mean every other subscription is judged against.
export function findExpensiveOutliers(active: Subscription[]): ExpensiveOutlier[] {
  const { included } = splitByPrimaryCurrency(active);
  if (included.length < 2) return [];
  const annualized = included.map((s) => ({ subscription: s, annualCents: annualCents(s.amountCents, s.billingCycle) }));
  const mean = annualized.reduce((sum, a) => sum + a.annualCents, 0) / annualized.length;
  return annualized
    .filter((a) => a.annualCents >= mean * 2 && a.annualCents >= 3000)
    .sort((a, b) => b.annualCents - a.annualCents);
}

// Health Score v2 adversarial-audit fix: the outliers rule's penalty used
// to be a flat -MEDIUM per outlier regardless of how dominant it actually
// was — a subscription at barely 2x the mean and one that's 90%+ of the
// ENTIRE portfolio's spend scored identically. That under-penalizes the
// single most severe concentration shape this app can observe, and it does
// so specifically *because* portfolioConcentrationRule's own, more precise
// HHI-based penalty is deliberately silenced whenever its top contributor
// is already flagged as an outlier (rules/health.ts's own mutual-exclusion
// comment: avoiding double-counting the same fact under two labels) — a
// deference this file's signals.ts header comment already promised would
// be a "max(), never summed" combination, not a full silence. Silencing
// entirely was only safe as long as the outliers rule itself scaled with
// severity; it didn't, so the silence became a genuine under-count for the
// exact "one subscription eating the vast majority of spend" case the
// calibration audit's fixture #9 surfaced. This factor closes that gap by
// scaling the existing per-count tier with how large a share of total
// annual spend the single largest outlier represents: no scaling below 40%
// share (an outlier that's clearly 2x+ the mean but doesn't dominate the
// whole portfolio keeps its original penalty), ramping smoothly to 2x by
// 90%+ share — mirroring the same "count AND magnitude, never just count"
// shape confirmedDuplicateSeverity and renewalExposurePenalty already use
// elsewhere in this model. The existing per-rule -32 ceiling is unchanged;
// this only redistributes severity within it.
export function expensiveOutlierMagnitudeFactor(topShareOfTotal: number): number {
  return 1 + Math.min(1, Math.max(0, (topShareOfTotal - 0.4) / 0.5));
}

export function longRunningSubscriptions(active: Subscription[], todayIso: string, minDays = 365): Subscription[] {
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  return active.filter((s) => (today - s.createdAt.getTime()) / 86_400_000 >= minDays);
}

// Active subscriptions with no yearly/quarterly billing at all among a
// group large enough that a multi-month plan would plausibly exist —
// informs the "mostly monthly, no annual discount captured" free insight.
export function billingCycleCounts(active: Subscription[]): Record<Subscription["billingCycle"], number> {
  const counts: Record<Subscription["billingCycle"], number> = { monthly: 0, yearly: 0, quarterly: 0, weekly: 0 };
  for (const s of active) counts[s.billingCycle] += 1;
  return counts;
}

// Net new active-subscription count added in the last `days` — reuses each
// subscription's own createdAt, the same real signal analytics.ts's
// computeGrowthOverTime buckets by, rather than a synthetic "trend" figure.
export function recentGrowthCount(active: Subscription[], todayIso: string, days = 30): number {
  const cutoff = new Date(`${todayIso}T00:00:00Z`).getTime() - days * 86_400_000;
  return active.filter((s) => s.createdAt.getTime() >= cutoff).length;
}

// Restricted to active's primary currency (splitByPrimaryCurrency) for the
// same reason as categoryConcentration/findExpensiveOutliers above — this
// feeds health.renewal_risk's "$X due in the next 30 days" comparison
// against monthlyTotalCents, and both sides of that comparison need to be
// the same currency to mean anything.
export function upcomingRenewalTotalCents(active: Subscription[], todayIso: string, days = 30): number {
  const { included } = splitByPrimaryCurrency(active);
  const today = new Date(`${todayIso}T00:00:00Z`);
  const end = new Date(today.getTime() + days * 86_400_000);
  return included
    .filter((s) => {
      const d = new Date(`${s.nextRenewalDate}T00:00:00Z`);
      return d >= today && d <= end;
    })
    .reduce((sum, s) => sum + s.amountCents, 0);
}

export function canceledCount(all: Subscription[]): number {
  return all.filter((s) => s.status === "canceled").length;
}

// Health Score v2 adversarial-audit fix: a canceled subscription whose name
// matches a currently-active one is not evidence of "actively pruning what
// you don't use" — it's the other half of a reactivation
// (health.reactivation already penalizes the active side of this same
// pair). Crediting canceledHistory's positive bonus for the exact
// subscription that came right back let a churn-heavy pattern (repeatedly
// canceling and re-subscribing to the same service) net out to a wash, or
// even a net positive once the hygiene dimension's score clamped at 100 —
// two directly correlated findings, computed in total isolation, silently
// canceling each other out (caught by the audit's "reactivation-heavy"
// calibration fixture: 2 cancel+reactivate pairs scored a numeric 100 on
// hygiene, "nothing to flag," despite two recent churn events). A
// genuinely resolved cancellation — nothing active shares its name — still
// gets full credit; canceledCount (above) is left untouched as the honest
// raw count for callers that want it unfiltered.
export function nonReactivatedCanceledCount(all: Subscription[]): number {
  const activeNames = new Set(all.filter((s) => s.status === "active").map((s) => normalizeName(s.name)));
  return all.filter((s) => s.status === "canceled" && !activeNames.has(normalizeName(s.name))).length;
}

// An active subscription whose renewal date has already passed — real
// bookkeeping neglect (the date was never updated after a renewal, or the
// service was actually canceled elsewhere and SubSentry was never told),
// not a guess about usage this app has no data to support.
export function overdueRenewals(active: Subscription[], todayIso: string): Subscription[] {
  return active.filter((s) => s.nextRenewalDate < todayIso);
}

// category="other" is the schema's default (see schema.ts) and, for a
// *manually* entered subscription, can be a genuine, deliberate choice —
// not every subscription fits streaming/software/fitness/etc., and a user
// picking "Other" themselves isn't a data-quality problem. For an
// *imported* row (csv_import, ai_parsed, apple_import, ...), "other" means
// something different: the classifier that ran over it (merchant-
// normalizer.ts's KNOWN_MERCHANTS table) didn't recognize the merchant at
// all, so the category is really "unknown," not "deliberately other." This
// only counts that second, honest-gap case — see health.ts's
// uncategorizedImports rule for why that distinction matters.
export function uncategorizedImports(active: Subscription[]): Subscription[] {
  return active.filter((s) => s.category === "other" && s.source !== "manual");
}

export const ctxTotal = (ctx: EngineContext) => monthlyTotalCents(ctx.active);

export interface PriceIncrease {
  subscription: Subscription;
  change: PriceChange;
}

// A <3% move is well within the kind of rounding/plan-restructuring noise
// that doesn't deserve the same "your bill went up" framing as a real
// increase — Netflix raising $15.49 -> $17.99 is a real ~16% jump; $9.99 ->
// $10.00 from a currency-conversion rounding quirk is not. computeLatestPriceChange
// (lib/subscriptions/price-history.ts) already excludes exact-same-price
// pairs and cross-currency pairs; this is the additional "meaningful, not
// just nonzero" bar for a *health* finding specifically.
const MEANINGFUL_INCREASE_PERCENT = 3;

// A relative-only bar lets a trivially small subscription's price double
// (say, $0.50 -> $1.00/mo, +100%) read as identically "meaningful" to a
// real Netflix-sized hike — same relative move, negligible real dollar
// impact. findExpensiveOutliers (this file) applies the exact same
// "relative AND absolute" pairing for the same reason (a 2x-the-mean
// subscription only counts once it also clears a real dollar floor); this
// mirrors that $30/yr bar for consistency (found in product council
// review, Product Manager lens — the original relative-only version was an
// inconsistency with that established sibling pattern).
const MEANINGFUL_INCREASE_ANNUAL_DELTA_CENTS = 3000;

// Every active subscription's most recent genuine price change, filtered to
// real, meaningful increases and sorted by dollar impact — reads only real
// recorded history (priceHistoryBySubscriptionId, built by a single bulk
// query, see queries.ts's getAllPriceHistoryForUser), never estimates or
// infers a change that wasn't actually observed.
export function findPriceIncreases(
  active: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
): PriceIncrease[] {
  const found: PriceIncrease[] = [];
  for (const s of active) {
    const history = priceHistoryBySubscriptionId.get(s.id);
    if (!history) continue;
    const change = computeLatestPriceChange(history);
    if (
      change &&
      change.percentChange >= MEANINGFUL_INCREASE_PERCENT &&
      change.annualDeltaCents >= MEANINGFUL_INCREASE_ANNUAL_DELTA_CENTS
    ) {
      found.push({ subscription: s, change });
    }
  }
  return found.sort((a, b) => b.change.annualDeltaCents - a.change.annualDeltaCents);
}

// Whether there's enough recorded price history among active subscriptions
// to have an opinion at all — distinct from findPriceIncreases returning
// zero results, which could honestly mean either "checked, found no
// increase" or "haven't observed enough history yet to check." Same
// two-states distinction PriceHistoryNote already makes on the detail page,
// applied here so the health rule can stay silent (not claim a positive
// "no increases" it hasn't actually earned) for an account with too little
// history.
export function hasEnoughPriceHistoryToEvaluate(
  active: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
): boolean {
  return active.some((s) => (priceHistoryBySubscriptionId.get(s.id)?.length ?? 0) >= 2);
}

// Final-calibration-review fix: replaces the old flat "-16 per increase,
// capped at 2 occurrences" with the same count-AND-magnitude shape
// confirmedDuplicateSeverity already uses — a randomized calibration sweep
// found that once 2+ subscriptions had a recorded price increase, a
// portfolio where every subscription's price nearly doubled (+80%) scored
// identically to one where two subscriptions rose a modest 30%, because
// the count-based cap saturated at exactly 2 occurrences and the formula
// never read magnitude at all.
//
// f(n) = sqrt(n): same diminishing-returns count curve as duplicates —
// the marginal cost of each additional increased subscription keeps
// shrinking, but a portfolio where every tracked subscription got more
// expensive still costs more than one where only one did.
//
// g(share): 0.6x at trivial dollar impact, ramping to 1.5x once the
// combined annual dollar impact of every recorded increase reaches 30%+ of
// this portfolio's total annual spend (primary currency) — the same "a
// $2/yr bump and a $2,000/yr bump shouldn't cost the same" fix already
// applied to duplicates and expensive outliers. Share cap set at 30%, not
// 35% like duplicates: a price hike is involuntary (the user didn't choose
// to add this cost), so this reaches its full multiplier at a slightly
// lower bar than a duplicate, which is a purely self-inflicted cost.
//
// repeatedMultiplier: a modest 1.1x when at least one subscription shows
// 2+ recorded changes in the trailing year (hasRepeatedPriceChanges) — a
// repeated-change pattern is real additional evidence, but a smaller
// nudge than duplicates' 1.15x stale-dismissal bonus, since this app can
// currently only observe a user's own repeated edits (see
// hasRepeatedPriceChanges' own scope caveat), a narrower evidence base.
//
// Ceiling of 48 (up from 32): sized deliberately larger than duplicates'
// per-instance base specifically because this dimension (spending) already
// has 5 other rules that can independently stack alongside it
// (concentration, portfolio-concentration, outliers, small-subscriptions,
// long-running) — giving one rule a too-small ceiling relative to its
// siblings would make it structurally unable to be the dominant signal
// even when it honestly is the most severe one in a given portfolio. 48
// keeps genuinely severe, uncorrelated price-increase evidence able to
// visibly move the dimension without single-handedly consuming its entire
// 100-point range on its own.
const PRICE_INCREASE_BASE = 16;
const PRICE_INCREASE_SHARE_CAP = 0.3;
const PRICE_INCREASE_REPEATED_MULTIPLIER = 1.1;
const PRICE_INCREASE_CEILING = 48;

export function priceIncreaseSeverity(
  increasedCount: number,
  totalAnnualDeltaCents: number,
  totalAnnualCents: number,
  hasRepeatedChanges: boolean,
): number {
  if (increasedCount <= 0) return 0;
  const share = totalAnnualCents > 0 ? totalAnnualDeltaCents / totalAnnualCents : 0;
  const f = Math.sqrt(increasedCount);
  const g = 0.6 + 0.9 * (Math.min(share, PRICE_INCREASE_SHARE_CAP) / PRICE_INCREASE_SHARE_CAP);
  const repeated = hasRepeatedChanges ? PRICE_INCREASE_REPEATED_MULTIPLIER : 1;
  return -Math.min(PRICE_INCREASE_CEILING, Math.round(PRICE_INCREASE_BASE * f * g * repeated));
}

// Health Score v2 additions below. Each is a pure, independently-testable
// function feeding a single rule in rules/health.ts — see
// HEALTH_SCORE_V2_PROPOSAL.md for the full "why" behind each formula's
// shape and constants.

// Confirmed-duplicate severity: replaces the old flat "-STRONG per pair,
// capped at 60" with a magnitude- AND count-aware figure — a $10 duplicate
// in a $2,000/mo portfolio and the same $10 duplicate in a $50/mo portfolio
// no longer score identically, and a 5th duplicate pair no longer costs the
// same marginal amount as the 1st.
//
// f(n) = sqrt(n): diminishing returns per additional pair (1->1, 2->1.41,
// 4->2, 5->2.24) — a concave curve, so the MARGINAL cost of each additional
// pair keeps shrinking even though the raw total keeps growing. Chosen over
// a log curve as the smallest reasonable curve that still lets a genuinely
// duplicate-heavy portfolio reach deep into this dimension's own floor,
// while a single pair in a tiny, mostly-duplicated portfolio doesn't
// immediately slam into the ceiling either (see the calibration fixtures in
// health-score.test.ts this was tuned against).
//
// g(share): 0.6x at trivial dollar exposure, ramping linearly to 1.5x once
// confirmed-duplicate spend reaches 35%+ of total monthly spend — the
// "$10 vs $1,000" fix. Capped at 35%, not 100%: beyond that point the
// portfolio's redundancy problem is already severe enough that further
// share doesn't need to keep scaling the multiplier, the count term and the
// ceiling below take over.
//
// staleBonus: 1.15x when at least one involved pair was already surfaced to
// the user (via /savings) and dismissed, and is still present today — real,
// stored evidence (dismissedSavingsRecommendations) that this exact problem
// was already flagged once and never resolved, not an inferred pattern.
//
// Ceiling raised 60->100 (final-calibration-review fix): 100 is not an
// arbitrary bigger number, it's the point past which raising it further
// literally cannot matter — computeHealthScore clamps every dimension's
// rawScore to [0, 100], so any raw penalty of -100 or worse already zeroes
// out the redundancy dimension on its own. The old -60 ceiling sat well
// inside that natural bound, which meant it was doing its OWN, tighter
// clamping on top of the real one: a randomized calibration sweep found 2
// duplicate pairs and 6 duplicate pairs (comparable per-pair dollar share)
// scored an IDENTICAL redundancy=40 and identical overall score, because
// both raw values (64 and 110) were being flattened to the same -60 by a
// cap well below what the dimension could actually express. Raising the
// ceiling to exactly 100 lets f(n)'s already-diminishing curve keep
// discriminating between "a couple of real duplicates" and "the large
// majority of this portfolio is duplicated" instead of erasing that
// difference itself; a portfolio only reaches the true floor of 0 once its
// raw value is severe enough on its own terms (see this file's own
// signals.test.ts for the exact pair-count/share combinations this was
// checked against).
const DUPLICATE_BASE = 30;
const DUPLICATE_SHARE_CAP = 0.35;
const DUPLICATE_STALE_MULTIPLIER = 1.15;
const DUPLICATE_CEILING = 100;

export function confirmedDuplicateSeverity(
  pairCount: number,
  redundantMonthlyCents: number,
  totalMonthlyCents: number,
  hasStaleDismissal: boolean,
): number {
  if (pairCount <= 0) return 0;
  const share = totalMonthlyCents > 0 ? redundantMonthlyCents / totalMonthlyCents : 0;
  const f = Math.sqrt(pairCount);
  const g = 0.6 + 0.9 * (Math.min(share, DUPLICATE_SHARE_CAP) / DUPLICATE_SHARE_CAP);
  const stale = hasStaleDismissal ? DUPLICATE_STALE_MULTIPLIER : 1;
  return -Math.min(DUPLICATE_CEILING, Math.round(DUPLICATE_BASE * f * g * stale));
}

// Portfolio-level spend concentration — "does one subscription dominate,
// regardless of category," distinct from categoryConcentration's
// category-level view. Uses a *normalized* Herfindahl-Hirschman Index
// (HHI* = (HHI - 1/n) / (1 - 1/n)) rather than raw HHI specifically because
// raw HHI's minimum is 1/n, not 0 — a perfectly even 3-way split has raw
// HHI=0.333, which would sit right at a naive "concerning" threshold for no
// real reason other than there being few subscriptions. Normalizing against
// the theoretical minimum for n items means a perfectly even split always
// scores 0 concentration regardless of n, and only genuine imbalance
// registers. Requires n>=3: at n<=2 this is indistinguishable from
// findExpensiveOutliers' own 2x-mean test, which already covers that case.
//
// Deliberately does NOT fire when its top contributor is already flagged by
// findExpensiveOutliers (checked by the caller, rules/health.ts) — both
// measure the same underlying fact ("one subscription is disproportionately
// large"), so scoring both would double-count it under two different
// labels. This function itself stays label-agnostic and just reports the
// math; the exclusion lives in the rule.
export interface PortfolioConcentration {
  normalizedHHI: number; // 0 (perfectly even) .. 1 (all spend on one subscription)
  topSubscriptionId: string;
  topShare: number;
}

export function portfolioConcentration(active: Subscription[]): PortfolioConcentration | null {
  const { included } = splitByPrimaryCurrency(active);
  const n = included.length;
  if (n < 3) return null;
  const withShare = included.map((s) => ({ id: s.id, monthly: monthlyCents(s.amountCents, s.billingCycle) }));
  const total = withShare.reduce((sum, s) => sum + s.monthly, 0);
  if (total === 0) return null;
  const shares = withShare.map((s) => ({ id: s.id, share: s.monthly / total }));
  const hhi = shares.reduce((sum, s) => sum + s.share * s.share, 0);
  const minHhi = 1 / n;
  const normalizedHHI = (hhi - minHhi) / (1 - minHhi);
  const top = [...shares].sort((a, b) => b.share - a.share)[0];
  return { normalizedHHI, topSubscriptionId: top.id, topShare: top.share };
}

// Piecewise, capped penalty curve over normalizedHHI — 0 below 0.25 (some
// natural unevenness is normal and not worth flagging), ramping to -16
// between 0.25 and 0.6, then a shallower ramp to a -20 cap by 0.85. Capped
// below findExpensiveOutliers' own -32 ceiling on purpose: this is
// corroborating, softer evidence of the same kind of problem, never the
// primary signal for it.
export function portfolioConcentrationPenalty(normalizedHHI: number): number {
  if (normalizedHHI < 0.25) return 0;
  if (normalizedHHI < 0.6) return -Math.round(16 * ((normalizedHHI - 0.25) / 0.35));
  if (normalizedHHI < 0.85) return -Math.round(16 + 4 * ((normalizedHHI - 0.6) / 0.25));
  return -20;
}

// Continuous replacement for the old binary "upcoming > monthly * 1.5"
// cash-flow-spike test. Starts accumulating softly at 1.3x (gentler than
// the old cliff-edge at 1.5x for a borderline account), reaches -32 by
// 3.5x — the original "harsher for a genuinely bad spike" ceiling — softer
// at the margin, harsher for a genuinely bad spike, the same diminishing-
// returns-except-at-the-real-problem shape as the duplicate formula above.
//
// Extended 3.5x-15x (final-calibration-review fix): a randomized
// calibration sweep found a 9x-normal spike and a 20x-normal spike scored
// within one point of each other (both landing "Good"), because both
// ratios sat well past the old flat -32 ceiling with nothing left to
// differentiate them — a 20x-normal cash-flow event is a materially worse
// liquidity risk than 9x, and the score should say so. This third segment
// is deliberately much shallower than the first two (16 points spread over
// an 11.5-wide ratio range, vs. 16 points over a 0.7-1.5-wide range below)
// — genuinely diminishing returns, not a bigger cliff: going from 9x to
// 20x now costs real but modest additional points, never an unbounded
// penalty. -48 (not a smaller ceiling) mirrors the same reasoning
// priceIncreaseSeverity's own ceiling uses: this dimension has only one
// contributing rule, so its ceiling directly sets the dimension's floor,
// and a genuinely catastrophic, already-proven spike deserves room to sit
// well below "moderate."
export function renewalExposurePenalty(ratio: number): number {
  if (ratio <= 1.3) return 0;
  if (ratio < 2.0) return -Math.round(16 * ((ratio - 1.3) / 0.7));
  if (ratio < 3.5) return -Math.round(16 + 16 * ((ratio - 2.0) / 1.5));
  if (ratio < 15) return -Math.round(32 + 16 * ((ratio - 3.5) / 11.5));
  return -48;
}

// An active subscription whose normalized name fuzzy-matches a *canceled*
// subscription on the same account — real, already-stored evidence (both
// live in `subscriptions`, just different `status` values) that something
// once marked done came back. Deliberately makes no claim about why (a
// household re-subscribing to Netflix in December is completely normal);
// it's presented as a fact worth confirming, not a pattern judgment.
export function reactivationCandidates(allSubscriptions: Subscription[], active: Subscription[]): Subscription[] {
  const canceledNames = new Set(
    allSubscriptions.filter((s) => s.status === "canceled").map((s) => normalizeName(s.name)),
  );
  if (canceledNames.size === 0) return [];
  return active.filter((s) => canceledNames.has(normalizeName(s.name)));
}

// Whether any active subscription shows 2+ recorded price *changes* (3+
// history rows, since the first row is always the "initial" price, not a
// change) within the trailing 12 months — a repeated-change pattern, not
// just a single one-off increase (already scored by findPriceIncreases
// itself). Scope caveat carries over unchanged from findPriceIncreases: no
// import path writes a history row for an *existing* subscription today,
// so in practice this can currently only ever reflect the user's own
// repeated edits.
export function hasRepeatedPriceChanges(
  active: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
  todayIso: string,
): boolean {
  const cutoff = new Date(`${todayIso}T00:00:00Z`).getTime() - 365 * 86_400_000;
  return active.some((s) => {
    const history = priceHistoryBySubscriptionId.get(s.id);
    if (!history) return false;
    const recent = history.filter((h) => h.observedAt.getTime() >= cutoff);
    return recent.length >= 3;
  });
}
