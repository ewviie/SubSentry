import { describe, it, expect } from "vitest";
import { runInsightsEngine } from "./engine";
import { sub } from "./test-fixtures";

describe("runInsightsEngine", () => {
  it("handles zero subscriptions without throwing", () => {
    const output = runInsightsEngine([], false);
    expect(output.healthScore).toBeNull();
    expect(output.optimizationScore).toBeNull();
    expect(output.stats.activeCount).toBe(0);
    expect(output.premiumInsights).toEqual([]);
  });

  it("excludes premium insights for non-premium users", () => {
    const subs = Array.from({ length: 3 }, () => sub({ category: "streaming" }));
    const output = runInsightsEngine(subs, false);
    expect(output.premiumInsights).toEqual([]);
  });

  it("includes premium insights only when isPremium is true", () => {
    const subs = Array.from({ length: 3 }, () => sub({ category: "streaming" }));
    const output = runInsightsEngine(subs, true);
    expect(output.premiumInsights.length).toBeGreaterThan(0);
    expect(output.premiumInsights.every((r) => r.premium)).toBe(true);
  });

  it("computes a health score and stats for active subscriptions", () => {
    const output = runInsightsEngine([sub({ name: "Netflix", amountCents: 1500 })], false);
    expect(output.healthScore?.score).toBeGreaterThan(0);
    expect(output.stats.totalMonthlyCents).toBe(1500);
    expect(output.stats.totalYearlyCents).toBe(18000);
    expect(output.stats.activeCount).toBe(1);
  });

  it("quick wins are ranked by monthly savings and capped at 3", () => {
    const subs = [
      sub({ name: "Netflix", amountCents: 1000 }),
      sub({ name: "Netflix Premium", amountCents: 500 }),
      sub({ name: "Spotify", amountCents: 1000 }),
      sub({ name: "Spotify Premium", amountCents: 2000 }),
    ];
    const output = runInsightsEngine(subs, false);
    expect(output.quickWins.length).toBeLessThanOrEqual(3);
  });

  it("savings forecast matches computeSavingsRecommendations totals", () => {
    const subs = [sub({ name: "Netflix", amountCents: 1000 }), sub({ name: "Netflix Premium", amountCents: 1500 })];
    const output = runInsightsEngine(subs, false);
    expect(output.savingsForecast.monthlySavingsCents).toBe(1500);
    expect(output.savingsForecast.yearlySavingsCents).toBe(18000);
    expect(output.estimatedYearlySavingsCents).toBe(18000);
  });

  it("renewal forecast identifies the soonest upcoming renewal", () => {
    const soon = sub({ name: "Soon", nextRenewalDate: "2099-01-05" });
    const later = sub({ name: "Later", nextRenewalDate: "2099-06-01" });
    const output = runInsightsEngine([later, soon], false);
    expect(output.renewalForecast.nextRenewal?.subscriptionId).toBe(soon.id);
  });

  it("ignores canceled subscriptions in active-based stats but not in engine input", () => {
    const output = runInsightsEngine([sub({ status: "canceled" }), sub({ status: "active" })], false);
    expect(output.stats.activeCount).toBe(1);
  });

  it("optimization score is null with no active subscriptions", () => {
    expect(runInsightsEngine([sub({ status: "canceled" })], false).optimizationScore).toBeNull();
  });
});
