import { describe, it, expect } from "vitest";
import { computeHealthScore, computeInsights, computePotentialSavingsMonthlyCents } from "./insights";
import type { Subscription } from "@/lib/db/schema";

let nextId = 1;
function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: `sub-${nextId++}`,
    userId: "user-1",
    name: "Test Sub",
    amountCents: 999,
    currency: "usd",
    billingCycle: "monthly",
    category: "other",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("computeInsights", () => {
  it("returns nothing when there are no active subscriptions", () => {
    expect(computeInsights([])).toEqual([]);
    expect(computeInsights([sub({ status: "canceled" })])).toEqual([]);
  });

  it("flags an overdue renewal for a past nextRenewalDate", () => {
    const overdue = sub({ name: "Gym", nextRenewalDate: "2020-01-01" });
    const insights = computeInsights([overdue]);
    expect(insights.some((i) => i.type === "overdue_renewal" && i.subscriptionIds.includes(overdue.id))).toBe(
      true,
    );
  });

  it("does not flag a future renewal as overdue", () => {
    const insights = computeInsights([sub({ nextRenewalDate: "2099-01-01" })]);
    expect(insights.some((i) => i.type === "overdue_renewal")).toBe(false);
  });

  it("flags a dominant category once it crosses the 40% share threshold", () => {
    const subs = [
      sub({ category: "streaming", amountCents: 5000, name: "Big Streaming" }),
      sub({ category: "software", amountCents: 1000, name: "Small Tool" }),
    ];
    const insights = computeInsights(subs);
    expect(insights.some((i) => i.type === "expensive_category")).toBe(true);
  });

  it("does not flag an expensive category when spend is evenly split", () => {
    const subs = [
      sub({ category: "streaming", amountCents: 1000 }),
      sub({ category: "software", amountCents: 1000 }),
      sub({ category: "fitness", amountCents: 1000 }),
    ];
    const insights = computeInsights(subs);
    expect(insights.some((i) => i.type === "expensive_category")).toBe(false);
  });

  it("flags a subscription costing much more per year than a typical one", () => {
    const outlier = sub({ name: "Big Ticket", amountCents: 10000, billingCycle: "monthly" });
    const subs = [
      outlier,
      sub({ name: "Small A", amountCents: 500 }),
      sub({ name: "Small B", amountCents: 500 }),
    ];
    const insights = computeInsights(subs);
    expect(
      insights.some((i) => i.type === "high_yearly_spend" && i.subscriptionIds.includes(outlier.id)),
    ).toBe(true);
  });

  it("flags likely duplicate names", () => {
    const a = sub({ name: "Netflix" });
    const b = sub({ name: "Netflix Premium" });
    const insights = computeInsights([a, b]);
    expect(
      insights.some(
        (i) => i.type === "possible_overlap" && i.subscriptionIds.includes(a.id) && i.subscriptionIds.includes(b.id),
      ),
    ).toBe(true);
  });

  it("does not flag unrelated names as duplicates", () => {
    const insights = computeInsights([sub({ name: "Netflix" }), sub({ name: "Spotify" })]);
    expect(insights.some((i) => i.type === "possible_overlap" && i.title.includes("duplicate"))).toBe(false);
  });

  it("flags multiple active subscriptions in the same category as possible overlap", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming" }),
      sub({ name: "Disney+", category: "streaming" }),
    ];
    const insights = computeInsights(subs);
    expect(insights.some((i) => i.type === "possible_overlap" && i.title.includes("streaming"))).toBe(true);
  });
});

describe("computePotentialSavingsMonthlyCents", () => {
  it("returns 0 when there are no duplicate insights", () => {
    const insights = computeInsights([sub({ name: "Netflix" }), sub({ name: "Spotify" })]);
    expect(computePotentialSavingsMonthlyCents(insights)).toBe(0);
  });

  it("sums the redundant subscription's cost for a flagged duplicate", () => {
    const a = sub({ name: "Netflix", amountCents: 1599 });
    const b = sub({ name: "Netflix Premium", amountCents: 999 });
    const insights = computeInsights([a, b]);
    expect(computePotentialSavingsMonthlyCents(insights)).toBe(999);
  });

  it("does not double-count a subscription flagged as redundant in more than one pair", () => {
    // Three near-identical names: a~b, a~c, and b~c all match, so the
    // O(n^2) loop produces multiple insights that could double-count b's
    // and c's cost if not deduplicated by subscription id.
    const a = sub({ name: "Netflix", amountCents: 1000 });
    const b = sub({ name: "Netflix ", amountCents: 900 });
    const c = sub({ name: "netflix", amountCents: 800 });
    const insights = computeInsights([a, b, c]);
    const total = computePotentialSavingsMonthlyCents(insights);
    // b and c are each counted exactly once (never a, never twice) — a
    // range assertion here would silently accept undercounting (e.g. 800
    // alone) as a false pass, so assert the exact expected total.
    expect(total).toBe(900 + 800);
  });

  it("never counts the same-category informational insight as savings", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming", amountCents: 1000 }),
      sub({ name: "Disney+", category: "streaming", amountCents: 1000 }),
    ];
    const insights = computeInsights(subs);
    expect(computePotentialSavingsMonthlyCents(insights)).toBe(0);
  });
});

describe("computeHealthScore", () => {
  it("returns null when there are no active subscriptions", () => {
    expect(computeHealthScore([], 0)).toBeNull();
  });

  it("scores 100 with no negative signals", () => {
    const insights = computeInsights([sub({ name: "Netflix" })]);
    const result = computeHealthScore(insights, 1);
    expect(result?.score).toBe(100);
    expect(result?.label).toBe("Excellent");
    expect(result?.factors.every((f) => f.passed)).toBe(true);
  });

  it("deducts points for an overdue renewal", () => {
    const overdue = sub({ name: "Gym", nextRenewalDate: "2020-01-01" });
    const insights = computeInsights([overdue]);
    const result = computeHealthScore(insights, 1);
    expect(result?.score).toBe(85);
    expect(result?.factors.find((f) => f.label.includes("overdue"))?.passed).toBe(false);
  });

  it("stays within 0-100 even with many negative signals", () => {
    const overdue1 = sub({ name: "Gym", nextRenewalDate: "2020-01-01" });
    const overdue2 = sub({ name: "Gym2", nextRenewalDate: "2020-01-01" });
    const overdue3 = sub({ name: "Gym3", nextRenewalDate: "2020-01-01" });
    const dup1 = sub({ name: "Netflix", amountCents: 1000 });
    const dup2 = sub({ name: "Netflix Premium", amountCents: 1000 });
    const big = sub({ name: "Big", category: "streaming", amountCents: 100000 });
    const subs = [overdue1, overdue2, overdue3, dup1, dup2, big];
    const insights = computeInsights(subs);
    const result = computeHealthScore(insights, subs.length);
    expect(result?.score).toBeGreaterThanOrEqual(0);
  });
});
