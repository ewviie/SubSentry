import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { computeLatestPriceChange, estimatePaidCents } from "./price-history";
import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";

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

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-id",
    userId: "user-id",
    name: "Test Sub",
    amountCents: 1000,
    currency: "usd",
    billingCycle: "monthly",
    category: "other",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
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

describe("estimatePaidCents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("with < 2 history rows, matches the original single-price formula exactly (no behavior change for the common case)", () => {
    // Tracked 45 days (Jan 15 -> Mar 1), $10/mo, 30-day cycle:
    // floor(45/30)+1 = 2 periods -> $20.00.
    const subscription = sub({ amountCents: 1000, billingCycle: "monthly", createdAt: new Date("2026-01-15T00:00:00Z") });
    expect(estimatePaidCents(subscription, [])).toBe(2000);
    expect(estimatePaidCents(subscription, [row({ amountCents: 1000, observedAt: new Date("2026-01-15T00:00:00Z") })])).toBe(
      2000,
    );
  });

  it("sums each closed price segment at its own rate, plus the current segment's in-progress period", () => {
    // $10/mo Jan 1 -> Feb 1 (31 days, closed): floor(31/30) = 1 period -> $10.00
    // $15/mo Feb 1 -> Mar 1 "now" (28 days, current): floor(28/30)+1 = 1 period -> $15.00
    // Total: $25.00
    const subscription = sub({ amountCents: 1500, billingCycle: "monthly", createdAt: new Date("2026-01-01T00:00:00Z") });
    const history = [
      row({ id: "a", amountCents: 1000, billingCycle: "monthly", observedAt: new Date("2026-01-01T00:00:00Z"), source: "initial" }),
      row({ id: "b", amountCents: 1500, billingCycle: "monthly", observedAt: new Date("2026-02-01T00:00:00Z"), source: "user_edit" }),
    ];
    expect(estimatePaidCents(subscription, history)).toBe(2500);
  });

  it("accounts for a billing-cycle change between segments (not just amount)", () => {
    // $10/mo Jan 1 -> Feb 1 (31 days, closed, monthly cycle=30): floor(31/30) = 1 period -> $10.00
    // $100/yr Feb 1 -> Mar 1 "now" (28 days, current, yearly cycle=365): floor(28/365)+1 = 1 period -> $100.00
    const subscription = sub({ amountCents: 10000, billingCycle: "yearly", createdAt: new Date("2026-01-01T00:00:00Z") });
    const history = [
      row({ id: "a", amountCents: 1000, billingCycle: "monthly", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 10000, billingCycle: "yearly", observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(estimatePaidCents(subscription, history)).toBe(11000);
  });

  it("never returns a negative or NaN figure for a same-day multi-row history", () => {
    const subscription = sub({ amountCents: 1000, createdAt: new Date("2026-03-01T00:00:00Z") });
    const history = [
      row({ id: "a", amountCents: 800, observedAt: new Date("2026-03-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1000, observedAt: new Date("2026-03-01T00:00:00Z") }),
    ];
    const result = estimatePaidCents(subscription, history);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
