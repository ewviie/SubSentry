import type { SubscriptionPriceHistory } from "@/lib/db/schema";

// Phase 9: the read side of price-history capture — see schema.ts's own
// comment on subscriptionPriceHistory for why this table starts empty of
// real history for existing subscriptions (no fabricated backfill) and
// queries.ts's updateSubscription for exactly when a new row is written.
// This module only ever reads what's actually there; it has no fallback
// that invents a plausible-looking change.
export interface PriceChange {
  fromCents: number;
  toCents: number;
  currency: string;
  // The date the new price was first observed, YYYY-MM-DD.
  observedAtIso: string;
  // Signed — positive is an increase, negative is a decrease.
  percentChange: number;
}

// The most recent genuine price change in a subscription's history, or
// null when there isn't one (yet). "Genuine" excludes two kinds of
// same-looking-but-meaningless rows:
// - Two consecutive rows with an identical amountCents/currency (an edit
//   that touched an unrelated field but re-submitted the same price,
//   still gated out at the write side in queries.ts, but this reads
//   defensively rather than assuming that invariant always holds).
// - A pair of rows whose currency differs — a percent change across two
//   different currencies is not a meaningful number (same "never compute
//   across currencies" rule savings.ts's computeRealizedSavings already
//   follows), so this returns null rather than a misleading percentage.
export function computeLatestPriceChange(history: SubscriptionPriceHistory[]): PriceChange | null {
  if (history.length < 2) return null;
  const sorted = [...history].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const latest = sorted[sorted.length - 1];

  for (let i = sorted.length - 2; i >= 0; i--) {
    const candidate = sorted[i];
    if (candidate.amountCents === latest.amountCents && candidate.currency === latest.currency) continue;
    if (candidate.currency !== latest.currency) return null;
    // A prior $0 price makes "percent change" undefined (divide by zero) —
    // amountCents is validated non-negative but not non-zero (subscription
    // form allows "0.00" for a free trial/promo), so this is a real,
    // reachable case, not just defensive padding.
    if (candidate.amountCents === 0) return null;

    return {
      fromCents: candidate.amountCents,
      toCents: latest.amountCents,
      currency: latest.currency,
      observedAtIso: latest.observedAt.toISOString().slice(0, 10),
      percentChange: ((latest.amountCents - candidate.amountCents) / candidate.amountCents) * 100,
    };
  }
  return null;
}
