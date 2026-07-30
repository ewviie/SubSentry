import { describe, it, expect } from "vitest";
import { monthlyCents, formatCents, amountStringToCents, centsToAmountString } from "./money";

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

describe("formatCents", () => {
  it("formats cents as a currency string", () => {
    expect(formatCents(1599)).toBe("$15.99");
  });

  it("respects the currency argument", () => {
    expect(formatCents(1099, "gbp")).toBe("£10.99");
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
