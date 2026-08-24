import { describe, it, expect } from "vitest";
import {
  monthlyCents,
  annualCents,
  formatCents,
  amountStringToCents,
  centsToAmountString,
  sumMonthlyCentsIfSingleCurrency,
  splitByPrimaryCurrency,
} from "./money";

describe("monthlyCents", () => {
  it("returns the amount unchanged for monthly billing", () => {
    expect(monthlyCents(1599, "monthly")).toBe(1599);
  });

  it("rounds yearly amounts to the nearest cent instead of returning a float", () => {
    // 10000 / 12 = 833.333... — must round, never leak a float cent value.
    expect(monthlyCents(10000, "yearly")).toBe(833);
    expect(Number.isInteger(monthlyCents(10000, "yearly"))).toBe(true);
  });

  it("rounds quarterly amounts to the nearest cent", () => {
    // 1000 / 3 = 333.333...
    expect(monthlyCents(1000, "quarterly")).toBe(333);
    expect(Number.isInteger(monthlyCents(1000, "quarterly"))).toBe(true);
  });

  it("rounds weekly amounts (x52/12) to the nearest cent", () => {
    expect(monthlyCents(999, "weekly")).toBe(Math.round((999 * 52) / 12));
    expect(Number.isInteger(monthlyCents(999, "weekly"))).toBe(true);
  });
});

describe("annualCents", () => {
  it("$10.00/mo -> exactly $120.00/yr", () => {
    expect(annualCents(1000, "monthly")).toBe(12000);
  });

  it("a yearly subscription's own stored amount IS the annual figure — no conversion, no rounding", () => {
    expect(annualCents(9999, "yearly")).toBe(9999);
  });

  it("$10.00/quarter -> exactly $40.00/yr (x4, not a monthly-equivalent detour)", () => {
    expect(annualCents(1000, "quarterly")).toBe(4000);
  });

  it("$10.00/week -> exactly $520.00/yr (x52, not a monthly-equivalent detour)", () => {
    expect(annualCents(1000, "weekly")).toBe(52000);
  });

  // The actual bug this function exists to fix: monthlyCents(...) rounds
  // for yearly/quarterly/weekly cycles, and multiplying that already-rounded
  // result by 12 used to compound the rounding a second time. These three
  // cases each demonstrate a real, nonzero gap between the old
  // (monthlyCents(...) * 12) approach and the correct one — proof the fix
  // changes a real answer, not just refactors equivalent code.
  it("regression: a yearly $99.99 subscription no longer shows as $99.96/yr", () => {
    const buggyOldWay = monthlyCents(9999, "yearly") * 12;
    expect(buggyOldWay).toBe(9996); // $99.96 — wrong, doesn't match the stored $99.99
    expect(annualCents(9999, "yearly")).toBe(9999); // $99.99 — correct, exact
  });

  it("regression: a quarterly $10.00 subscription no longer shows as $39.96/yr", () => {
    const buggyOldWay = monthlyCents(1000, "quarterly") * 12;
    expect(buggyOldWay).toBe(3996); // $39.96 — wrong
    expect(annualCents(1000, "quarterly")).toBe(4000); // $40.00 — correct, exact
  });

  it("regression: a weekly $10.00 subscription no longer shows as $519.96/yr", () => {
    const buggyOldWay = monthlyCents(1000, "weekly") * 12;
    expect(buggyOldWay).toBe(51996); // $519.96 — wrong
    expect(annualCents(1000, "weekly")).toBe(52000); // $520.00 — correct, exact
  });

  it("monthly never needed rounding either way, so the old and new approaches already agreed", () => {
    expect(monthlyCents(1549, "monthly") * 12).toBe(annualCents(1549, "monthly"));
  });
});

describe("formatCents", () => {
  it("formats cents as a currency string", () => {
    expect(formatCents(1599)).toBe("$15.99");
  });

  it("respects the currency argument", () => {
    expect(formatCents(1099, "gbp")).toBe("£10.99");
  });

  // Regression: Intl.NumberFormat throws a RangeError for any currency
  // string that isn't a well-formed 3-letter alpha code — reachable in
  // practice from a bank CSV's free-text Currency column (csv-parser.ts
  // only trims/lowercases it, never validates shape) rendered in the
  // import review UI before subscriptionInputSchema's own check ever runs.
  // Must degrade, never throw.
  it("falls back to a plain amount + code instead of throwing on a malformed currency string", () => {
    expect(() => formatCents(999, "us dollar")).not.toThrow();
    expect(formatCents(999, "us dollar")).toBe("9.99 US DOLLAR");
  });

  it("falls back gracefully on an empty currency string", () => {
    expect(() => formatCents(999, "")).not.toThrow();
    expect(formatCents(999, "")).toBe("9.99 ");
  });

  // A well-formed-but-unrecognized 3-letter code (not a real ISO 4217
  // currency) does NOT throw — V8's Intl.NumberFormat only validates the
  // shape, not membership in the real currency registry — so this still
  // takes the normal formatting path, not the fallback.
  it("formats a well-formed but unrecognized 3-letter code without throwing", () => {
    expect(() => formatCents(1000, "xzz")).not.toThrow();
  });
});

describe("amountStringToCents", () => {
  it("converts a plain decimal string to integer cents without float drift", () => {
    expect(amountStringToCents("19.99")).toBe(1999);
  });

  it("handles whole-dollar amounts with no decimal part", () => {
    expect(amountStringToCents("20")).toBe(2000);
  });

  it("pads a single decimal digit", () => {
    expect(amountStringToCents("5.5")).toBe(550);
  });
});

describe("centsToAmountString", () => {
  it("round-trips with amountStringToCents", () => {
    expect(centsToAmountString(amountStringToCents("15.99"))).toBe("15.99");
  });
});

describe("sumMonthlyCentsIfSingleCurrency", () => {
  it("sums monthly-equivalent cents across rows sharing one currency", () => {
    const result = sumMonthlyCentsIfSingleCurrency([
      { amount: "15.99", currency: "usd", billingCycle: "monthly" },
      { amount: "9.99", currency: "usd", billingCycle: "monthly" },
    ]);
    expect(result).toEqual({ totalMonthlyCents: 2598, currency: "usd" });
  });

  it("normalizes non-monthly cycles into the total, same as monthlyCents", () => {
    const result = sumMonthlyCentsIfSingleCurrency([
      { amount: "120.00", currency: "usd", billingCycle: "yearly" },
    ]);
    expect(result).toEqual({ totalMonthlyCents: monthlyCents(12000, "yearly"), currency: "usd" });
  });

  // Regression: a batch spanning more than one currency must never collapse
  // into a single summed number under one currency's label — that's a
  // fabricated figure wearing a real one's formatting. Every provider sets
  // `currency` per-row independently (Plaid's iso_currency_code, a CSV's
  // free-text Currency column), so a mixed batch is a real, reachable case,
  // not a hypothetical one.
  it("returns null when rows span more than one currency", () => {
    const result = sumMonthlyCentsIfSingleCurrency([
      { amount: "15.99", currency: "usd", billingCycle: "monthly" },
      { amount: "9.99", currency: "eur", billingCycle: "monthly" },
    ]);
    expect(result).toBeNull();
  });

  it("returns null for an empty selection", () => {
    expect(sumMonthlyCentsIfSingleCurrency([])).toBeNull();
  });

  it("returns the single row's own monthly-equivalent total for one row", () => {
    const result = sumMonthlyCentsIfSingleCurrency([{ amount: "15.99", currency: "gbp", billingCycle: "monthly" }]);
    expect(result).toEqual({ totalMonthlyCents: 1599, currency: "gbp" });
  });
});

describe("splitByPrimaryCurrency", () => {
  it("puts every row in `included` and none in `excluded` for an all-single-currency list", () => {
    const rows = [{ currency: "usd", id: 1 }, { currency: "usd", id: 2 }, { currency: "usd", id: 3 }];
    const result = splitByPrimaryCurrency(rows);
    expect(result.currency).toBe("usd");
    expect(result.included).toEqual(rows);
    expect(result.excluded).toEqual([]);
  });

  it("picks the most common currency by count, not the first or largest amount", () => {
    // 2 gbp rows outnumber 1 usd row — gbp must win even though usd
    // appears first in the array.
    const usd = { currency: "usd", id: "usd-1" };
    const gbp1 = { currency: "gbp", id: "gbp-1" };
    const gbp2 = { currency: "gbp", id: "gbp-2" };
    const result = splitByPrimaryCurrency([usd, gbp1, gbp2]);
    expect(result.currency).toBe("gbp");
    expect(result.included).toEqual([gbp1, gbp2]);
    expect(result.excluded).toEqual([usd]);
  });

  it("never drops a row silently — included.length + excluded.length always equals the input length", () => {
    const rows = [
      { currency: "usd" }, { currency: "eur" }, { currency: "usd" },
      { currency: "gbp" }, { currency: "usd" }, { currency: "eur" },
    ];
    const result = splitByPrimaryCurrency(rows);
    expect(result.included.length + result.excluded.length).toBe(rows.length);
    expect(result.currency).toBe("usd"); // 3 usd rows beat 2 eur beats 1 gbp
  });

  it("returns a null currency and two empty arrays for zero rows, not usd by default", () => {
    const result = splitByPrimaryCurrency([]);
    expect(result).toEqual({ currency: null, included: [], excluded: [] });
  });
});
