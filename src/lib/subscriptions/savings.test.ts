import { describe, it, expect } from "vitest";
import {
  computeSavingsRecommendations,
  computeTotalPotentialSavingsMonthlyCents,
  computeRealizedSavings,
  getSavingsPriority,
  type SavingsRecommendation,
} from "./savings";
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

describe("computeSavingsRecommendations", () => {
  it("returns nothing for no subscriptions or a single one", () => {
    expect(computeSavingsRecommendations([])).toEqual([]);
    expect(computeSavingsRecommendations([sub({ name: "Netflix" })])).toEqual([]);
  });

  it("ignores canceled subscriptions", () => {
    const result = computeSavingsRecommendations([
      sub({ name: "Netflix", status: "canceled" }),
      sub({ name: "Netflix Premium", status: "canceled" }),
    ]);
    expect(result).toEqual([]);
  });

  it("flags a likely duplicate pair with the second subscription as the cancel target", () => {
    const first = sub({ name: "Netflix", amountCents: 1599 });
    const second = sub({ name: "Netflix Premium", amountCents: 2299 });
    const result = computeSavingsRecommendations([first, second]);
    const duplicate = result.find((r) => r.type === "duplicate")!;
    expect(duplicate.targetSubscriptionId).toBe(second.id);
    expect(duplicate.monthlySavingsCents).toBe(2299);
    expect(duplicate.involvedSubscriptionIds).toEqual([first.id, second.id]);
  });

  it("uses natural phrasing for two identically-named duplicates instead of 'Netflix and Netflix'", () => {
    const first = sub({ name: "Netflix", amountCents: 1599, nextRenewalDate: "2099-01-01" });
    const second = sub({ name: "Netflix", amountCents: 1599, nextRenewalDate: "2099-02-01" });
    const result = computeSavingsRecommendations([first, second]);
    const duplicate = result.find((r) => r.type === "duplicate")!;
    expect(duplicate.title).toBe("Two Netflix subscriptions look like duplicates");
    expect(duplicate.title).not.toContain("Netflix and Netflix");
    // Renewal dates (real, already-stored data) stand in for the name as
    // the way the description tells the two apart, since the name alone
    // can't here.
    expect(duplicate.description).toContain("2099-01-01");
    expect(duplicate.description).toContain("2099-02-01");
  });

  it("keeps the original 'X and Y' phrasing when the two names actually differ", () => {
    const first = sub({ name: "Netflix", amountCents: 1599 });
    const second = sub({ name: "Netflix Premium", amountCents: 2299 });
    const result = computeSavingsRecommendations([first, second]);
    const duplicate = result.find((r) => r.type === "duplicate")!;
    expect(duplicate.title).toBe("Netflix and Netflix Premium look like duplicates");
  });

  it("does not flag genuinely different names as duplicates", () => {
    const result = computeSavingsRecommendations([sub({ name: "Netflix" }), sub({ name: "Spotify" })]);
    expect(result.some((r) => r.type === "duplicate")).toBe(false);
  });

  it("flags category concentration with the priciest subscription as the review target, no savings claimed", () => {
    const cheap = sub({ name: "Gym A", category: "fitness", amountCents: 1000 });
    const expensive = sub({ name: "Gym B", category: "fitness", amountCents: 5000 });
    const result = computeSavingsRecommendations([cheap, expensive]);
    const concentration = result.find((r) => r.type === "category_concentration")!;
    expect(concentration.targetSubscriptionId).toBe(expensive.id);
    expect(concentration.monthlySavingsCents).toBe(0);
    expect(concentration.involvedSubscriptionIds).toEqual(expect.arrayContaining([cheap.id, expensive.id]));
  });

  it("does not flag a category with only one subscription", () => {
    const result = computeSavingsRecommendations([sub({ category: "fitness" })]);
    expect(result.some((r) => r.type === "category_concentration")).toBe(false);
  });

  it("sorts recommendations by monthly savings, descending", () => {
    const result = computeSavingsRecommendations([
      sub({ name: "Netflix", category: "streaming", amountCents: 1000 }),
      sub({ name: "Netflix Premium", category: "streaming", amountCents: 2000 }),
      sub({ name: "Hulu", category: "streaming", amountCents: 500 }),
    ]);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].monthlySavingsCents).toBeGreaterThanOrEqual(result[i].monthlySavingsCents);
    }
  });
});

describe("computeTotalPotentialSavingsMonthlyCents", () => {
  it("sums only duplicate-type recommendations, not category concentration", () => {
    const first = sub({ name: "Netflix", category: "streaming", amountCents: 1000 });
    const second = sub({ name: "Netflix Premium", category: "streaming", amountCents: 1500 });
    const third = sub({ name: "Hulu", category: "streaming", amountCents: 500 });
    const total = computeTotalPotentialSavingsMonthlyCents(computeSavingsRecommendations([first, second, third]));
    expect(total).toBe(1500);
  });

  it("counts each redundant subscription once even if flagged by multiple pairs", () => {
    const a = sub({ name: "Netflix" });
    const b = sub({ name: "Netflix Plus", amountCents: 999 });
    const c = sub({ name: "Netflix Plus 2", amountCents: 999 });
    // b and c both fuzzy-match a and each other — b/c should each count once.
    const total = computeTotalPotentialSavingsMonthlyCents(computeSavingsRecommendations([a, b, c]));
    expect(total).toBe(1998);
  });

  it("returns 0 for no recommendations", () => {
    expect(computeTotalPotentialSavingsMonthlyCents([])).toBe(0);
  });
});

describe("computeRealizedSavings", () => {
  it("returns null totals and 0 count for no subscriptions", () => {
    expect(computeRealizedSavings([])).toEqual({ monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 0 });
  });

  it("ignores active and paused subscriptions", () => {
    const result = computeRealizedSavings([
      sub({ status: "active", amountCents: 1000 }),
      sub({ status: "paused", amountCents: 1000 }),
    ]);
    expect(result).toEqual({ monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 0 });
  });

  it("sums monthly-equivalent cost across every canceled subscription, mixed billing cycles, same currency", () => {
    const result = computeRealizedSavings([
      sub({ status: "canceled", amountCents: 1000, billingCycle: "monthly", currency: "usd" }), // 1000/mo
      sub({ status: "canceled", amountCents: 12000, billingCycle: "yearly", currency: "usd" }), // 1000/mo
      sub({ status: "active", amountCents: 99999 }), // excluded
    ]);
    expect(result.monthlyCents).toBe(2000);
    expect(result.yearlyCents).toBe(24000);
    expect(result.currency).toBe("usd");
    expect(result.canceledCount).toBe(2);
  });

  it("counts every canceled subscription toward canceledCount, including a $0 one", () => {
    const result = computeRealizedSavings([sub({ status: "canceled", amountCents: 0, currency: "usd" })]);
    expect(result.canceledCount).toBe(1);
    expect(result.monthlyCents).toBe(0);
  });

  // Regression: currency is unvalidated free text on this schema (see
  // money.ts's sumMonthlyCentsIfSingleCurrency, which enforces the same
  // rule for the import-review total) — summing raw cents across different
  // currencies would produce a number wearing a real one's formatting.
  // canceledCount still reflects both (currency-independent), but no dollar
  // total is claimed.
  it("returns null totals (never a fabricated cross-currency sum) when canceled subscriptions span more than one currency", () => {
    const result = computeRealizedSavings([
      sub({ status: "canceled", amountCents: 1000, currency: "usd" }),
      sub({ status: "canceled", amountCents: 1000, currency: "eur" }),
    ]);
    expect(result.monthlyCents).toBeNull();
    expect(result.yearlyCents).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.canceledCount).toBe(2);
  });
});

describe("getSavingsPriority", () => {
  function rec(monthlySavingsCents: number): SavingsRecommendation {
    return {
      id: "r1",
      type: monthlySavingsCents > 0 ? "duplicate" : "category_concentration",
      title: "t",
      description: "d",
      actionLabel: "Review",
      monthlySavingsCents,
      targetSubscriptionId: "sub-1",
      involvedSubscriptionIds: ["sub-1"],
    };
  }

  it("is 'low' for a $0 recommendation (category_concentration — never proven savings)", () => {
    expect(getSavingsPriority(rec(0))).toBe("low");
  });

  it("is 'medium' for a small confirmed duplicate saving", () => {
    expect(getSavingsPriority(rec(500))).toBe("medium");
  });

  it("is 'high' at and above the $15/mo threshold", () => {
    expect(getSavingsPriority(rec(1500))).toBe("high");
    expect(getSavingsPriority(rec(5000))).toBe("high");
  });

  it("is 'medium' just below the threshold", () => {
    expect(getSavingsPriority(rec(1499))).toBe("medium");
  });
});
