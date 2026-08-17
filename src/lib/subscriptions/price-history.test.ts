import { describe, it, expect } from "vitest";
import { computeLatestPriceChange } from "./price-history";
import type { SubscriptionPriceHistory } from "@/lib/db/schema";

function row(overrides: Partial<SubscriptionPriceHistory>): SubscriptionPriceHistory {
  return {
    id: overrides.id ?? "row-id",
    subscriptionId: "sub-id",
    userId: "user-id",
    amountCents: 1000,
    billingCycle: "monthly",
    currency: "usd",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    source: "initial",
    ...overrides,
  };
}

describe("computeLatestPriceChange", () => {
  it("returns null for 0 or 1 rows", () => {
    expect(computeLatestPriceChange([])).toBeNull();
    expect(computeLatestPriceChange([row({})])).toBeNull();
  });

  it("returns null when every row has the same monthly-equivalent amount and currency", () => {
    const history = [
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1000, observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(computeLatestPriceChange(history)).toBeNull();
  });

  it("detects a price increase and computes a signed percent change plus annualized delta", () => {
    const history = [
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z"), source: "initial" }),
      row({ id: "b", amountCents: 1200, observedAt: new Date("2026-02-01T00:00:00Z"), source: "user_edit" }),
    ];
    const change = computeLatestPriceChange(history);
    expect(change).toEqual({
      fromCents: 1000,
      fromBillingCycle: "monthly",
      toCents: 1200,
      toBillingCycle: "monthly",
      currency: "usd",
      observedAtIso: "2026-02-01",
      percentChange: 20,
      annualDeltaCents: 2400,
    });
  });

  it("detects a price decrease with a negative percent change and negative annualized delta", () => {
    const history = [
      row({ id: "a", amountCents: 2000, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1000, observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    const change = computeLatestPriceChange(history);
    expect(change?.percentChange).toBe(-50);
    expect(change?.annualDeltaCents).toBe(-12000);
  });

  it("is order-independent — unsorted input is sorted internally by observedAt", () => {
    const history = [
      row({ id: "b", amountCents: 1200, observedAt: new Date("2026-02-01T00:00:00Z") }),
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
    ];
    expect(computeLatestPriceChange(history)?.toCents).toBe(1200);
  });

  it("walks back past a run of identical rows to find the real prior price", () => {
    const history = [
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1000, observedAt: new Date("2026-01-15T00:00:00Z") }),
      row({ id: "c", amountCents: 1500, observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    const change = computeLatestPriceChange(history);
    expect(change).toMatchObject({ fromCents: 1000, toCents: 1500 });
  });

  it("returns null when the currency changed between the two most recent distinct rows", () => {
    const history = [
      row({ id: "a", amountCents: 1000, currency: "usd", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 900, currency: "gbp", observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(computeLatestPriceChange(history)).toBeNull();
  });

  it("returns null rather than dividing by zero when the prior monthly-equivalent price was 0", () => {
    const history = [
      row({ id: "a", amountCents: 0, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 999, observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(computeLatestPriceChange(history)).toBeNull();
  });

  it("normalizes through the monthly equivalent when billing cycle changes, not raw amountCents", () => {
    // $10/mo -> $100/yr: monthly-equivalent goes from 1000 to ~833, a real
    // ~17% *decrease* — comparing raw amountCents (1000 -> 10000) would
    // wrongly read as a 10x increase.
    const history = [
      row({ id: "a", amountCents: 1000, billingCycle: "monthly", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 10000, billingCycle: "yearly", observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    const change = computeLatestPriceChange(history);
    expect(change?.fromBillingCycle).toBe("monthly");
    expect(change?.toBillingCycle).toBe("yearly");
    expect(change?.percentChange).toBeLessThan(0);
    expect(change?.annualDeltaCents).toBeLessThan(0);
  });

  it("treats an equivalent price under a different billing cycle as no change", () => {
    // $12/mo === $144/yr exactly — same monthly-equivalent, just re-billed.
    const history = [
      row({ id: "a", amountCents: 1200, billingCycle: "monthly", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 14400, billingCycle: "yearly", observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(computeLatestPriceChange(history)).toBeNull();
  });
});
