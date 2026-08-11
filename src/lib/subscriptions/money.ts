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
