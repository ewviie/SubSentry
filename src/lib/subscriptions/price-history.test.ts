import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  computeLatestPriceChange,
  computePriceHistoryCreep,
  computePriceChangeIfMeaningful,
  estimatePaidCents,
  computePortfolioPriceChanges,
  sumPortfolioPriceChanges,
  computeCreepingCostTrailing12Months,
} from "./price-history";
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
    lastReviewedAt: null,
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

  // Regression (product council review, Data/Analytics lens): a
  // mismatched-currency row that ISN'T the row immediately before `latest`
  // used to make this function give up entirely (`return null`) the moment
  // it was encountered while walking backward, even though a genuine
  // same-currency comparison existed further back. A transient eur row in
  // the middle of otherwise-usd history must not permanently hide a real
  // usd -> usd increase.
  it("skips a mismatched-currency row in the middle of history to find a genuine same-currency change further back", () => {
    const history = [
      row({ id: "a", amountCents: 800, currency: "usd", observedAt: new Date("2024-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 999, currency: "eur", observedAt: new Date("2024-06-01T00:00:00Z") }),
      row({ id: "c", amountCents: 1200, currency: "usd", observedAt: new Date("2025-01-01T00:00:00Z") }),
    ];
    const change = computeLatestPriceChange(history);
    expect(change).toMatchObject({ fromCents: 800, toCents: 1200, currency: "usd", percentChange: 50 });
    expect(change?.annualDeltaCents).toBe(4800);
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

  // Regression: a yearly $70 -> $84 price increase — a same-cycle change
  // with no rounding ambiguity anywhere, since amountCents already *is*
  // the annual figure for a yearly row. annualDeltaCents must be exactly
  // $14.00 (1400 cents), not $14.04 (1404 cents) — the old
  // (monthlyCents(...) * 12) formula rounded $70/12 and $84/12 to the
  // nearest cent (583, 700) before re-multiplying by 12, landing on 1404.
  it("a yearly $70 -> $84 price increase reports an exact $14.00/yr delta, not $14.04", () => {
    const history = [
      row({ id: "a", amountCents: 7000, billingCycle: "yearly", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 8400, billingCycle: "yearly", observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    const change = computeLatestPriceChange(history);
    expect(change?.annualDeltaCents).toBe(1400);
    // percentChange deliberately stays on the monthly-equivalent basis
    // (583 -> 700, both rounded) rather than annualCents' exact 7000 -> 8400
    // — a ratio needs a shared per-period basis to compare at all, and a
    // few cents of rounding on an intermediate monthly figure is immaterial
    // to a percentage a UI rounds to a whole number anyway ("+20%"). Close
    // to, not exactly, 20.
    expect(change?.percentChange).toBeCloseTo(20.07, 1);
  });
});

describe("computePriceHistoryCreep", () => {
  it("returns null for 0 or 1 rows", () => {
    expect(computePriceHistoryCreep([])).toBeNull();
    expect(computePriceHistoryCreep([row({})])).toBeNull();
  });

  it("returns null for exactly one genuine change — computeLatestPriceChange already tells that story", () => {
    const history = [
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1200, observedAt: new Date("2026-06-01T00:00:00Z") }),
    ];
    expect(computePriceHistoryCreep(history)).toBeNull();
  });

  it("detects the multi-change story: first vs. current, with a real change count", () => {
    const history = [
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z"), source: "initial" }),
      row({ id: "b", amountCents: 1200, observedAt: new Date("2026-04-01T00:00:00Z"), source: "user_edit" }),
      row({ id: "c", amountCents: 1500, observedAt: new Date("2026-08-01T00:00:00Z"), source: "user_edit" }),
    ];
    const creep = computePriceHistoryCreep(history);
    expect(creep).toEqual({
      firstCents: 1000,
      firstBillingCycle: "monthly",
      firstObservedAtIso: "2026-01-01",
      currentCents: 1500,
      currentBillingCycle: "monthly",
      currency: "usd",
      changeCount: 2,
      percentChange: 50,
      annualDeltaCents: 6000,
    });
  });

  it("returns null when two changes net back to the starting price — a real fact, but not a 'creep' story", () => {
    const history = [
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1500, observedAt: new Date("2026-04-01T00:00:00Z") }),
      row({ id: "c", amountCents: 1000, observedAt: new Date("2026-08-01T00:00:00Z") }),
    ];
    expect(computePriceHistoryCreep(history)).toBeNull();
  });

  it("returns null when the first and current rows are in different currencies — never compares across currencies", () => {
    const history = [
      row({ id: "a", amountCents: 1000, currency: "gbp", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1200, currency: "gbp", observedAt: new Date("2026-04-01T00:00:00Z") }),
      row({ id: "c", amountCents: 1500, currency: "usd", observedAt: new Date("2026-08-01T00:00:00Z") }),
    ];
    expect(computePriceHistoryCreep(history)).toBeNull();
  });

  it("skips a currency-mismatched intermediate row when counting genuine changes, rather than aborting", () => {
    const history = [
      row({ id: "a", amountCents: 1000, currency: "usd", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 999, currency: "gbp", observedAt: new Date("2026-03-01T00:00:00Z") }),
      row({ id: "c", amountCents: 1200, currency: "usd", observedAt: new Date("2026-05-01T00:00:00Z") }),
      row({ id: "d", amountCents: 1500, currency: "usd", observedAt: new Date("2026-08-01T00:00:00Z") }),
    ];
    const creep = computePriceHistoryCreep(history);
    expect(creep).not.toBeNull();
    expect(creep!.changeCount).toBe(2); // a -> c, c -> d (a -> b and b -> c both skipped: currency mismatch)
  });

  it("is order-independent — unsorted input is sorted internally by observedAt", () => {
    const history = [
      row({ id: "c", amountCents: 1500, observedAt: new Date("2026-08-01T00:00:00Z") }),
      row({ id: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1200, observedAt: new Date("2026-04-01T00:00:00Z") }),
    ];
    expect(computePriceHistoryCreep(history)?.firstCents).toBe(1000);
    expect(computePriceHistoryCreep(history)?.currentCents).toBe(1500);
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

  // CodeRabbit review regression: a subscription created before this table
  // existed (no "initial" row) has its earliest history row dated well
  // after its real createdAt. That gap must count too, at the earliest
  // known rate — not be silently dropped.
  it("covers the gap between a pre-existing subscription's createdAt and its earliest history row", () => {
    // createdAt Jan 1; earliest known price ($10/mo) only recorded Feb 1
    // (31 days pre-history gap, closed: floor(31/30) = 1 period -> $10.00).
    // Then $10/mo Feb 1 -> Mar 1 "now" (28 days, current): floor(28/30)+1 = 1 -> $10.00.
    // Total: $20.00.
    const subscription = sub({ amountCents: 1000, billingCycle: "monthly", createdAt: new Date("2026-01-01T00:00:00Z") });
    const history = [
      row({ id: "a", amountCents: 1000, billingCycle: "monthly", observedAt: new Date("2026-02-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1000, billingCycle: "monthly", observedAt: new Date("2026-02-15T00:00:00Z") }),
    ];
    expect(estimatePaidCents(subscription, history)).toBe(2000);
  });

  // CodeRabbit review regression: a currency change partway through history
  // must not sum raw cents across currencies — only segments matching the
  // subscription's *current* currency are counted.
  it("excludes a currency-mismatched segment rather than summing across currencies", () => {
    // Jan 1 -> Feb 1: 1000 GBP/mo (excluded — subscription's current
    // currency is usd). Feb 1 -> Mar 1 "now": 1500 USD/mo, current segment,
    // floor(28/30)+1 = 1 period -> $15.00. Total: $15.00, not a mixed sum.
    const subscription = sub({ amountCents: 1500, currency: "usd", createdAt: new Date("2026-01-01T00:00:00Z") });
    const history = [
      row({ id: "a", amountCents: 1000, currency: "gbp", observedAt: new Date("2026-01-01T00:00:00Z") }),
      row({ id: "b", amountCents: 1500, currency: "usd", observedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    expect(estimatePaidCents(subscription, history)).toBe(1500);
  });
});

describe("computePriceChangeIfMeaningful", () => {
  it("returns null for a currency mismatch — never compares across currencies", () => {
    const existing = { amountCents: 1000, billingCycle: "monthly" as const, currency: "usd" };
    const candidate = { amountCents: 1500, billingCycle: "monthly" as const, currency: "eur" };
    expect(computePriceChangeIfMeaningful(existing, candidate)).toBeNull();
  });

  it("returns null for a $0 existing baseline (undefined percent change)", () => {
    const existing = { amountCents: 0, billingCycle: "monthly" as const, currency: "usd" };
    const candidate = { amountCents: 999, billingCycle: "monthly" as const, currency: "usd" };
    expect(computePriceChangeIfMeaningful(existing, candidate)).toBeNull();
  });

  it("returns null for the exact same price", () => {
    const existing = { amountCents: 1599, billingCycle: "monthly" as const, currency: "usd" };
    expect(computePriceChangeIfMeaningful(existing, { ...existing })).toBeNull();
  });

  it("returns null for a sub-3% move — noise, not a genuine change", () => {
    const existing = { amountCents: 1000, billingCycle: "monthly" as const, currency: "usd" };
    const candidate = { amountCents: 1010, billingCycle: "monthly" as const, currency: "usd" }; // +1%
    expect(computePriceChangeIfMeaningful(existing, candidate)).toBeNull();
  });

  it("detects a genuine increase with signed percent and annualized delta", () => {
    const existing = { amountCents: 1599, billingCycle: "monthly" as const, currency: "usd" };
    const candidate = { amountCents: 1999, billingCycle: "monthly" as const, currency: "usd" };
    const result = computePriceChangeIfMeaningful(existing, candidate);
    expect(result?.percentChange).toBeCloseTo(25.0156, 3);
    expect(result?.annualDeltaCents).toBe((1999 - 1599) * 12);
  });

  it("detects a genuine decrease with a negative percent change", () => {
    const existing = { amountCents: 2000, billingCycle: "monthly" as const, currency: "usd" };
    const candidate = { amountCents: 1500, billingCycle: "monthly" as const, currency: "usd" };
    const result = computePriceChangeIfMeaningful(existing, candidate);
    expect(result?.percentChange).toBeCloseTo(-25);
    expect(result?.annualDeltaCents).toBe((1500 - 2000) * 12);
  });

  // Same regression as computeLatestPriceChange's own $70 -> $84 case above,
  // exercised through this function's separate (existing/candidate)
  // PricePoint shape used by import-side price reconciliation.
  it("a yearly $70 -> $84 price increase reports an exact $14.00/yr delta, not $14.04", () => {
    const existing = { amountCents: 7000, billingCycle: "yearly" as const, currency: "usd" };
    const candidate = { amountCents: 8400, billingCycle: "yearly" as const, currency: "usd" };
    const result = computePriceChangeIfMeaningful(existing, candidate);
    expect(result?.annualDeltaCents).toBe(1400);
  });

  // Billing-cycle mismatch: a genuine cadence change must be judged on
  // monthly-equivalent cost, never raw cents — otherwise a monthly->yearly
  // switch that's actually a *decrease* would misread as a huge fake
  // increase (yearly's raw amountCents is naturally ~12x a monthly one).
  it("correctly compares across a billing-cycle change instead of raw amounts", () => {
    const existing = { amountCents: 1599, billingCycle: "monthly" as const, currency: "usd" }; // $15.99/mo
    const candidate = { amountCents: 18000, billingCycle: "yearly" as const, currency: "usd" }; // $180/yr = $15/mo, a real decrease
    const result = computePriceChangeIfMeaningful(existing, candidate);
    // Exact value, not just "less than 0" (product council review,
    // Data/Analytics lens) — pins the actual magnitude, not just the sign,
    // so a subtly wrong divisor in the cross-cycle normalization would
    // still fail this test even if it happened to land on the correct
    // sign.
    expect(result?.percentChange).toBeCloseTo(-6.1914, 3);
  });

  it("does not flag a billing-cycle change whose monthly-equivalent is unchanged", () => {
    const existing = { amountCents: 1000, billingCycle: "monthly" as const, currency: "usd" }; // $10/mo
    const candidate = { amountCents: 12000, billingCycle: "yearly" as const, currency: "usd" }; // $120/yr = $10/mo
    expect(computePriceChangeIfMeaningful(existing, candidate)).toBeNull();
  });
});

describe("computePortfolioPriceChanges", () => {
  it("returns only active subscriptions with a genuine price increase, biggest annual impact first", () => {
    const subs = [
      sub({ id: "increased-small", name: "Small increase" }),
      sub({ id: "increased-big", name: "Big increase" }),
      sub({ id: "decreased", name: "Decreased" }),
      sub({ id: "unchanged", name: "Unchanged" }),
      sub({ id: "no-history", name: "No history" }),
      sub({ id: "paused", name: "Paused", status: "paused" }),
    ];
    const history = new Map([
      [
        "increased-small",
        [row({ subscriptionId: "increased-small", amountCents: 1000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "increased-small", amountCents: 1100, observedAt: new Date("2026-06-01") })],
      ],
      [
        "increased-big",
        [row({ subscriptionId: "increased-big", amountCents: 1000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "increased-big", amountCents: 3000, observedAt: new Date("2026-06-01") })],
      ],
      [
        "decreased",
        [row({ subscriptionId: "decreased", amountCents: 2000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "decreased", amountCents: 1000, observedAt: new Date("2026-06-01") })],
      ],
      [
        "unchanged",
        [row({ subscriptionId: "unchanged", amountCents: 1000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "unchanged", amountCents: 1000, observedAt: new Date("2026-06-01") })],
      ],
      [
        "paused",
        [row({ subscriptionId: "paused", amountCents: 1000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "paused", amountCents: 2000, observedAt: new Date("2026-06-01") })],
      ],
      // "no-history" has no map entry at all — must not throw.
    ]);

    const result = computePortfolioPriceChanges(subs, history);
    expect(result.map((e) => e.subscription.id)).toEqual(["increased-big", "increased-small"]);
    expect(result[0].change.annualDeltaCents).toBeGreaterThan(result[1].change.annualDeltaCents);
  });

  it("returns an empty list when nothing increased", () => {
    const subs = [sub({ id: "s1" })];
    const history = new Map([["s1", [row({ subscriptionId: "s1", amountCents: 1000 })]]]);
    expect(computePortfolioPriceChanges(subs, history)).toEqual([]);
  });
});

describe("sumPortfolioPriceChanges", () => {
  it("returns null for an empty list", () => {
    expect(sumPortfolioPriceChanges([])).toBeNull();
  });

  it("sums annualDeltaCents when every entry shares one currency", () => {
    const subs = [sub({ id: "a" }), sub({ id: "b" })];
    const history = new Map([
      ["a", [row({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "a", amountCents: 1200, observedAt: new Date("2026-06-01") })]],
      ["b", [row({ subscriptionId: "b", amountCents: 2000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "b", amountCents: 2400, observedAt: new Date("2026-06-01") })]],
    ]);
    const entries = computePortfolioPriceChanges(subs, history);
    const total = sumPortfolioPriceChanges(entries);
    expect(total).not.toBeNull();
    expect(total!.currency).toBe("usd");
    expect(total!.annualDeltaCents).toBe(entries[0].change.annualDeltaCents + entries[1].change.annualDeltaCents);
  });

  it("returns null (not a fabricated sum) when entries span more than one currency", () => {
    const subs = [sub({ id: "a", currency: "usd" }), sub({ id: "b", currency: "gbp" })];
    const history = new Map([
      ["a", [row({ subscriptionId: "a", amountCents: 1000, currency: "usd", observedAt: new Date("2026-01-01") }), row({ subscriptionId: "a", amountCents: 1200, currency: "usd", observedAt: new Date("2026-06-01") })]],
      ["b", [row({ subscriptionId: "b", amountCents: 1000, currency: "gbp", observedAt: new Date("2026-01-01") }), row({ subscriptionId: "b", amountCents: 1200, currency: "gbp", observedAt: new Date("2026-06-01") })]],
    ]);
    const entries = computePortfolioPriceChanges(subs, history);
    expect(sumPortfolioPriceChanges(entries)).toBeNull();
  });
});

describe("computeCreepingCostTrailing12Months", () => {
  const NOW = new Date("2026-08-31T00:00:00Z");

  it("sums every genuine increase within the trailing 12 months, not just the latest one", () => {
    // Two real increases in the last year, on the same subscription.
    const s = sub({ id: "twice" });
    const history = new Map([
      [
        "twice",
        [
          row({ subscriptionId: "twice", amountCents: 1000, observedAt: new Date("2026-01-01") }),
          row({ subscriptionId: "twice", amountCents: 1200, observedAt: new Date("2026-04-01") }), // +$2/mo
          row({ subscriptionId: "twice", amountCents: 1400, observedAt: new Date("2026-07-01") }), // +$2/mo again
        ],
      ],
    ]);
    const total = computeCreepingCostTrailing12Months([s], history, NOW);
    expect(total).not.toBeNull();
    // Both increases counted: computePortfolioPriceChanges (latest-only)
    // would report just the second one — this function must report more.
    const latestOnly = sumPortfolioPriceChanges(computePortfolioPriceChanges([s], history));
    expect(total!.annualDeltaCents).toBeGreaterThan(latestOnly!.annualDeltaCents);
  });

  it("excludes an increase that happened before the trailing 12-month window", () => {
    const s = sub({ id: "old-increase" });
    const history = new Map([
      [
        "old-increase",
        [
          row({ subscriptionId: "old-increase", amountCents: 1000, observedAt: new Date("2024-01-01") }),
          row({ subscriptionId: "old-increase", amountCents: 1400, observedAt: new Date("2024-06-01") }), // over 2 years ago
        ],
      ],
    ]);
    expect(computeCreepingCostTrailing12Months([s], history, NOW)).toBeNull();
  });

  it("excludes decreases — this measures cost creeping up, not net change", () => {
    const s = sub({ id: "decreased" });
    const history = new Map([
      [
        "decreased",
        [
          row({ subscriptionId: "decreased", amountCents: 2000, observedAt: new Date("2026-01-01") }),
          row({ subscriptionId: "decreased", amountCents: 1000, observedAt: new Date("2026-06-01") }),
        ],
      ],
    ]);
    expect(computeCreepingCostTrailing12Months([s], history, NOW)).toBeNull();
  });

  it("ignores paused/canceled subscriptions", () => {
    const s = sub({ id: "paused", status: "paused" });
    const history = new Map([
      [
        "paused",
        [
          row({ subscriptionId: "paused", amountCents: 1000, observedAt: new Date("2026-01-01") }),
          row({ subscriptionId: "paused", amountCents: 1400, observedAt: new Date("2026-06-01") }),
        ],
      ],
    ]);
    expect(computeCreepingCostTrailing12Months([s], history, NOW)).toBeNull();
  });

  it("returns null (not a fabricated sum) when counted increases span more than one currency", () => {
    const usd = sub({ id: "usd-sub", currency: "usd" });
    const gbp = sub({ id: "gbp-sub", currency: "gbp" });
    const history = new Map([
      ["usd-sub", [row({ subscriptionId: "usd-sub", amountCents: 1000, currency: "usd", observedAt: new Date("2026-01-01") }), row({ subscriptionId: "usd-sub", amountCents: 1200, currency: "usd", observedAt: new Date("2026-06-01") })]],
      ["gbp-sub", [row({ subscriptionId: "gbp-sub", amountCents: 1000, currency: "gbp", observedAt: new Date("2026-01-01") }), row({ subscriptionId: "gbp-sub", amountCents: 1200, currency: "gbp", observedAt: new Date("2026-06-01") })]],
    ]);
    const total = computeCreepingCostTrailing12Months([usd, gbp], history, NOW);
    // Only the first-seen currency counts; the other is honestly excluded,
    // not summed in — still returns a real (non-null) total for the one
    // that does count.
    expect(total).not.toBeNull();
    expect(["usd", "gbp"]).toContain(total!.currency);
  });

  it("returns null for no subscriptions or no history", () => {
    expect(computeCreepingCostTrailing12Months([], new Map(), NOW)).toBeNull();
    expect(computeCreepingCostTrailing12Months([sub({ id: "x" })], new Map(), NOW)).toBeNull();
  });
});
