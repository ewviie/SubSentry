import { describe, it, expect, vi } from "vitest";
import { runInsightsEngine, mergeInsightResults } from "./engine";
import { HEALTH_RULES } from "./rules/health";
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
    // "health.duplicates" positive entry regardless of the `positive`
    // filter's own exclusion below, so it doesn't by itself prove that
    // filter works. See the next test for the no-duplicates case that does.
    expect(output.positive.some((p) => p.ruleId === "health.duplicates")).toBe(false);
  });

  // UI audit finding: health.duplicates' positive branch ("No confirmed
  // duplicates") near-verbatim restates OverviewPanel's own always-rendered
  // "Duplicate check" callout on the same dashboard page — both read the
  // same shared duplicate-pair detection. Excluded from `positive`
  // (PositiveHabitsCard's only data source) so that reassurance has one
  // canonical surface instead of two; computeHealthScore still credits it
  // in the score breakdown regardless (see the next test), since that reads
  // `healthResults`, not this filtered array.
  it("positive findings exclude health.duplicates' positive branch (OverviewPanel already shows it)", () => {
    const subs = [sub({ name: "Netflix" }), sub({ name: "Spotify" })];
    const output = runInsightsEngine(subs, false);
    expect(output.positive.some((p) => p.ruleId === "health.duplicates")).toBe(false);
  });

  it("health score still credits health.duplicates' positive branch even though PositiveHabitsCard no longer shows it", () => {
    const subs = [sub({ name: "Netflix" }), sub({ name: "Spotify" })];
    const output = runInsightsEngine(subs, false);
    const redundancy = output.healthScore?.dimensions.find((d) => d.key === "redundancy");
    expect(redundancy?.status).toBe("good");
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

  // Regression (release-review finding #4): yearlySavingsCents/
  // estimatedYearlySavingsCents used to be monthlySavingsCents * 12 —
  // invisible for a monthly-billed redundant subscription (the test above),
  // but a real, silently-wrong dollar figure for a yearly-billed one, since
  // monthlySavingsCents is itself already monthlyCents()-rounded. A
  // $99.99/yr duplicate rounds to 833 cents/mo; 833 * 12 = 9996 cents
  // ($99.96), not the real $99.99 (9999 cents).
  it("does not double-round the yearly savings forecast for a yearly-billed duplicate", () => {
    const subs = [
      sub({ name: "Netflix", amountCents: 9999, billingCycle: "yearly" }),
      sub({ name: "Netflix Premium", amountCents: 9999, billingCycle: "yearly" }),
    ];
    const output = runInsightsEngine(subs, false);
    expect(output.savingsForecast.monthlySavingsCents).toBe(833);
    expect(output.savingsForecast.yearlySavingsCents).toBe(9999);
    expect(output.savingsForecast.yearlySavingsCents).not.toBe(833 * 12);
    expect(output.estimatedYearlySavingsCents).toBe(9999);
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
    // No optimization-category rule ran (not premium) — the estimated half
    // is honestly zero, not a fallback to the confirmed figure.
    expect(free.estimatedOptimizationYearlyCents).toBe(0);

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
    // Dashboard UX refinement pass: confirmed (savingsForecast) and
    // estimated (this field) must sum back to exactly the combined
    // unrealizedYearlySavingsCents above — the whole point of exposing this
    // field is so the UI can show the two halves separately without them
    // ever silently disagreeing with the combined total.
    expect(premium.estimatedOptimizationYearlyCents).toBe(375 * 12);
    expect(premium.savingsForecast.yearlySavingsCents + premium.estimatedOptimizationYearlyCents).toBe(
      premium.optimizationScore!.unrealizedYearlySavingsCents,
    );
  });

  // Regression (release-review finding #8): runInsightsEngine used to
  // evaluate HEALTH_RULES itself AND rely on computeHealthScore
  // re-evaluating the exact same rules against the exact same ctx a second
  // time internally, doubling the cost of every rule (including the O(n^2)
  // duplicate/overlap passes) on every call. computeHealthScore now
  // receives the already-evaluated results instead of re-deriving them.
  it("evaluates each health rule exactly once per call, not once for results and again for the health score", () => {
    const spy = vi.spyOn(HEALTH_RULES[0], "evaluate");
    spy.mockClear();
    runInsightsEngine([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })], false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // The health score's own breakdown must still credit every finding,
  // including the one health.duplicates warning branch runInsightsEngine's
  // own `results`/`positive`/`warnings` deliberately excludes for
  // presentational reasons (see this file's own comment above) — passing
  // the full, unfiltered health results into computeHealthScore (not
  // engine.ts's display-filtered subset) is what preserves that.
  it("health score breakdown still reflects a finding excluded from the displayed insights list", () => {
    const subs = [sub({ name: "Netflix", amountCents: 1000 }), sub({ name: "Netflix Premium", amountCents: 1000 })];
    const output = runInsightsEngine(subs, false);
    // Excluded from the displayed warnings (Savings opportunities already
    // covers it), but computeHealthScore's redundancy dimension must still
    // show a real, non-empty breakdown for the same finding.
    expect(output.warnings.some((w) => w.ruleId === "health.duplicates")).toBe(false);
    const redundancy = output.healthScore!.dimensions.find((d) => d.key === "redundancy")!;
    expect(redundancy.breakdown.length).toBeGreaterThan(0);
  });

  // Regression: a real React "two children with the same key" crash on the
  // subscription detail page, root-caused to this exact array shape.
  // premium.risk_high_spend_concentration (rules/premium.ts) is both
  // severity "critical" (so it lands in `warnings`) and `premium: true` (so
  // it also lands in `premiumInsights`) — severity and the premium flag are
  // independent axes, not mutually exclusive categories, and every
  // "risk_*" rule in premium.ts shares this same shape. A naive
  // `[...positive, ...warnings, ...premiumInsights]` concatenation (what
  // subscriptions/[id]/page.tsx used to do) therefore includes the exact
  // same InsightResult object twice.
  describe("warnings/premiumInsights overlap (regression: duplicate-key crash)", () => {
    // One outlier subscription making up >=50% of annual spend — the exact
    // evidence premium.risk_high_spend_concentration requires (see
    // rules/premium.ts's riskHighConcentration).
    const bigOutlier = sub({ name: "Enterprise Plan", amountCents: 100_000, category: "software" });
    const small = [sub({ name: "Aurora", amountCents: 1000 }), sub({ name: "Bramble", amountCents: 1000 })];

    it("reproduces the root cause: the same finding appears in both raw arrays", () => {
      const output = runInsightsEngine([bigOutlier, ...small], true);
      expect(output.warnings.some((w) => w.ruleId === "premium.risk_high_spend_concentration")).toBe(true);
      expect(output.premiumInsights.some((r) => r.ruleId === "premium.risk_high_spend_concentration")).toBe(true);
      // The naive concatenation subscriptions/[id]/page.tsx used to do
      // really did produce two entries with the same ruleId.
      const naiveConcat = [...output.positive, ...output.warnings, ...output.premiumInsights];
      const riskEntries = naiveConcat.filter((r) => r.ruleId === "premium.risk_high_spend_concentration");
      expect(riskEntries.length).toBeGreaterThanOrEqual(2);
    });

    it("mergeInsightResults deduplicates by ruleId, preserving the finding exactly once", () => {
      const output = runInsightsEngine([bigOutlier, ...small], true);
      const merged = mergeInsightResults(output.positive, output.warnings, output.premiumInsights);
      const riskEntries = merged.filter((r) => r.ruleId === "premium.risk_high_spend_concentration");
      expect(riskEntries.length).toBe(1);
      // Full content preserved — this isn't a lossy merge, the duplicate
      // removed is the literal same object.
      expect(riskEntries[0].title).toBe("Spend is concentrated in a few expensive subscriptions");
      expect(riskEntries[0].severity).toBe("critical");
      expect(riskEntries[0].premium).toBe(true);
    });

    it("mergeInsightResults never produces more than one entry per ruleId, across every category combination", () => {
      const output = runInsightsEngine([bigOutlier, ...small], true);
      const merged = mergeInsightResults(output.positive, output.warnings, output.premiumInsights);
      const ruleIds = merged.map((r) => r.ruleId);
      expect(new Set(ruleIds).size).toBe(ruleIds.length);
    });

    it("keeps the first-encountered occurrence's array order stable (positive, then warnings, then premiumInsights)", () => {
      const output = runInsightsEngine([bigOutlier, ...small], true);
      const merged = mergeInsightResults(output.positive, output.warnings, output.premiumInsights);
      const riskIndex = merged.findIndex((r) => r.ruleId === "premium.risk_high_spend_concentration");
      // It was deduplicated from `warnings` (the second array), not dropped
      // entirely and not duplicated a second time later from
      // `premiumInsights`.
      expect(riskIndex).toBeGreaterThanOrEqual(0);
      expect(merged.filter((r) => r.ruleId === "premium.risk_high_spend_concentration")).toHaveLength(1);
    });
  });
});
