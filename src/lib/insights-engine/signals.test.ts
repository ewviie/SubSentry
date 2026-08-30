import { describe, it, expect } from "vitest";
import {
  monthlyTotalCents,
  annualTotalCents,
  findDuplicates,
  categoryConcentration,
  findRenewalCluster,
  findExpensiveOutliers,
  longRunningSubscriptions,
  billingCycleCounts,
  recentGrowthCount,
  upcomingRenewalTotalCents,
  canceledCount,
  findPriceIncreases,
  hasEnoughPriceHistoryToEvaluate,
  confirmedDuplicateSeverity,
  portfolioConcentration,
  portfolioConcentrationPenalty,
  renewalExposurePenalty,
  reactivationCandidates,
  hasRepeatedPriceChanges,
  expensiveOutlierMagnitudeFactor,
  nonReactivatedCanceledCount,
  priceIncreaseSeverity,
} from "./signals";
import { sub } from "./test-fixtures";
import type { SubscriptionPriceHistory } from "@/lib/db/schema";

function historyRow(overrides: Partial<SubscriptionPriceHistory>): SubscriptionPriceHistory {
  return {
    id: overrides.id ?? "row-id",
    subscriptionId: "sub-id",
    userId: "user-1",
    amountCents: 1000,
    billingCycle: "monthly",
    currency: "usd",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    source: "initial",
    ...overrides,
  };
}

describe("monthlyTotalCents", () => {
  it("sums monthly-equivalent cost across active subs", () => {
    expect(monthlyTotalCents([sub({ amountCents: 1000 }), sub({ billingCycle: "yearly", amountCents: 1200 })])).toBe(1100);
  });
});

describe("annualTotalCents", () => {
  it("sums each subscription's own exact annual figure, not monthlyTotalCents * 12", () => {
    // Two yearly subs at $99.99 each: exact annual total is $199.98
    // (19998 cents). monthlyTotalCents*12 would give 833*2=1666, *12=19992
    // (a wrong $199.92) — this must not be that.
    const total = annualTotalCents([
      sub({ billingCycle: "yearly", amountCents: 9999 }),
      sub({ billingCycle: "yearly", amountCents: 9999 }),
    ]);
    expect(total).toBe(19998);
  });

  it("matches monthlyTotalCents * 12 exactly when every subscription is monthly (no rounding involved either way)", () => {
    const subs = [sub({ amountCents: 1549 }), sub({ amountCents: 999 })];
    expect(annualTotalCents(subs)).toBe(monthlyTotalCents(subs) * 12);
  });
});

describe("findDuplicates", () => {
  it("returns nothing for distinct names", () => {
    expect(findDuplicates([sub({ name: "Netflix" }), sub({ name: "Spotify" })])).toEqual([]);
  });
  it("flags a near-identical pair, redundant = later index", () => {
    const a = sub({ name: "Netflix" });
    const b = sub({ name: "Netflix Premium", amountCents: 1500 });
    const pairs = findDuplicates([a, b]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].redundant.id).toBe(b.id);
    expect(pairs[0].monthlySavingsCents).toBe(1500);
  });
});

describe("categoryConcentration", () => {
  it("returns null when spend is zero or a single category", () => {
    expect(categoryConcentration([])).toBeNull();
    expect(categoryConcentration([sub({ category: "fitness" }), sub({ category: "fitness" })])).toBeNull();
  });
  it("returns the dominant category's share", () => {
    const result = categoryConcentration([
      sub({ category: "streaming", amountCents: 8000 }),
      sub({ category: "fitness", amountCents: 2000 }),
    ]);
    expect(result?.category).toBe("streaming");
    expect(result?.share).toBeCloseTo(0.8);
  });

  // Regression: this used to sum monthlyCents across ALL active
  // subscriptions regardless of currency, so a single GBP subscription's
  // raw cents got added straight into a "% of monthly spend" figure
  // presented as USD. Reproduces the exact numbers from a real dashboard
  // account (2 USD, 1 GBP): before this fix, "fitness" (GBP 2500) read as
  // 44% of a mixed 5682-cent total — a category that isn't even in the
  // USD-only comparison winning it, labeled with a $ sign. The correct,
  // currency-safe answer restricts both the category totals and the
  // denominator to the 2 USD subscriptions: streaming (Netflix, 1549)
  // over the 2349-cent USD-only total.
  it("excludes a non-primary-currency subscription instead of mixing it into the total", () => {
    const result = categoryConcentration([
      sub({ category: "streaming", amountCents: 1549, currency: "usd" }), // Netflix
      sub({ category: "software", amountCents: 800, currency: "usd" }), // Notion
      sub({ category: "fitness", amountCents: 2500, currency: "gbp" }), // UK Gym
    ]);
    // The GBP fitness subscription is the single biggest line item by raw
    // cents, but never participates in the USD total — it must not surface
    // as "the" concentrated category, and the denominator must exclude it.
    expect(result?.category).toBe("streaming");
    expect(result?.cents).toBe(1549);
    expect(result?.share).toBeCloseTo(1549 / 2349, 5); // not 1549/5682 or 2500/5682
    expect(result?.currency).toBe("usd");
  });

  it("still reports concentration correctly when the majority-currency subset alone clears the bar", () => {
    const result = categoryConcentration([
      sub({ category: "streaming", amountCents: 8000, currency: "usd" }),
      sub({ category: "fitness", amountCents: 2000, currency: "usd" }),
      sub({ category: "fitness", amountCents: 999999, currency: "gbp" }), // must not distort the USD share
    ]);
    expect(result?.category).toBe("streaming");
    expect(result?.share).toBeCloseTo(0.8);
    expect(result?.currency).toBe("usd");
  });
});

describe("findRenewalCluster", () => {
  const today = "2026-01-01";
  it("returns null with fewer than 3 upcoming renewals", () => {
    expect(findRenewalCluster([sub({ nextRenewalDate: "2026-01-05" })], today)).toBeNull();
  });
  it("finds a 7-day cluster of 3+ renewals", () => {
    const cluster = findRenewalCluster(
      [
        sub({ nextRenewalDate: "2026-01-05" }),
        sub({ nextRenewalDate: "2026-01-06" }),
        sub({ nextRenewalDate: "2026-01-08" }),
        sub({ nextRenewalDate: "2026-03-01" }),
      ],
      today,
    );
    expect(cluster?.subscriptionIds).toHaveLength(3);
  });

  // Regression: totalCents used to sum every clustered subscription's raw
  // amountCents regardless of currency. subscriptionIds (the "N renewals
  // land the same week" count) stays full — timing doesn't depend on
  // currency — but totalCents must only include the primary-currency
  // members, and say which currency that is.
  it("excludes a non-primary-currency member from totalCents but keeps it in the cluster count", () => {
    const cluster = findRenewalCluster(
      [
        sub({ nextRenewalDate: "2026-01-05", amountCents: 1000, currency: "usd" }),
        sub({ nextRenewalDate: "2026-01-06", amountCents: 2000, currency: "usd" }),
        sub({ nextRenewalDate: "2026-01-08", amountCents: 500000, currency: "gbp" }),
      ],
      today,
    );
    expect(cluster?.subscriptionIds).toHaveLength(3); // still counts all 3 for timing
    expect(cluster?.currency).toBe("usd");
    expect(cluster?.totalCents).toBe(3000); // the GBP 500000 never enters this sum
  });

  // Regression (release-review finding #7): the window's upper bound used
  // to be inclusive (`d <= windowEnd` where windowEnd = anchor + 7 days),
  // spanning 8 calendar days (anchor+0 through anchor+7) for the default
  // windowDays=7 — while every caller's own copy says "the same week"/
  // "within 7 days". A renewal exactly 7 days after the anchor must now
  // fall OUTSIDE the cluster; one 6 days after must still fall inside.
  it("treats the window as exactly 7 days (anchor+6 inside, anchor+7 outside)", () => {
    const insideCluster = findRenewalCluster(
      [
        sub({ nextRenewalDate: "2026-01-05" }),
        sub({ nextRenewalDate: "2026-01-06" }),
        sub({ nextRenewalDate: "2026-01-11" }), // anchor (Jan 5) + 6 days
      ],
      today,
    );
    expect(insideCluster?.subscriptionIds).toHaveLength(3);

    const outsideCluster = findRenewalCluster(
      [
        sub({ nextRenewalDate: "2026-01-05" }),
        sub({ nextRenewalDate: "2026-01-06" }),
        sub({ nextRenewalDate: "2026-01-12" }), // anchor (Jan 5) + 7 days
      ],
      today,
    );
    expect(outsideCluster).toBeNull();
  });
});

describe("findExpensiveOutliers", () => {
  it("flags a subscription at least 2x the mean annual cost", () => {
    const outliers = findExpensiveOutliers([
      sub({ amountCents: 500 }),
      sub({ amountCents: 500 }),
      sub({ amountCents: 5000 }),
    ]);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].annualCents).toBe(60000);
  });
  it("returns nothing for under 2 subscriptions", () => {
    expect(findExpensiveOutliers([sub({})])).toEqual([]);
  });

  // Regression: the mean used to be computed across ALL active
  // subscriptions regardless of currency, so a single expensive
  // non-primary-currency subscription could distort (or itself be wrongly
  // flagged/unflagged against) a mean blended from a different currency.
  it("computes the mean, and flags outliers, only within the primary currency", () => {
    const outliers = findExpensiveOutliers([
      sub({ amountCents: 500, currency: "usd" }),
      sub({ amountCents: 500, currency: "usd" }),
      sub({ amountCents: 5000, currency: "usd" }), // 2x the 2-item USD mean -> real outlier
      sub({ amountCents: 1, currency: "gbp" }), // would drag the mean down if it counted
    ]);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].subscription.currency).toBe("usd");
    expect(outliers[0].annualCents).toBe(60000);
  });

  // Regression: a yearly subscription's annualCents used to be computed as
  // monthlyCents(...) * 12, double-rounding it away from the subscription's
  // own stored price. $99.99/yr must report exactly 9999, not 9996.
  it("reports a yearly subscription's exact annual figure, not a double-rounded one", () => {
    const outliers = findExpensiveOutliers([
      sub({ amountCents: 100 }),
      sub({ amountCents: 100 }),
      sub({ billingCycle: "yearly", amountCents: 9999 }),
    ]);
    expect(outliers).toHaveLength(1);
    expect(outliers[0].annualCents).toBe(9999);
  });
});

describe("longRunningSubscriptions", () => {
  it("flags subscriptions active 365+ days", () => {
    const old = sub({ createdAt: new Date("2024-01-01T00:00:00Z") });
    const recent = sub({ createdAt: new Date("2025-12-01T00:00:00Z") });
    const result = longRunningSubscriptions([old, recent], "2026-01-01");
    expect(result.map((s) => s.id)).toEqual([old.id]);
  });
});

describe("billingCycleCounts", () => {
  it("counts each cycle", () => {
    const counts = billingCycleCounts([sub({ billingCycle: "monthly" }), sub({ billingCycle: "yearly" })]);
    expect(counts).toEqual({ monthly: 1, yearly: 1, quarterly: 0, weekly: 0 });
  });
});

describe("recentGrowthCount", () => {
  it("counts subscriptions created within the window", () => {
    const recent = sub({ createdAt: new Date("2026-01-05T00:00:00Z") });
    const old = sub({ createdAt: new Date("2025-01-01T00:00:00Z") });
    expect(recentGrowthCount([recent, old], "2026-01-10", 30)).toBe(1);
  });
});

describe("upcomingRenewalTotalCents", () => {
  it("sums renewals due within the window", () => {
    const total = upcomingRenewalTotalCents(
      [sub({ nextRenewalDate: "2026-01-15", amountCents: 1000 }), sub({ nextRenewalDate: "2026-03-01", amountCents: 2000 })],
      "2026-01-01",
      30,
    );
    expect(total).toBe(1000);
  });

  // Regression: this used to sum amountCents across every currency in the
  // window. Reproduces the exact bug seen on a real dashboard: 3
  // subscriptions (2 USD, 1 GBP) all due within 30 days summed to $48.49 —
  // 1549 (Netflix) + 800 (Notion) + 2500 (UK Gym, actually GBP) — labeled
  // with a dollar sign. The correct total excludes the GBP subscription.
  it("excludes a non-primary-currency subscription from the sum", () => {
    const total = upcomingRenewalTotalCents(
      [
        sub({ nextRenewalDate: "2026-01-12", amountCents: 1549, currency: "usd" }), // Netflix
        sub({ nextRenewalDate: "2026-01-18", amountCents: 800, currency: "usd" }), // Notion
        sub({ nextRenewalDate: "2026-01-09", amountCents: 2500, currency: "gbp" }), // UK Gym
      ],
      "2026-01-01",
      30,
    );
    expect(total).toBe(2349); // 1549 + 800, not 4849
  });
});

describe("canceledCount", () => {
  it("counts canceled subscriptions across all statuses", () => {
    expect(canceledCount([sub({ status: "canceled" }), sub({ status: "active" }), sub({ status: "canceled" })])).toBe(2);
  });
});

describe("findPriceIncreases", () => {
  it("returns nothing for a subscription with no recorded history", () => {
    expect(findPriceIncreases([sub({ id: "a" })], new Map())).toEqual([]);
  });

  it("returns nothing when the price never changed", () => {
    const s = sub({ id: "a", amountCents: 1000 });
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    expect(findPriceIncreases([s], history)).toEqual([]);
  });

  it("ignores a below-threshold (<3%) move — rounding noise, not a real increase", () => {
    const s = sub({ id: "a", amountCents: 1000 });
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1010, observedAt: new Date("2026-02-01T00:00:00Z") }), // +1%
        ],
      ],
    ]);
    expect(findPriceIncreases([s], history)).toEqual([]);
  });

  it("ignores a price decrease", () => {
    const s = sub({ id: "a", amountCents: 800 });
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 800, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    expect(findPriceIncreases([s], history)).toEqual([]);
  });

  it("flags a genuine, meaningful increase and reports its dollar/percent impact", () => {
    const s = sub({ id: "a", amountCents: 1800, billingCycle: "monthly" });
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1500, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1800, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const found = findPriceIncreases([s], history);
    expect(found).toHaveLength(1);
    expect(found[0].subscription.id).toBe("a");
    expect(found[0].change.percentChange).toBeCloseTo(20);
    expect(found[0].change.annualDeltaCents).toBe(3600); // (1800-1500)*12
  });

  // Regression (product council review, Product Manager lens): a relative-
  // only bar let a trivially cheap subscription's price double (+100%, but
  // a negligible real dollar amount) read as identically "meaningful" as a
  // real Netflix-sized hike. Mirrors findExpensiveOutliers' own
  // relative-AND-absolute pairing.
  it("ignores a large percentage move that's still below the $30/yr dollar floor", () => {
    const s = sub({ id: "a", amountCents: 100 });
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 50, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 100, observedAt: new Date("2026-02-01T00:00:00Z") }), // +100%, but only +$6.00/yr
        ],
      ],
    ]);
    expect(findPriceIncreases([s], history)).toEqual([]);
  });

  it("includes an exact 3.0% increase and excludes a 2.99% increase, at a dollar amount well above the floor either way", () => {
    const included = sub({ id: "included", amountCents: 103000 });
    const excluded = sub({ id: "excluded", amountCents: 102990 });
    const history = new Map([
      [
        "included",
        [
          historyRow({ subscriptionId: "included", amountCents: 100000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "included", amountCents: 103000, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
      [
        "excluded",
        [
          historyRow({ subscriptionId: "excluded", amountCents: 100000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "excluded", amountCents: 102990, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const found = findPriceIncreases([included, excluded], history);
    expect(found.map((f) => f.subscription.id)).toEqual(["included"]);
  });

  it("sorts multiple increases by dollar impact, largest first", () => {
    const small = sub({ id: "small", amountCents: 1300 });
    const big = sub({ id: "big", amountCents: 2000 });
    const history = new Map([
      [
        "small",
        [
          historyRow({ subscriptionId: "small", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "small", amountCents: 1300, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
      [
        "big",
        [
          historyRow({ subscriptionId: "big", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "big", amountCents: 2000, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const found = findPriceIncreases([small, big], history);
    expect(found.map((f) => f.subscription.id)).toEqual(["big", "small"]);
  });
});

describe("hasEnoughPriceHistoryToEvaluate", () => {
  it("is false with no history at all", () => {
    expect(hasEnoughPriceHistoryToEvaluate([sub({ id: "a" })], new Map())).toBe(false);
  });

  it("is false with only a single (initial) row — nothing to compare against yet", () => {
    const history = new Map([["a", [historyRow({ subscriptionId: "a" })]]]);
    expect(hasEnoughPriceHistoryToEvaluate([sub({ id: "a" })], history)).toBe(false);
  });

  it("is true once at least one active subscription has 2+ recorded rows", () => {
    const history = new Map([
      ["a", [historyRow({ subscriptionId: "a" }), historyRow({ subscriptionId: "a", amountCents: 1100 })]],
    ]);
    expect(hasEnoughPriceHistoryToEvaluate([sub({ id: "a" })], history)).toBe(true);
  });
});

describe("confirmedDuplicateSeverity", () => {
  it("is 0 with no pairs", () => {
    expect(confirmedDuplicateSeverity(0, 0, 1000, false)).toBe(0);
  });

  it("scales with dollar share, not just count — a trivial-dollar duplicate costs less than a portfolio-dominating one", () => {
    const trivial = confirmedDuplicateSeverity(1, 100, 10_000, false); // 1% of spend
    const dominant = confirmedDuplicateSeverity(1, 5_000, 10_000, false); // 50% of spend
    expect(trivial).toBeLessThan(0);
    expect(dominant).toBeLessThan(trivial);
  });

  it("applies diminishing returns per additional pair, not linear scaling", () => {
    const one = confirmedDuplicateSeverity(1, 1000, 10_000, false);
    const two = confirmedDuplicateSeverity(2, 2000, 10_000, false);
    // Same per-pair share (10%), double the pairs — a linear model would
    // exactly double the penalty; sqrt-based diminishing returns must not.
    expect(Math.abs(two)).toBeLessThan(Math.abs(one) * 2);
    expect(Math.abs(two)).toBeGreaterThan(Math.abs(one));
  });

  // Final-calibration-review fix: ceiling raised 60->100 — 100 is the
  // natural bound past which raising it further can't matter, since
  // computeHealthScore clamps every dimension to [0, 100] regardless.
  it("never exceeds the -100 ceiling regardless of magnitude", () => {
    expect(confirmedDuplicateSeverity(10, 1_000_000, 1_000_000, true)).toBe(-100);
  });

  it("applies a stale-dismissal multiplier, still capped at -100", () => {
    const fresh = confirmedDuplicateSeverity(1, 1000, 10_000, false);
    const stale = confirmedDuplicateSeverity(1, 1000, 10_000, true);
    expect(stale).toBeLessThan(fresh);
  });

  // Final-calibration-review fix: the whole reason the ceiling moved — 2
  // pairs and 6 duplicate pairs at a comparable per-pair share must no
  // longer collapse to the same capped value the way they did under the
  // old -60 ceiling.
  it("scores a heavily duplicate-saturated portfolio materially worse than a lightly duplicated one", () => {
    const light = confirmedDuplicateSeverity(2, 7000, 10_000, false); // 2 pairs, 70% share
    const heavy = confirmedDuplicateSeverity(6, 7000, 10_000, false); // 6 pairs, same share
    expect(heavy).toBeLessThan(light);
    // Neither is silently flattened to the same old ceiling.
    expect(light).not.toBe(-60);
    expect(heavy).not.toBe(-60);
  });

  it("treats zero total spend as zero share rather than dividing by zero", () => {
    expect(Number.isFinite(confirmedDuplicateSeverity(1, 0, 0, false))).toBe(true);
  });
});

describe("portfolioConcentration", () => {
  it("is null with fewer than 3 primary-currency subscriptions", () => {
    expect(portfolioConcentration([sub({ amountCents: 1000 }), sub({ amountCents: 1000 })])).toBeNull();
  });

  it("normalizes to 0 for a perfectly even split, regardless of subscription count", () => {
    const even3 = portfolioConcentration([sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 1000 })]);
    const even5 = portfolioConcentration(Array.from({ length: 5 }, () => sub({ amountCents: 1000 })));
    expect(even3?.normalizedHHI).toBeCloseTo(0, 5);
    expect(even5?.normalizedHHI).toBeCloseTo(0, 5);
  });

  it("approaches 1 as one subscription dominates the rest", () => {
    const result = portfolioConcentration([sub({ amountCents: 100 }), sub({ amountCents: 100 }), sub({ amountCents: 10_000 })]);
    expect(result?.normalizedHHI).toBeGreaterThan(0.8);
    expect(result?.topShare).toBeGreaterThan(0.9);
  });

  it("restricts to the primary currency", () => {
    const result = portfolioConcentration([
      sub({ amountCents: 1000, currency: "usd" }),
      sub({ amountCents: 1000, currency: "usd" }),
      sub({ amountCents: 1000, currency: "usd" }),
      sub({ amountCents: 999_999, currency: "gbp" }),
    ]);
    // The GBP outlier is excluded entirely — 3 even USD subscriptions left.
    expect(result?.normalizedHHI).toBeCloseTo(0, 5);
  });
});

describe("portfolioConcentrationPenalty", () => {
  it("is 0 below the concern threshold", () => {
    expect(portfolioConcentrationPenalty(0.1)).toBe(0);
  });

  it("is negative and capped at -20 for severe concentration", () => {
    expect(portfolioConcentrationPenalty(0.95)).toBe(-20);
  });

  it("increases in magnitude as concentration increases", () => {
    expect(Math.abs(portfolioConcentrationPenalty(0.7))).toBeGreaterThan(Math.abs(portfolioConcentrationPenalty(0.3)));
  });
});

describe("renewalExposurePenalty", () => {
  it("is 0 at or below the 1.3x baseline", () => {
    expect(renewalExposurePenalty(1.0)).toBe(0);
    expect(renewalExposurePenalty(1.3)).toBe(0);
  });

  it("is harsher at a genuine severe spike than the old flat -16 ceiling", () => {
    expect(renewalExposurePenalty(3.5)).toBeLessThan(-16);
  });

  // Final-calibration-review fix: ceiling extended 32->48, reached further
  // out (ratio>=15 instead of >=3.5) — see this function's own comment for
  // why a 9x and a 20x spike used to be indistinguishable.
  it("is capped at -48", () => {
    expect(renewalExposurePenalty(100)).toBe(-48);
  });

  it("increases in magnitude with the ratio", () => {
    expect(Math.abs(renewalExposurePenalty(1.8))).toBeLessThan(Math.abs(renewalExposurePenalty(2.5)));
  });

  // Final-calibration-review fix: the whole reason the curve was extended —
  // a 9x and a 20x spike must no longer collapse to the same capped value.
  it("distinguishes a 9x spike from a 20x spike, both worse than the old -32 ceiling", () => {
    const nineX = renewalExposurePenalty(9);
    const twentyX = renewalExposurePenalty(20);
    expect(twentyX).toBeLessThan(nineX);
    expect(nineX).toBeLessThan(-32);
    expect(twentyX).toBe(-48);
  });
});

describe("reactivationCandidates", () => {
  it("is empty with no canceled history", () => {
    expect(reactivationCandidates([sub({ name: "Netflix" })], [sub({ name: "Netflix" })])).toEqual([]);
  });

  it("flags an active subscription whose name matches a canceled one", () => {
    const canceled = sub({ name: "Netflix", status: "canceled" });
    const active = sub({ name: "Netflix" });
    const found = reactivationCandidates([canceled, active], [active]);
    expect(found.map((s) => s.id)).toEqual([active.id]);
  });

  it("does not flag an active subscription with no canceled counterpart", () => {
    const canceled = sub({ name: "Netflix", status: "canceled" });
    const active = sub({ name: "Spotify" });
    expect(reactivationCandidates([canceled, active], [active])).toEqual([]);
  });
});

describe("hasRepeatedPriceChanges", () => {
  it("is false with fewer than 3 recorded rows", () => {
    const history = new Map([["a", [historyRow({ subscriptionId: "a" }), historyRow({ subscriptionId: "a", amountCents: 1100 })]]]);
    expect(hasRepeatedPriceChanges([sub({ id: "a" })], history, "2026-01-01")).toBe(false);
  });

  it("is true with 3+ recorded rows within the trailing 12 months", () => {
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2025-06-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1100, observedAt: new Date("2025-09-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1200, observedAt: new Date("2025-12-01T00:00:00Z") }),
        ],
      ],
    ]);
    expect(hasRepeatedPriceChanges([sub({ id: "a" })], history, "2026-01-01")).toBe(true);
  });

  it("ignores rows older than 12 months", () => {
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2020-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1100, observedAt: new Date("2020-02-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1200, observedAt: new Date("2020-03-01T00:00:00Z") }),
        ],
      ],
    ]);
    expect(hasRepeatedPriceChanges([sub({ id: "a" })], history, "2026-01-01")).toBe(false);
  });
});

describe("expensiveOutlierMagnitudeFactor", () => {
  it("is 1x (no scaling) at or below 40% share", () => {
    expect(expensiveOutlierMagnitudeFactor(0)).toBe(1);
    expect(expensiveOutlierMagnitudeFactor(0.4)).toBe(1);
  });

  it("ramps smoothly between 40% and 90% share", () => {
    expect(expensiveOutlierMagnitudeFactor(0.65)).toBeCloseTo(1.5, 5);
  });

  it("caps at 2x by 90%+ share", () => {
    expect(expensiveOutlierMagnitudeFactor(0.9)).toBe(2);
    expect(expensiveOutlierMagnitudeFactor(1)).toBe(2);
  });
});

describe("nonReactivatedCanceledCount", () => {
  it("counts a genuinely resolved cancellation", () => {
    expect(nonReactivatedCanceledCount([sub({ name: "Netflix", status: "canceled" }), sub({ name: "Spotify", status: "active" })])).toBe(1);
  });

  it("excludes a canceled subscription whose name matches a currently-active one", () => {
    expect(nonReactivatedCanceledCount([sub({ name: "Netflix", status: "canceled" }), sub({ name: "Netflix", status: "active" })])).toBe(0);
  });

  it("counts genuinely resolved cancellations alongside an excluded reactivation", () => {
    const all = [
      sub({ name: "Netflix", status: "canceled" }),
      sub({ name: "Netflix", status: "active" }),
      sub({ name: "Hulu", status: "canceled" }),
      sub({ name: "Spotify", status: "active" }),
    ];
    expect(nonReactivatedCanceledCount(all)).toBe(1);
  });
});

describe("priceIncreaseSeverity", () => {
  it("is 0 with no increased subscriptions", () => {
    expect(priceIncreaseSeverity(0, 0, 10_000, false)).toBe(0);
  });

  // Final-calibration-review fix: the whole reason this function exists —
  // 100%, 75%, 50%, and 25% of a portfolio's subscriptions increasing must
  // no longer collapse to the same penalty once 2+ are involved, and
  // magnitude (dollar share of the increases) must matter, not just count.
  it("scores more increased subscriptions worse than fewer, at a comparable dollar share", () => {
    const one = priceIncreaseSeverity(1, 1000, 10_000, false);
    const two = priceIncreaseSeverity(2, 2000, 10_000, false);
    const four = priceIncreaseSeverity(4, 4000, 10_000, false);
    expect(two).toBeLessThan(one);
    expect(four).toBeLessThan(two);
  });

  it("applies diminishing returns per additional increased subscription, not linear scaling", () => {
    const one = priceIncreaseSeverity(1, 1000, 10_000, false);
    const two = priceIncreaseSeverity(2, 2000, 10_000, false);
    expect(Math.abs(two)).toBeLessThan(Math.abs(one) * 2);
  });

  it("scales with dollar share — a large combined increase costs more than a trivial one, same count", () => {
    const trivial = priceIncreaseSeverity(2, 100, 10_000, false); // 1% of spend
    const large = priceIncreaseSeverity(2, 5000, 10_000, false); // 50% of spend
    expect(large).toBeLessThan(trivial);
  });

  it("applies a small repeated-change multiplier", () => {
    const fresh = priceIncreaseSeverity(1, 1000, 10_000, false);
    const repeated = priceIncreaseSeverity(1, 1000, 10_000, true);
    expect(repeated).toBeLessThan(fresh);
  });

  it("never exceeds the -48 ceiling regardless of magnitude", () => {
    expect(priceIncreaseSeverity(20, 1_000_000, 1_000_000, true)).toBe(-48);
  });

  it("treats zero total annual spend as zero share rather than dividing by zero", () => {
    expect(Number.isFinite(priceIncreaseSeverity(1, 1000, 0, false))).toBe(true);
  });
});
