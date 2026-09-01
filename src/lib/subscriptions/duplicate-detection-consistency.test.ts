import { describe, it, expect } from "vitest";
import { computeInsights, computePotentialSavingsMonthlyCents } from "./insights";
import { computeSavingsRecommendations, computeTotalPotentialSavingsMonthlyCents } from "./savings";
import type { Subscription } from "@/lib/db/schema";

// Regression coverage for the fix that made insights.ts and savings.ts share
// one namesLikelyMatch implementation (see its own comment in insights.ts)
// instead of each maintaining a separate, byte-for-byte-identical copy.
// Before that fix, nothing actually enforced the two stayed identical — a
// future edit to one copy's threshold could have silently desynced the
// dashboard hero card's "confirmed duplicates" total from the Savings
// opportunities card and Optimization score, which all depend on agreeing
// on what counts as a duplicate. This proves the two systems now agree by
// construction (shared code), not by coincidence (two copies that happen to
// match today).

function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    userId: "test-user",
    name: "Netflix",
    amountCents: 1599,
    currency: "usd",
    billingCycle: "monthly",
    category: "streaming",
    nextRenewalDate: "2099-01-01",
    status: "active",
    notes: null,
    source: "manual",
    lastReviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("insights.ts and savings.ts agree on duplicate detection", () => {
  it("identify the same pair as a duplicate, and credit it with the same dollar amount", () => {
    const subscriptions: Subscription[] = [
      sub({ id: "a", name: "Netflix", amountCents: 1599 }),
      sub({ id: "b", name: "Netflix Premium", amountCents: 2299 }),
    ];

    const insights = computeInsights(subscriptions);
    const insightsSavings = computePotentialSavingsMonthlyCents(insights);

    const recommendations = computeSavingsRecommendations(subscriptions);
    const savingsSavings = computeTotalPotentialSavingsMonthlyCents(recommendations);

    expect(insights.some((i) => i.type === "possible_overlap" && i.potentialSavingsMonthlyCents !== undefined)).toBe(
      true,
    );
    expect(recommendations.some((r) => r.type === "duplicate")).toBe(true);
    expect(insightsSavings).toBe(2299);
    expect(savingsSavings).toBe(2299);
    expect(insightsSavings).toBe(savingsSavings);
  });

  it("agree that near-miss names within edit distance 2 are also duplicates", () => {
    const subscriptions: Subscription[] = [
      sub({ id: "a", name: "Spotify", amountCents: 999 }),
      sub({ id: "b", name: "Spootify", amountCents: 1099 }), // 1 char inserted — edit distance 1
    ];

    const insights = computeInsights(subscriptions);
    const recommendations = computeSavingsRecommendations(subscriptions);

    expect(computePotentialSavingsMonthlyCents(insights)).toBe(1099);
    expect(computeTotalPotentialSavingsMonthlyCents(recommendations)).toBe(1099);
  });

  it("agree that unrelated names are not duplicates", () => {
    const subscriptions: Subscription[] = [
      sub({ id: "a", name: "Netflix", amountCents: 1599 }),
      sub({ id: "b", name: "Spotify", amountCents: 999 }),
    ];

    const insights = computeInsights(subscriptions);
    const recommendations = computeSavingsRecommendations(subscriptions);

    expect(computePotentialSavingsMonthlyCents(insights)).toBe(0);
    expect(computeTotalPotentialSavingsMonthlyCents(recommendations)).toBe(0);
    expect(recommendations.some((r) => r.type === "duplicate")).toBe(false);
  });
});
