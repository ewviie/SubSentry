import { monthlyCents, annualCents, splitByPrimaryCurrency } from "./money";
import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";

// Phase 9: the read side of price-history capture — see schema.ts's own
// comment on subscriptionPriceHistory for why this table starts empty of
// real history for existing subscriptions (no fabricated backfill) and
// queries.ts's updateSubscription for exactly when a new row is written.
// This module only ever reads what's actually there; it has no fallback
// that invents a plausible-looking change.
export interface PriceChange {
  fromCents: number;
  fromBillingCycle: Subscription["billingCycle"];
  toCents: number;
  toBillingCycle: Subscription["billingCycle"];
  currency: string;
  // The date the new price was first observed, YYYY-MM-DD.
  observedAtIso: string;
  // Both figures below are computed from each row's own monthly-equivalent
  // (money.ts's monthlyCents), not the raw stored amounts — comparing raw
  // amountCents across two rows would silently be wrong the moment
  // billingCycle differs between them (e.g. $10/mo -> $100/yr is a real
  // ~17% *decrease* in what this subscription actually costs per month,
  // not the "10x increase" comparing the bare numbers would suggest).
  // Signed — positive is an increase, negative is a decrease.
  percentChange: number;
  // Each row's own exact annual figure (money.ts's annualCents), differenced
  // — "what this costs differently per year now." Deliberately not each
  // row's monthly-equivalent delta * 12: for a same-cycle change (the
  // common case — a yearly subscription's yearly price moved) that would
  // round twice, e.g. $70/yr -> $84/yr is exactly a $14.00/yr delta, but
  // going through monthlyCents (700 -> 700.0 vs 583.33 -> 833.33, rounded
  // to 583/700) and back would report $14.04. annualCents needs no such
  // detour for a same-cycle pair (it doesn't touch monthlyCents at all,
  // yearly figures are already exact), and stays correct even when the two
  // rows have genuinely different cycles, which is exactly when a common
  // monthly basis is unavoidable — see percentChange below, which still
  // uses each row's monthly-equivalent on purpose: a ratio needs a shared
  // per-period basis to compare at all, and a few cents of rounding on an
  // intermediate monthly figure is immaterial to a percentage.
  annualDeltaCents: number;
}

// The most recent genuine price change in a subscription's history, or
// null when there isn't one (yet). "Genuine" excludes two kinds of
// same-looking-but-meaningless rows:
// - Two consecutive rows with an identical monthly-equivalent amount and
//   currency (an edit that touched an unrelated field but re-submitted the
//   same price, still gated out at the write side in queries.ts, but this
//   reads defensively rather than assuming that invariant always holds).
// - A pair of rows whose currency differs — a percent change across two
//   different currencies is not a meaningful number (same "never compute
//   across currencies" rule savings.ts's computeRealizedSavings already
//   follows), so this returns null rather than a misleading percentage.
export function computeLatestPriceChange(history: SubscriptionPriceHistory[]): PriceChange | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const latest = sorted[sorted.length - 1];
  const latestMonthly = monthlyCents(latest.amountCents, latest.billingCycle);

  for (let i = sorted.length - 2; i >= 0; i--) {
    const candidate = sorted[i];
    // Skip past a mismatched-currency row rather than giving up entirely —
    // a transient different-currency entry somewhere in the middle of
    // history (a data-entry glitch, a temporary regional pricing quirk)
    // must not permanently block detecting a genuine change further back
    // once the subscription is back to a currency matching `latest`.
    // Bug found in product council review (Data/Analytics lens): the
    // original `return null` here fired on ANY mismatch encountered while
    // walking backward — including one several rows behind an
    // already-skipped identical-price row — silently losing a real,
    // same-currency increase that existed further back (repro: usd 800 ->
    // eur 999 -> usd 1200 reported nothing instead of the genuine +50%).
    // Two rows with no other same-currency row between them (the original,
    // still-covered case) correctly falls through to the final `return
    // null` below once the loop is exhausted.
    if (candidate.currency !== latest.currency) continue;

    const candidateMonthly = monthlyCents(candidate.amountCents, candidate.billingCycle);
    if (candidateMonthly === latestMonthly) continue;
    // A prior $0 monthly-equivalent price makes "percent change" undefined
    // (divide by zero) — amountCents is validated non-negative but not
    // non-zero (subscription form allows "0.00" for a free trial/promo),
    // so this is a real, reachable case, not just defensive padding.
    if (candidateMonthly === 0) return null;

    return {
      fromCents: candidate.amountCents,
      fromBillingCycle: candidate.billingCycle,
      toCents: latest.amountCents,
      toBillingCycle: latest.billingCycle,
      currency: latest.currency,
      observedAtIso: latest.observedAt.toISOString().slice(0, 10),
      percentChange: ((latestMonthly - candidateMonthly) / candidateMonthly) * 100,
      annualDeltaCents: annualCents(latest.amountCents, latest.billingCycle) - annualCents(candidate.amountCents, candidate.billingCycle),
    };
  }
  return null;
}

export interface PriceHistoryCreep {
  firstCents: number;
  firstBillingCycle: Subscription["billingCycle"];
  firstObservedAtIso: string;
  currentCents: number;
  currentBillingCycle: Subscription["billingCycle"];
  currency: string;
  // How many separate genuine amount changes make up this creep — the
  // reason this function exists at all: computeLatestPriceChange already
  // tells the most-recent-change story, but a subscription that stepped up
  // three separate times over two years has a bigger, truer story than its
  // single latest step alone. Always >= 2 on a non-null return (see the
  // gate below) — a single change is already fully told by
  // computeLatestPriceChange, so this deliberately stays silent for one.
  changeCount: number;
  percentChange: number;
  annualDeltaCents: number;
}

// Retention pass: "this has gone up 3 times since you started tracking it"
// — the multi-change story PriceHistoryNote's own computeLatestPriceChange
// literally cannot tell (it only ever compares the two most recent genuine
// values). Every figure here reads directly from subscriptionPriceHistory
// rows that already exist for this exact reason; nothing here is a new data
// source, just a different aggregation of the same one. Same "never
// fabricate, never compare across currencies" discipline as
// computeLatestPriceChange above — deliberately not sharing that function's
// backward-walk loop (that one answers "what's the nearest genuine prior
// value," this one answers "what's the very first one," a different
// question with a simpler forward pass).
export function computePriceHistoryCreep(history: SubscriptionPriceHistory[]): PriceHistoryCreep | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const first = sorted[0];
  const current = sorted[sorted.length - 1];
  if (first.currency !== current.currency) return null; // never compare across currencies

  const firstMonthly = monthlyCents(first.amountCents, first.billingCycle);
  const currentMonthly = monthlyCents(current.amountCents, current.billingCycle);
  if (firstMonthly === 0) return null; // percent change undefined, same as computeLatestPriceChange

  // Count genuine transitions only, walking forward against the last row
  // actually counted (not always the immediately-preceding array index) —
  // a currency-mismatched row (a transient data-entry glitch, a temporary
  // regional-pricing quirk) is skipped without breaking the comparison
  // chain around it, so a genuine change on either side of it is still
  // counted against its real same-currency neighbor. Same defensive
  // posture computeLatestPriceChange's own backward walk documents, applied
  // forward here.
  let changeCount = 0;
  let last = first;
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr.currency !== last.currency) continue;
    if (monthlyCents(curr.amountCents, curr.billingCycle) !== monthlyCents(last.amountCents, last.billingCycle)) {
      changeCount++;
    }
    last = curr;
  }
  // Fewer than 2 genuine changes means there's exactly one change —
  // computeLatestPriceChange already tells that single-change story on its
  // own; this function's whole reason to exist is the multi-change case a
  // single "from -> to" pair can't represent.
  if (changeCount < 2) return null;
  // A genuine net move is still required even with 2+ changes: two changes
  // that land back on the starting figure (up, then back down) are a real
  // fact, but "this has crept up" would misdescribe it — that's a
  // different, more complex story ("changed twice, net unchanged") this
  // function doesn't try to tell.
  if (firstMonthly === currentMonthly) return null;

  return {
    firstCents: first.amountCents,
    firstBillingCycle: first.billingCycle,
    firstObservedAtIso: first.observedAt.toISOString().slice(0, 10),
    currentCents: current.amountCents,
    currentBillingCycle: current.billingCycle,
    currency: current.currency,
    changeCount,
    percentChange: ((currentMonthly - firstMonthly) / firstMonthly) * 100,
    annualDeltaCents: annualCents(current.amountCents, current.billingCycle) - annualCents(first.amountCents, first.billingCycle),
  };
}

export interface PricePoint {
  amountCents: number;
  billingCycle: Subscription["billingCycle"];
  currency: string;
}

export interface PriceChangeCandidate {
  percentChange: number;
  annualDeltaCents: number;
}

// A <3% monthly-equivalent move is within normal rounding/plan-restructuring
// noise, not a genuine price change worth surfacing — same bar
// insights-engine/signals.ts's MEANINGFUL_INCREASE_PERCENT applies for the
// health-score rule (kept as a separate constant here rather than shared:
// that one is increase-only and health-score-specific; this one is
// bidirectional and import-detection-specific, and the two call sites have
// no other reason to be coupled).
const MEANINGFUL_PRICE_CHANGE_PERCENT = 3;

// Compares an existing subscription's stored price against a freshly
// detected recurring amount (import-side price reconciliation) — the same
// monthly-equivalent normalization computeLatestPriceChange above uses for
// two history rows, applied here to "what's currently stored" vs. "what a
// bank/CSV import just detected," so a genuine price change can be proposed
// without ever assuming a differing raw number means a differing real
// price. Returns null (not a fabricated proposal) for any of:
// - a currency mismatch (never compare cents across currencies — same rule
//   savings.ts/computeLatestPriceChange/estimatePaidCents all follow);
// - a $0 monthly-equivalent baseline (percent change undefined);
// - a move under MEANINGFUL_PRICE_CHANGE_PERCENT (noise, not a real change).
// Deliberately has no opinion on match confidence, promo pricing, or
// one-off charges — those are the caller's (detection.ts) job, using
// signals (confidence, introPricingDetected/representativeAmount) this
// function doesn't have access to and shouldn't re-derive.
export function computePriceChangeIfMeaningful(existing: PricePoint, candidate: PricePoint): PriceChangeCandidate | null {
  if (existing.currency !== candidate.currency) return null;
  const existingMonthly = monthlyCents(existing.amountCents, existing.billingCycle);
  if (existingMonthly === 0) return null;
  const candidateMonthly = monthlyCents(candidate.amountCents, candidate.billingCycle);
  const percentChange = ((candidateMonthly - existingMonthly) / existingMonthly) * 100;
  if (Math.abs(percentChange) < MEANINGFUL_PRICE_CHANGE_PERCENT) return null;
  // Not (candidateMonthly - existingMonthly) * 12 — see PriceChange's own
  // annualDeltaCents comment above for why each side's exact annual figure,
  // differenced, is more correct than a monthly-equivalent delta scaled by 12.
  return {
    percentChange,
    annualDeltaCents: annualCents(candidate.amountCents, candidate.billingCycle) - annualCents(existing.amountCents, existing.billingCycle),
  };
}

const CYCLE_DAYS: Record<Subscription["billingCycle"], number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

// "Est. paid since tracking" (subscription-summary.tsx's detail-page
// stat). Estimated, not invented: there's no real charge history to read
// (no bank connection, no stored transaction log for manually-added
// subscriptions), so this is openly derived from billing cycle × time
// tracked, labeled as such rather than presented as a fact this app
// doesn't actually have.
//
// `history.length < 2` (no genuine price change ever recorded — the
// overwhelming common case today, since this table only started capturing
// real history this phase) takes the exact original single-price
// calculation, byte-for-byte unchanged: this must never produce a
// different number for a subscription whose price has never changed.
// Only once real multi-row history exists does this sum each price
// *segment* (the span between one recorded price and the next, or "now"
// for the current one) at that segment's own rate — applying today's
// price across the whole tracked window used to silently overstate or
// understate real spend the moment a subscription's price ever changed
// (raised in local-council review, Compliance + Maintainability lenses:
// the price-history note could say "price increased 20% on [date]" right
// next to an "Est. paid" figure computed as if the price had always been
// the new one).
//
// Each closed (non-current) segment counts only whole elapsed periods —
// it definitely completed at least that many, since a new price starting
// is exactly what closed it. The current (last) segment keeps the
// original "+1" convention: the in-progress period counts as paid too,
// same approximation the single-price case already made.
//
// Two things caught in CodeRabbit review, both fixed here:
// - A subscription that predates this table (created before Phase 9
//   shipped, so it never got an "initial" row) can have its earliest
//   history row dated well after its real `createdAt` — the gap between
//   the two was being silently dropped, undercounting real elapsed spend.
//   A synthetic leading segment covers exactly that gap, at the earliest
//   known row's own rate (the same "best honest estimate from what's
//   actually known" the original single-price formula already made for
//   every subscription before this table existed) — closed, not current,
//   since a real recorded row is what ends it.
// - A segment whose currency differs from the subscription's *current*
//   currency is skipped rather than summed in — currency is unvalidated
//   free text on this schema, and adding cents across currencies would
//   produce a number wearing a real one's formatting (the same rule
//   computeRealizedSavings/computeFunctionalOverlapGroups enforce
//   elsewhere). The result is an honest partial total, consistent with
//   this whole figure already being labeled "Est."
export function estimatePaidCents(subscription: Subscription, history: SubscriptionPriceHistory[]): number {
  if (history.length < 2) {
    const daysSinceTracked = Math.max(0, Math.floor((Date.now() - subscription.createdAt.getTime()) / 86_400_000));
    const cycleDays = CYCLE_DAYS[subscription.billingCycle];
    const periodsElapsed = Math.max(1, Math.floor(daysSinceTracked / cycleDays) + 1);
    return periodsElapsed * subscription.amountCents;
  }

  const sorted = [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const now = Date.now();
  let total = 0;

  const preHistoryDays = Math.max(0, Math.floor((sorted[0].observedAt.getTime() - subscription.createdAt.getTime()) / 86_400_000));
  if (preHistoryDays > 0 && sorted[0].currency === subscription.currency) {
    const periods = Math.floor(preHistoryDays / CYCLE_DAYS[sorted[0].billingCycle]);
    total += periods * sorted[0].amountCents;
  }

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (row.currency !== subscription.currency) continue;
    const segmentStart = row.observedAt.getTime();
    const segmentEnd = i + 1 < sorted.length ? sorted[i + 1].observedAt.getTime() : now;
    const segmentDays = Math.max(0, Math.floor((segmentEnd - segmentStart) / 86_400_000));
    const cycleDays = CYCLE_DAYS[row.billingCycle];
    const isCurrentSegment = i === sorted.length - 1;
    const periods = isCurrentSegment
      ? Math.max(1, Math.floor(segmentDays / cycleDays) + 1)
      : Math.floor(segmentDays / cycleDays);
    total += periods * row.amountCents;
  }
  return total;
}

export interface PortfolioPriceChangeEntry {
  subscription: Subscription;
  change: PriceChange;
}

// Product-value pass: the portfolio-wide view computeLatestPriceChange never
// had one before — that function only ever answered "did THIS subscription's
// price change," read one at a time on the subscription detail page. This
// is the same real data (subscriptionPriceHistory), just asked across every
// active subscription at once: "how many of my subscriptions got more
// expensive, and by how much in total" — the Analytics "Price changes"
// section and notification generation both need exactly this, and neither
// should re-derive its own copy of "what counts as a genuine change" (that
// stays computeLatestPriceChange's job, called here unchanged).
//
// Increases only (percentChange > 0) — a price decrease is real and worth
// showing on that one subscription's own page, but "how much more you're
// paying" is what this portfolio view exists to answer; mixing in
// decreases would understate the real cost of the increases when summed.
// Restricted to active subscriptions and, like every other portfolio total
// in this codebase, to a single shared currency (the caller's active set's
// primary currency) — never summed across currencies.
export function computePortfolioPriceChanges(
  subscriptions: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
): PortfolioPriceChangeEntry[] {
  const active = subscriptions.filter((s) => s.status === "active");
  const entries: PortfolioPriceChangeEntry[] = [];
  for (const subscription of active) {
    const history = priceHistoryBySubscriptionId.get(subscription.id);
    if (!history) continue;
    const change = computeLatestPriceChange(history);
    if (change && change.percentChange > 0) entries.push({ subscription, change });
  }
  // Biggest real annual impact first — the same "explainable, real-field
  // tiebreak, never a black-box score" posture savings.ts's own
  // prioritization comment documents.
  return entries.sort((a, b) => b.change.annualDeltaCents - a.change.annualDeltaCents);
}

export interface PortfolioPriceChangeTotal {
  annualDeltaCents: number;
  currency: string;
}

// Sums annualDeltaCents across entries that share one currency (the
// entries list's own first currency, same "primary currency" convention
// splitByPrimaryCurrency uses elsewhere) — null when the increases found
// span more than one currency, an honest gap rather than a fabricated
// cross-currency sum, same rule computeRealizedSavings/
// computeTotalPotentialSavingsMonthlyCents already follow.
export function sumPortfolioPriceChanges(entries: PortfolioPriceChangeEntry[]): PortfolioPriceChangeTotal | null {
  if (entries.length === 0) return null;
  const currency = entries[0].change.currency;
  if (!entries.every((e) => e.change.currency === currency)) return null;
  return { annualDeltaCents: entries.reduce((sum, e) => sum + e.change.annualDeltaCents, 0), currency };
}

const CREEPING_COST_WINDOW_DAYS = 365;

// "Creeping cost" (watchdog phase, product council recommendation): how
// much additional recurring spending has accumulated from price increases
// over the trailing 12 months. Deliberately a DIFFERENT computation from
// computePortfolioPriceChanges above, not a reuse of its output: that
// function (built for the price-change notification/analytics list) only
// ever looks at each subscription's LATEST genuine change
// (computeLatestPriceChange walks backward from the newest row) — a
// subscription that increased twice in the last year would only count its
// most recent increase there. This function instead walks every
// CONSECUTIVE pair in a subscription's history and sums every genuine
// (>=3%, same-currency — computePriceChangeIfMeaningful's own bar, reused
// verbatim, not a second threshold) increase whose observedAt falls inside
// the trailing window, so two real increases in one year are both counted,
// not just the latest.
//
// Decreases are excluded (this measures cost creeping UP, the whole point
// of the metric); a decrease inside the same window doesn't offset an
// increase elsewhere — an honest choice, not an oversight: "how much has
// crept in from increases" and "what's the net change" are different
// questions, and conflating them would let a coincidental decrease on one
// subscription mask a real, ongoing increase on another.
//
// Restricted to one shared currency across every counted increase (the
// first counted entry's own currency) — same "never fabricate a
// cross-currency total" rule every other portfolio sum in this file
// follows; an increase in a different currency simply doesn't participate,
// same disposition sumPortfolioPriceChanges already has.
export function computeCreepingCostTrailing12Months(
  subscriptions: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
  now: Date = new Date(),
): PortfolioPriceChangeTotal | null {
  const windowStart = now.getTime() - CREEPING_COST_WINDOW_DAYS * 86_400_000;
  const active = subscriptions.filter((s) => s.status === "active");

  let currency: string | null = null;
  let totalCents = 0;
  let counted = false;

  for (const subscription of active) {
    const history = priceHistoryBySubscriptionId.get(subscription.id);
    if (!history || history.length < 2) continue;
    const sorted = [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());

    for (let i = 1; i < sorted.length; i++) {
      const later = sorted[i];
      if (later.observedAt.getTime() < windowStart) continue; // the increase itself must have happened within the window
      const earlier = sorted[i - 1];
      const change = computePriceChangeIfMeaningful(
        { amountCents: earlier.amountCents, billingCycle: earlier.billingCycle, currency: earlier.currency },
        { amountCents: later.amountCents, billingCycle: later.billingCycle, currency: later.currency },
      );
      if (!change || change.percentChange <= 0) continue;

      if (currency === null) currency = later.currency;
      if (later.currency !== currency) continue; // honest gap, not a fabricated cross-currency sum — see this function's own header comment
      totalCents += change.annualDeltaCents;
      counted = true;
    }
  }

  if (!counted || currency === null) return null;
  return { annualDeltaCents: totalCents, currency };
}

export interface SpendHistoryEvent {
  subscriptionId: string;
  subscriptionName: string;
  fromCents: number;
  toCents: number;
  currency: string;
  // Signed, same convention as PriceChange.annualDeltaCents above —
  // positive is an increase, negative is a decrease.
  percentChange: number;
  annualDeltaCents: number;
  observedAtIso: string;
}

export interface SpendHistoryPoint {
  monthIso: string;
  monthLabel: string;
  // The active portfolio's real monthly-equivalent cost AS OF this month —
  // not a running total, moves up or down with genuine price changes.
  totalMonthlyCents: number;
  // Genuine price changes whose observedAt falls inside this exact month,
  // biggest annual impact first — the "why did the line move here" answer
  // for whichever month a viewer is looking at.
  events: SpendHistoryEvent[];
}

function spendHistoryMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const spendHistoryMonthLabelFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// Bounded lookback so a multi-year account can't render an ever-widening
// chart — same "bounded, not unlimited" posture computeRenewalsTimeline's
// own 12-month forward-looking cap follows, just backward and roomier
// (price history is worth seeing further back than a renewal forecast).
const SPEND_HISTORY_MAX_MONTHS = 24;

// Free plan sees the most recent FREE_SPEND_HISTORY_MONTHS; Pro sees the
// full reconstructed range. Same "recent slice for Free, full depth for
// Pro" shape as FREE_NOTIFICATION_HISTORY_LIMIT (notifications/queries.ts)
// — deeper history is a genuine, non-arbitrary Pro differentiator (the
// underlying subscriptionPriceHistory rows are captured for every plan;
// only how far back this chart is allowed to render them differs).
export const FREE_SPEND_HISTORY_MONTHS = 6;

// "Spend history": what this account's ACTIVE portfolio has genuinely cost,
// month by month, reconstructed entirely from subscriptionPriceHistory (and
// each subscription's own createdAt/amountCents/billingCycle as the
// pre-history fallback — the same "current stored price is the only real
// fact known before any history row exists" fallback estimatePaidCents'
// own history.length < 2 branch already uses).
//
// Deliberately the metric computeGrowthOverTime (analytics.ts) is NOT: that
// function answers "how much recurring spend have I ever added to
// SubSentry" (every status, buckets by createdAt only, never decreases —
// see its own comment for why that's the right question for what it's
// for). This one answers "what does what I'm actually paying right now
// cost, and how did it get here" — active subscriptions only, and the line
// moves with every genuine price change, including down if one ever
// genuinely fell.
//
// Restricted to active subscriptions and one shared currency (this active
// set's own primary currency, splitByPrimaryCurrency) — same "never
// fabricate a cross-currency total" rule every other portfolio sum in this
// file follows. A subscription that's canceled at any point during the
// reconstructed window isn't counted for ANY month, including ones before
// it was canceled — an honest gap, not a claim about total historical
// spend: this table tracks current status, not a statusChangedAt, so there
// is no real timestamp to reconstruct "was it active in March" from (see
// schema.ts's own subscriptions table comment).
export function computeSpendHistory(
  subscriptions: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
  now: Date = new Date(),
): SpendHistoryPoint[] {
  const { currency, included: active } = splitByPrimaryCurrency(subscriptions.filter((s) => s.status === "active"));
  if (!currency || active.length === 0) return [];

  const historyBySubscription = new Map<string, SubscriptionPriceHistory[]>();
  for (const subscription of active) {
    const history = (priceHistoryBySubscriptionId.get(subscription.id) ?? []).filter((h) => h.currency === currency);
    historyBySubscription.set(subscription.id, [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime()));
  }

  const earliestCreatedAt = active.reduce((min, s) => (s.createdAt < min ? s.createdAt : min), active[0].createdAt);
  const capStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (SPEND_HISTORY_MAX_MONTHS - 1), 1));
  const trueStart = new Date(Date.UTC(earliestCreatedAt.getUTCFullYear(), earliestCreatedAt.getUTCMonth(), 1));
  const start = trueStart > capStart ? trueStart : capStart;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const points: SpendHistoryPoint[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const cursorKey = spendHistoryMonthKey(cursor);
    let totalMonthlyCents = 0;
    const events: SpendHistoryEvent[] = [];

    for (const subscription of active) {
      if (subscription.createdAt > monthEnd) continue; // didn't exist yet as of this month

      const history = historyBySubscription.get(subscription.id) ?? [];
      // Latest history row observed at or before this month's end — "what
      // this subscription actually cost as of this point in time," never
      // today's price applied retroactively (same segment-aware discipline
      // estimatePaidCents already applies). No matching row (before any
      // history was captured for this subscription) falls back to its
      // current stored price, same as estimatePaidCents' own fallback.
      let asOf: SubscriptionPriceHistory | undefined;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].observedAt <= monthEnd) {
          asOf = history[i];
          break;
        }
      }
      totalMonthlyCents += monthlyCents(asOf?.amountCents ?? subscription.amountCents, asOf?.billingCycle ?? subscription.billingCycle);

      // Genuine price-change events landing inside this exact month —
      // walking consecutive pairs, same discipline
      // computeCreepingCostTrailing12Months already applies (including
      // reusing its own computePriceChangeIfMeaningful bar), just without
      // that function's 12-month/increases-only restriction: this is an
      // honest record of what changed and when, in either direction.
      for (let i = 1; i < history.length; i++) {
        const later = history[i];
        if (spendHistoryMonthKey(later.observedAt) !== cursorKey) continue;
        const earlier = history[i - 1];
        const change = computePriceChangeIfMeaningful(
          { amountCents: earlier.amountCents, billingCycle: earlier.billingCycle, currency: earlier.currency },
          { amountCents: later.amountCents, billingCycle: later.billingCycle, currency: later.currency },
        );
        if (!change) continue;
        events.push({
          subscriptionId: subscription.id,
          subscriptionName: subscription.name,
          fromCents: earlier.amountCents,
          toCents: later.amountCents,
          currency,
          percentChange: change.percentChange,
          annualDeltaCents: change.annualDeltaCents,
          observedAtIso: later.observedAt.toISOString().slice(0, 10),
        });
      }
    }

    points.push({
      monthIso: cursorKey,
      monthLabel: spendHistoryMonthLabelFormatter.format(cursor),
      totalMonthlyCents,
      events: events.sort((a, b) => Math.abs(b.annualDeltaCents) - Math.abs(a.annualDeltaCents)),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return points;
}

export interface SpendHistoryVisibility {
  points: SpendHistoryPoint[];
  hiddenMonths: number;
}

// Same "recent slice visible for Free, full depth for Pro" shape as
// FREE_NOTIFICATION_HISTORY_LIMIT (notifications/queries.ts) — a strict
// suffix of the Pro list (the most recent months), never a reshuffled or
// sampled subset, so a Free caller's chart is always a truncated prefix of
// what Pro sees rather than a different story.
export function sliceSpendHistoryForPlan(points: SpendHistoryPoint[], isPremium: boolean): SpendHistoryVisibility {
  if (isPremium || points.length <= FREE_SPEND_HISTORY_MONTHS) return { points, hiddenMonths: 0 };
  return {
    points: points.slice(points.length - FREE_SPEND_HISTORY_MONTHS),
    hiddenMonths: points.length - FREE_SPEND_HISTORY_MONTHS,
  };
}
