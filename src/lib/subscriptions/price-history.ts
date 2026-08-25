import { monthlyCents, annualCents } from "./money";
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
