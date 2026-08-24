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

  // Regression: totalYearlyCents used to be totalMonthlyCents * 12,
  // double-rounding a yearly subscription's annual figure away from its own
  // stored price. $99.99/yr must report exactly 9999, not 9996.
  it("reports a yearly subscription's exact annual total, not a double-rounded one", () => {
    const output = runInsightsEngine([sub({ name: "Yearly Sub", billingCycle: "yearly", amountCents: 9999 })], false);
    expect(output.stats.totalYearlyCents).toBe(9999);
  });

  // Regression, reproducing an exact real-account bug found via live browser
  // verification: stats.totalMonthlyCents/totalYearlyCents/topMerchants used
  // to sum/rank across ALL active subscriptions regardless of currency. A
  // portfolio of 2 USD subscriptions ($15.49/mo Netflix, $8.00/mo Notion)
  // plus 1 GBP subscription (£25.00/mo UK Gym) used to report $31.82 +
  // £25.00 = "$56.82"/mo and "$681.87"/yr — a number with no real-world
  // meaning, labeled as if it were all one currency. The correct totals
  // exclude the GBP subscription and disclose it via otherCurrencyActiveCount.
  it("excludes a non-primary-currency subscription from stats totals and discloses it", () => {
    const netflix = sub({ name: "Netflix", amountCents: 1549, billingCycle: "monthly", currency: "usd" });
    const notion = sub({ name: "Notion", amountCents: 800, billingCycle: "monthly", currency: "usd" });
    const ukGym = sub({ name: "UK Gym", amountCents: 2500, billingCycle: "monthly", currency: "gbp" });
    const output = runInsightsEngine([netflix, notion, ukGym], false);

    expect(output.stats.currency).toBe("usd");
    expect(output.stats.totalMonthlyCents).toBe(2349); // 1549 + 800, not 4849
    expect(output.stats.totalYearlyCents).toBe(28188); // 2349 * 12, not (4849 * 12)
    expect(output.stats.otherCurrencyActiveCount).toBe(1);
    expect(output.stats.activeCount).toBe(3); // the true count is unaffected
    // topMerchants must never surface the GBP subscription — it's summed
    // against totalYearlyCents elsewhere (biggest-opportunity.ts's share%),
    // which would be wrong if the two disagreed on currency.
    expect(output.stats.topMerchants.map((m) => m.name)).not.toContain("UK Gym");
  });

  it("quick wins are capped at 3", () => {
    // 5 overdue active subscriptions trips health.overdue_renewals' warning
    // branch every time — a single always-firing source is enough to prove
    // the cap on its own, without needing 3 independently-tuned warning
    // conditions.
    const subs = Array.from({ length: 5 }, () => sub({ nextRenewalDate: "2020-01-01" }));
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
    // 3 subscriptions with a renewal date already in the past trips
    // health.overdue_renewals' warning branch — real bookkeeping-neglect
    // evidence, not a guess. None of these are near-duplicate names, so
    // this exercises a genuinely different signal than the
    // duplicate-detection tests elsewhere in this file.
    const subs = [
      sub({ name: "Netflix", nextRenewalDate: "2020-01-01" }),
      sub({ name: "Spotify", nextRenewalDate: "2020-01-01" }),
      sub({ name: "Hulu", nextRenewalDate: "2020-01-01" }),
    ];
    const output = runInsightsEngine(subs, false);
    expect(output.quickWins.some((w) => w.ruleId === "health.overdue_renewals")).toBe(true);
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

  // Regression, reproducing another exact real-account bug: with 2 USD
  // subscriptions and 1 GBP subscription all renewing within 30 days,
  // totalDueNext30DaysCents used to be 1549 + 800 + 2500 = 4849 ("$48.49"),
  // silently combining GBP cents into a dollar figure. The correct total
  // excludes the GBP subscription. Renewal dates are computed relative to
  // the real current date (the engine reads today via `new Date()`
  // internally, not an injectable parameter) so this is deterministic
  // regardless of when the test runs, while still landing within the
  // engine's actual 30-day window every time.
  it("excludes a non-primary-currency subscription from the renewal forecast's 30-day total", () => {
    const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const netflix = sub({ name: "Netflix", amountCents: 1549, nextRenewalDate: inDays(5), currency: "usd" });
    const notion = sub({ name: "Notion", amountCents: 800, nextRenewalDate: inDays(10), currency: "usd" });
    const ukGym = sub({ name: "UK Gym", amountCents: 2500, nextRenewalDate: inDays(3), currency: "gbp" });
    const output = runInsightsEngine([netflix, notion, ukGym], false);
    expect(output.renewalForecast.currency).toBe("usd");
    expect(output.renewalForecast.totalDueNext30DaysCents).toBe(2349); // 1549 + 800, not 4849
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
