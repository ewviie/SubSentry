import { describe, it, expect } from "vitest";
import { computeInsights } from "./insights";
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
