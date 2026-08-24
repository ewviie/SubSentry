import type { Subscription } from "@/lib/db/schema";

// Rounded to the nearest cent — amountCents is always an integer per the
// codebase's own invariant (see amountStringToCents below), and division
// here would otherwise return a float, silently breaking that invariant
// for every yearly/quarterly/weekly subscription.
export function monthlyCents(amountCents: number, cycle: Subscription["billingCycle"]): number {
  switch (cycle) {
    case "monthly":
      return amountCents;
    case "yearly":
      return Math.round(amountCents / 12);
    case "quarterly":
      return Math.round(amountCents / 3);
    case "weekly":
      return Math.round((amountCents * 52) / 12);
  }
}

// Annualizes directly from the billing cycle — never via monthlyCents(...) *
// 12. monthlyCents() rounds for yearly/quarterly/weekly cycles (dividing by
// 12, 3, or a non-integer 12/52 ratio); multiplying that already-rounded
// result by 12 compounds the rounding a second time instead of computing
// the exact annual figure in one step. Every branch below is instead an
// exact integer operation (or, for yearly, no conversion at all — the
// stored amount already *is* the annual figure): a yearly subscription
// stored as $99.99 (9999 cents) previously showed as $99.96/yr
// (monthlyCents rounds 9999/12 to 833, 833*12 = 9996) — a real, silent
// mismatch between an "annual total" and the subscription's own stored
// price, not a rounding difference too small to matter in principle, just
// one nobody had traced end to end before. A weekly $10 subscription
// (1000 cents) had the same problem: monthlyCents rounds 1000*52/12 to
// 4333, 4333*12 = 51996 cents ($519.96), not the true 1000*52 = 52000
// cents ($520.00) an exact weekly->annual conversion gives.
//
// analytics.ts's computeTopMerchantsBySpend already had this exact fix,
// independently, as a local, unexported function with this identical
// reasoning in its own comment — moved here and shared so every other
// annual total in the app (dashboard's own headline figure, health-score's
// expensive-outlier detection, the "high yearly spend" insight, realized
// savings, price-history deltas) gets the same correctness, not just the
// one page that happened to need it first.
export function annualCents(amountCents: number, cycle: Subscription["billingCycle"]): number {
  switch (cycle) {
    case "monthly":
      return amountCents * 12;
    case "yearly":
      return amountCents;
    case "quarterly":
      return amountCents * 4;
    case "weekly":
      return amountCents * 52;
  }
}

// `currency` isn't always something this app validated before it got here —
// the import review UI (review-row.tsx) renders a DetectedSubscription's
// currency straight from RawTransaction, before subscriptionInputSchema's
// own /^[a-z]{3}$/ check ever runs at confirm time (see validation.ts's own
// comment on why that check exists). A bank CSV's free-text "Currency"
// column (csv-parser.ts only trims/lowercases it, never validates its
// shape) or Plaid's unofficial_currency_code can realistically be anything
// — Intl.NumberFormat throws a RangeError for any string that isn't a
// well-formed 3-letter alpha code, which would otherwise crash the whole
// review table mid-render the moment one detected row had a malformed
// value. Falls back to a plain amount + the raw code — still honest about
// what was actually detected, not silently relabeled as USD.
export function formatCents(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

// Parses a decimal string ("15.99") into integer cents via string math, so
// this never touches floating point — avoids the classic 19.99*100 !== 1999
// class of bug in a product whose whole job is getting money right.
export function amountStringToCents(amount: string): number {
  const [dollars, cents = ""] = amount.trim().split(".");
  return Number(dollars) * 100 + Number(cents.padEnd(2, "0").slice(0, 2));
}

export function centsToAmountString(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Shared by review-action-bar.tsx (running total while selecting import
// rows) and import-complete-step.tsx (total just confirmed) — one summing
// implementation so the two screens can't independently drift on rounding
// or currency handling (see each call site's own comment).
//
// Returns null, not a number, whenever the rows don't share exactly one
// currency (including zero rows) — currency is unvalidated free text at
// this point in the import flow (see formatCents' own comment: a bank
// CSV's Currency column, or Plaid's unofficial_currency_code, can be
// anything), so a batch can genuinely mix currencies. Summing raw cents
// across different currencies and labeling the result with just one of
// them would be a fabricated number wearing a real one's formatting —
// exactly what this app's own "never fabricate" rule (see reveal-step.tsx,
// savings.ts) exists to prevent. Callers show the total only when this
// returns non-null, and fall back to a currency-free summary (a plain
// count) otherwise — an honest gap, not a wrong number.
export function sumMonthlyCentsIfSingleCurrency(
  rows: { amount: string; currency: string; billingCycle: Subscription["billingCycle"] }[],
): { totalMonthlyCents: number; currency: string } | null {
  if (rows.length === 0) return null;
  const currency = rows[0].currency;
  if (!rows.every((r) => r.currency === currency)) return null;
  const totalMonthlyCents = rows.reduce(
    (sum, r) => sum + monthlyCents(amountStringToCents(r.amount), r.billingCycle),
    0,
  );
  return { totalMonthlyCents, currency };
}

// This app has no exchange-rate source — never fabricate one. That leaves
// exactly two honest ways to show a single dollar total for a set of
// subscriptions that don't all share one currency: refuse to show a total
// at all (sumMonthlyCentsIfSingleCurrency's and computeRealizedSavings'
// choice, right for a total whose whole point is "this exact group, added
// up"), or total only the subscriptions that DO share the most common
// currency and say so, which is the better choice for the dashboard's own
// headline spend figure — the app's single most-viewed number, and the one
// place a blank total for any multi-currency account (a plausible real
// case: one subscription manually entered in a different currency, or
// imported from a foreign bank) would be a real usefulness regression, not
// just an honesty one. "Most common" is a count of subscriptions, not a
// comparison of dollar amounts — there's no currency-free way to rank
// amounts against each other in the first place, which is the entire
// reason this function exists.
//
// `excluded` is returned, not just its length: a caller that wants to
// disclose *what* was left out (not just how many) can, and a caller that
// only wants the count still has `.length`.
export function splitByPrimaryCurrency<T extends { currency: string }>(
  rows: T[],
): { currency: string | null; included: T[]; excluded: T[] } {
  if (rows.length === 0) return { currency: null, included: [], excluded: [] };
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.currency, (counts.get(row.currency) ?? 0) + 1);
  let currency = rows[0].currency;
  let bestCount = 0;
  for (const [candidate, count] of counts) {
    if (count > bestCount) {
      currency = candidate;
      bestCount = count;
    }
  }
  return {
    currency,
    included: rows.filter((row) => row.currency === currency),
    excluded: rows.filter((row) => row.currency !== currency),
  };
}
