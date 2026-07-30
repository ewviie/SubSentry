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

export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(cents / 100);
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
