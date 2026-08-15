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

  it("quick wins are capped at 3", () => {
    // 5 subscriptions all renewing the same day (default nextRenewalDate)
    // trips health.renewal_clustering's warning branch every time — a
    // single always-firing source is enough to prove the cap on its own,
    // without needing 3 independently-tuned warning conditions.
    const subs = Array.from({ length: 5 }, () => sub({}));
    const output = runInsightsEngine(subs, false);
    expect(output.quickWins.length).toBeLessThanOrEqual(3);
  });

  // Regression test: quickWins/positive previously could never be non-empty
  // for ANY input, because HEALTH_RULES results (the only source of
  // "warning"/"positive" severity in this engine — FREE_RULES is
  // exclusively "info", PREMIUM_RULES is exclusively premium: true) were
  // evaluated only for the health score's numeric breakdown and never
  // threaded into the general `results` pool. See engine.ts's own comment
  // on the fix.
  it("quick wins surfaces a real health-rule finding, not just duplicates", () => {
    // 3 subscriptions all renewing on the same default date trips
    // health.renewal_clustering's warning branch (findRenewalCluster
    // requires 3+ renewals within a 7-day window — identical dates satisfy
    // that trivially). None of these are near-duplicate names, so this
    // exercises a genuinely different signal than the duplicate-detection
    // tests elsewhere in this file.
    const subs = [sub({ name: "Netflix" }), sub({ name: "Spotify" }), sub({ name: "Hulu" })];
    const output = runInsightsEngine(subs, false);
    expect(output.quickWins.some((w) => w.ruleId === "health.renewal_clustering")).toBe(true);
  });

  it("quick wins never includes health.duplicates' warning branch — Savings opportunities already covers it", () => {
    const subs = [sub({ name: "Netflix", amountCents: 1000 }), sub({ name: "Netflix Premium", amountCents: 1500 })];
    const output = runInsightsEngine(subs, false);
    expect(output.quickWins.some((w) => w.ruleId === "health.duplicates")).toBe(false);
    // With real duplicates present, health.duplicates fires its *warning*
    // branch, not its positive one — this scenario can never contain a
    // "health.duplicates" positive entry regardless of the exclusion filter,
    // so it doesn't by itself prove the positive branch survives. See the
    // next test for that.
    expect(output.positive.some((p) => p.ruleId === "health.duplicates")).toBe(false);
  });

  // Regression test for a bug introduced by the fix above and caught by a
  // council re-check: filtering health.duplicates out of `results` by
  // ruleId alone silently removed its *positive* branch too ("No duplicate
  // subscriptions"), even though Savings opportunities has zero collision
  // risk with it (that card is silent precisely when there's nothing to
  // flag) — a user with no duplicates could never see this positive habit
  // acknowledged, while computeHealthScore's breakdown still credited it.
  it("positive findings still include health.duplicates' positive branch when there are no duplicates", () => {
    const subs = [sub({ name: "Netflix" }), sub({ name: "Spotify" })];
    const output = runInsightsEngine(subs, false);
    expect(output.positive.some((p) => p.ruleId === "health.duplicates")).toBe(true);
  });

  it("positive findings surface real health-rule results (previously always empty)", () => {
    // A single long-running, non-duplicate, non-clustered subscription
    // trips health.long_running's positive branch.
    const output = runInsightsEngine([sub({ name: "Netflix", createdAt: new Date("2020-01-01T00:00:00Z") })], false);
    expect(output.positive.some((p) => p.ruleId === "health.long_running")).toBe(true);
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

  it("optimization score folds in optimization-rule savings, not just confirmed duplicates", () => {
    const subs = [sub({ name: "Netflix", amountCents: 1000 }), sub({ name: "Netflix Premium", amountCents: 1500 })];
    // Non-premium: premium.annual_switch_savings never runs, so the score
    // reflects the $1500/mo confirmed-duplicate total alone.
    const free = runInsightsEngine(subs, false);
    expect(free.savingsForecast.monthlySavingsCents).toBe(1500);
    expect(free.optimizationScore?.unrealizedYearlySavingsCents).toBe(1500 * 12);

    // Premium: the same duplicate is still confirmed (still 1500/mo), but
    // premium.annual_switch_savings now also fires on both monthly-billed
    // subs (($1000+$1500)*12*0.15 assumed discount / 12 = $375/mo) — the
    // score must include both, not just the duplicate figure.
    const premium = runInsightsEngine(subs, true);
    expect(premium.savingsForecast.monthlySavingsCents).toBe(1500);
    expect(premium.optimizationScore?.unrealizedYearlySavingsCents).toBe((1500 + 375) * 12);
    expect(premium.optimizationScore!.unrealizedYearlySavingsCents).toBeGreaterThan(
      free.optimizationScore!.unrealizedYearlySavingsCents,
    );
  });
});
