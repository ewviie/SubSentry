import { monthlyCents } from "./money";
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
  // Monthly-equivalent delta * 12 — "what this costs differently per year
  // now," the same annualization convention every other dollar figure in
  // this app already uses (dashboard's annualTotalCents, signals.ts's
  // findExpensiveOutliers, ...).
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
    if (candidate.currency !== latest.currency) return null;

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
      annualDeltaCents: (latestMonthly - candidateMonthly) * 12,
    };
  }
  return null;
}
