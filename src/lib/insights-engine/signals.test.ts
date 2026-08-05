import { describe, it, expect } from "vitest";
import {
  monthlyTotalCents,
  findDuplicates,
  categoryConcentration,
  findRenewalCluster,
  findExpensiveOutliers,
  longRunningSubscriptions,
  billingCycleCounts,
  recentGrowthCount,
  upcomingRenewalTotalCents,
  canceledCount,
} from "./signals";
import { sub } from "./test-fixtures";

describe("monthlyTotalCents", () => {
  it("sums monthly-equivalent cost across active subs", () => {
    expect(monthlyTotalCents([sub({ amountCents: 1000 }), sub({ billingCycle: "yearly", amountCents: 1200 })])).toBe(1100);
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
});

describe("canceledCount", () => {
  it("counts canceled subscriptions across all statuses", () => {
    expect(canceledCount([sub({ status: "canceled" }), sub({ status: "active" }), sub({ status: "canceled" })])).toBe(2);
  });
});
