import { describe, it, expect } from "vitest";
import { computeHealthScore, RULE_RECOMMENDED_ACTION } from "./health-score";
import { HEALTH_RULES } from "./rules/health";
import { sub } from "./test-fixtures";
import type { EngineContext } from "./types";

function ctx(subs: ReturnType<typeof sub>[], overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    subscriptions: subs,
    active: subs.filter((s) => s.status === "active"),
    todayIso: "2026-01-01",
    isPremium: false,
    ...overrides,
  };
}

describe("computeHealthScore", () => {
  it("returns null with no active subscriptions", () => {
    expect(computeHealthScore(ctx([]))).toBeNull();
  });

  it("scores a clean single subscription high, with a breakdown", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix" })]));
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(90);
    expect(result!.rating).toBe("Excellent");
    expect(result!.breakdown.length).toBeGreaterThan(0);
  });

  it("penalizes duplicate subscriptions", () => {
    const clean = computeHealthScore(ctx([sub({ name: "Netflix" })]))!;
    const withDup = computeHealthScore(
      ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]),
    )!;
    expect(withDup.score).toBeLessThan(clean.score);
    expect(withDup.breakdown.some((b) => b.delta < 0)).toBe(true);
  });

  it("clamps score into [0, 100]", () => {
    const many = Array.from({ length: 6 }, (_, i) => sub({ name: `Netflix ${i}`, amountCents: 999 }));
    const result = computeHealthScore(ctx(many))!;
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("assigns rating tiers matching the score", () => {
    const excellent = computeHealthScore(ctx([sub({ name: "Netflix" })]))!;
    expect(excellent.score).toBeGreaterThanOrEqual(90);
    expect(excellent.rating).toBe("Excellent");
  });

  // Phase 7.2: multi-dimensional model — see rules/health.ts and this
  // file's own header comment for the full rationale.
  it("exposes all 5 dimensions, each independently scored 0-100", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Spotify" })]))!;
    const keys = result.dimensions.map((d) => d.key).sort();
    expect(keys).toEqual(["growth", "hygiene", "redundancy", "renewal", "spending"].sort());
    for (const dimension of result.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(100);
      expect(dimension.summary.length).toBeGreaterThan(0);
    }
  });

  it("a confirmed duplicate hits the redundancy dimension specifically, not an unrelated one", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]))!;
    const redundancy = result.dimensions.find((d) => d.key === "redundancy")!;
    expect(redundancy.status).not.toBe("good");
    expect(redundancy.score).toBeLessThan(100);
  });

  // Phase 8 Part 7: per-dimension recommended action.
  it("a dimension with real negative evidence carries a recommended action", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]))!;
    const redundancy = result.dimensions.find((d) => d.key === "redundancy")!;
    expect(redundancy.recommendedAction).toBeTruthy();
    expect(redundancy.recommendedAction).toMatch(/review|cancel/i);
  });

  it("a clean dimension with only positive evidence has no recommended action", () => {
    // A single subscription: redundancy's only finding is the positive
    // "no confirmed duplicates" branch — nothing to act on.
    const result = computeHealthScore(ctx([sub({ name: "Netflix" })]))!;
    const redundancy = result.dimensions.find((d) => d.key === "redundancy")!;
    expect(redundancy.recommendedAction).toBeNull();
  });

  it("an unknown (zero-evidence) dimension has no recommended action", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix", createdAt: new Date("2026-01-01T00:00:00Z") })]))!;
    const unknown = result.dimensions.find((d) => d.status === "unknown")!;
    expect(unknown.recommendedAction).toBeNull();
  });

  // Regression (local-council review, Maintainability/Simplicity lenses):
  // RULE_RECOMMENDED_ACTION is coupled to rules/health.ts's `id` fields by
  // a bare string, in a different file — a typo or rename on either side
  // used to compile clean and silently degrade to a missing action with no
  // test catching it. This fails immediately if that ever happens again.
  it("every RULE_RECOMMENDED_ACTION key matches a real HEALTH_RULES id", () => {
    const realIds = new Set(HEALTH_RULES.map((r) => r.id));
    for (const key of Object.keys(RULE_RECOMMENDED_ACTION)) {
      expect(realIds.has(key), `RULE_RECOMMENDED_ACTION key "${key}" does not match any HEALTH_RULES id`).toBe(true);
    }
  });

  // Extends the single-rule spot check above to every rule with a real
  // negative branch (previously only health.duplicates was verified end to
  // end) — each fixture is tuned to trip that specific rule's negative
  // case, per its own test in rules/health.test.ts.
  describe("recommendedAction coverage for every rule with a negative branch", () => {
    it("health.functional_overlap", () => {
      const result = computeHealthScore(ctx([sub({ name: "Spotify" }), sub({ name: "Apple Music" })]))!;
      expect(result.dimensions.find((d) => d.key === "redundancy")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.functional_overlap"]);
    });

    // 2 subscriptions in the dominant category, not 1 — a single-
    // subscription dominant category is deliberately suppressed by the
    // concentration/outliers double-counting guard added this same phase
    // (see rules/health.ts's concentration rule comment), so this fixture
    // avoids that case to isolate concentration's own recommendedAction.
    it("health.concentration", () => {
      const result = computeHealthScore(
        ctx([
          sub({ category: "streaming", amountCents: 4000 }),
          sub({ category: "streaming", amountCents: 4000 }),
          sub({ category: "fitness", amountCents: 1000 }),
          sub({ category: "software", amountCents: 1000 }),
        ]),
      )!;
      expect(result.dimensions.find((d) => d.key === "spending")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.concentration"]);
    });

    it("health.expensive_outliers", () => {
      const result = computeHealthScore(ctx([sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 10000 })]))!;
      expect(result.dimensions.find((d) => d.key === "spending")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.expensive_outliers"]);
    });

    // 3 subscriptions moderately above the mean, not one large outlier —
    // keeps every subscription under 2x the mean so health.expensive_
    // outliers doesn't also fire and out-rank this rule's own finding by
    // a larger |scoreImpact|.
    it("health.small_subscriptions_add_up", () => {
      const subs = [
        sub({ name: "Aurora", amountCents: 1000 }),
        sub({ name: "Bramble", amountCents: 1000 }),
        sub({ name: "Cascade", amountCents: 1000 }),
        sub({ name: "Ivory", amountCents: 300 }),
        sub({ name: "Juniper", amountCents: 300 }),
        sub({ name: "Kestrel", amountCents: 300 }),
      ];
      const result = computeHealthScore(ctx(subs))!;
      expect(result.dimensions.find((d) => d.key === "spending")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.small_subscriptions_add_up"]);
    });

    it("health.recent_growth", () => {
      const subs = Array.from({ length: 5 }, () => sub({ createdAt: new Date("2025-12-31T00:00:00Z") }));
      const result = computeHealthScore(ctx(subs))!;
      expect(result.dimensions.find((d) => d.key === "growth")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.recent_growth"]);
    });

    it("health.renewal_risk", () => {
      const subs = [
        sub({ nextRenewalDate: "2026-01-05", amountCents: 1000, billingCycle: "monthly" }),
        sub({ nextRenewalDate: "2026-01-06", amountCents: 1000, billingCycle: "monthly" }),
        sub({ nextRenewalDate: "2026-01-07", amountCents: 20000, billingCycle: "yearly" }),
      ];
      const result = computeHealthScore(ctx(subs))!;
      expect(result.dimensions.find((d) => d.key === "renewal")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.renewal_risk"]);
    });

    it("health.overdue_renewals", () => {
      const result = computeHealthScore(ctx([sub({ name: "Netflix", nextRenewalDate: "2020-01-01" })]))!;
      expect(result.dimensions.find((d) => d.key === "hygiene")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.overdue_renewals"]);
    });

    it("health.uncategorized_imports", () => {
      const result = computeHealthScore(ctx([sub({ name: "Unknown Corp", source: "csv_import", category: "other" })]))!;
      expect(result.dimensions.find((d) => d.key === "hygiene")!.recommendedAction).toBe(RULE_RECOMMENDED_ACTION["health.uncategorized_imports"]);
    });
  });

  it("functional overlap penalizes redundancy more mildly than a confirmed duplicate", () => {
    const withOverlap = computeHealthScore(ctx([sub({ name: "Spotify" }), sub({ name: "Apple Music" })]))!;
    const withDuplicate = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]))!;
    const overlapRedundancy = withOverlap.dimensions.find((d) => d.key === "redundancy")!.score;
    const duplicateRedundancy = withDuplicate.dimensions.find((d) => d.key === "redundancy")!.score;
    expect(overlapRedundancy).toBeGreaterThan(duplicateRedundancy);
  });

  // Regression: monthly billing must never move the score, in either
  // direction — the old model's billing_mix rule (-3 for "no annual/
  // quarterly billing") was removed entirely because monthly billing is not
  // inherently unhealthy, and neither is annual billing inherently
  // healthier on its own.
  it("an all-monthly-billing account is not penalized relative to an equivalent annual-billing account", () => {
    const monthly = computeHealthScore(
      ctx([sub({ name: "Netflix", billingCycle: "monthly", amountCents: 1000 }), sub({ name: "Spotify", billingCycle: "monthly", amountCents: 1000 })]),
    )!;
    const annual = computeHealthScore(
      ctx([sub({ name: "Netflix", billingCycle: "yearly", amountCents: 12000 }), sub({ name: "Spotify", billingCycle: "yearly", amountCents: 12000 })]),
    )!;
    expect(monthly.score).toBe(annual.score);
  });

  // Regression: a large *number* of subscriptions alone (the old model's
  // subscription_count rule, -3 above 15) must not penalize the score —
  // having many subscriptions is not inherently unhealthy.
  it("a large subscription count alone does not penalize the score", () => {
    // Genuinely distinct names (not "Service 0"/"Service 1" — a single
    // trailing-digit difference is within namesLikelyMatch's own edit-
    // distance tolerance and would falsely trigger the duplicates rule,
    // which isn't what this test is about).
    const names = [
      "Aurora", "Bramble", "Cascade", "Driftwood", "Ember", "Fennel", "Granite", "Harbor", "Ivory", "Juniper",
      "Kestrel", "Lantern", "Meadow", "Nimbus", "Onyx", "Pixel", "Quartz", "Ridgeline", "Sable", "Thicket",
    ];
    const many = names.map((name) => sub({ name, category: "other" }));
    const result = computeHealthScore(ctx(many))!;
    // No dimension should read "attention" purely from count — every
    // subscription here is distinct, non-overlapping, on-time, and
    // reasonably priced.
    expect(result.dimensions.every((d) => d.status !== "attention")).toBe(true);
  });

  // Regression (CodeRabbit finding): a dimension with zero contributing
  // rules used to default its rawScore to 100 and its status to "good" —
  // indistinguishable from genuine positive evidence. A single brand-new
  // subscription leaves spending/growth/renewal with nothing to say yet.
  it("marks a dimension with zero contributing rules as unknown, not a fabricated 'good'", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix", createdAt: new Date("2026-01-01T00:00:00Z") })]))!;
    const growth = result.dimensions.find((d) => d.key === "growth")!;
    expect(growth.status).toBe("unknown");
    expect(growth.summary).toContain("Not enough data");
  });

  // Self-verifying rather than a hardcoded magic number: recomputes the
  // expected weighted average directly from the dimensions the function
  // itself returned (using the same weights documented in this file's own
  // DIMENSION_WEIGHTS comment), so this stays correct if a rule's threshold
  // is retuned later without needing hand-traced arithmetic re-derived here.
  it("computes the overall score as a weighted average over known dimensions only, excluding unknown ones", () => {
    const weights: Record<string, number> = { spending: 0.2, redundancy: 0.3, growth: 0.1, renewal: 0.2, hygiene: 0.2 };
    const result = computeHealthScore(ctx([sub({ name: "Netflix", createdAt: new Date("2026-01-01T00:00:00Z") })]))!;
    const known = result.dimensions.filter((d) => d.status !== "unknown");
    expect(known.length).toBeGreaterThan(0);
    expect(known.length).toBeLessThan(result.dimensions.length);
    const knownWeight = known.reduce((sum, d) => sum + weights[d.key], 0);
    const expected = Math.round(known.reduce((sum, d) => sum + d.score * weights[d.key], 0) / knownWeight);
    expect(result.score).toBe(expected);
  });

  // Regression (CodeRabbit finding): an unrelated positive and negative
  // finding in the same dimension used to be allowed to net against each
  // other, so a real negative (a genuine expensive outlier) could be bought
  // back to "good" status by an unrelated positive (balanced category
  // spread) that does nothing to address it. Fixture: 6 subscriptions sized
  // so category concentration stays under 40% (balanced → positive) while
  // one subscription is still a genuine 2x-mean amount outlier (negative).
  it("never reports 'good' for a dimension that has any real negative evidence, even if a net score would clear 80", () => {
    const subs = [
      sub({ name: "Big", category: "other", amountCents: 5000 }),
      sub({ name: "Streaming Sub", category: "streaming", amountCents: 1600 }),
      sub({ name: "Fitness Sub", category: "fitness", amountCents: 1600 }),
      sub({ name: "Software Sub", category: "software", amountCents: 1600 }),
      sub({ name: "News Sub", category: "news", amountCents: 1600 }),
      sub({ name: "Gaming Sub", category: "gaming", amountCents: 1600 }),
    ];
    const result = computeHealthScore(ctx(subs))!;
    const spending = result.dimensions.find((d) => d.key === "spending")!;
    expect(spending.breakdown.some((b) => b.delta > 0)).toBe(true); // balanced-category bonus present
    expect(spending.breakdown.some((b) => b.delta < 0)).toBe(true); // genuine outlier penalty present
    expect(spending.score).toBeGreaterThanOrEqual(80); // the net score alone would read "good"
    expect(spending.status).not.toBe("good"); // but real negative evidence exists, so it must not
  });

  describe("confidence", () => {
    it("is low with fewer than 2 active subscriptions", () => {
      const result = computeHealthScore(ctx([sub({ name: "Netflix" })]))!;
      expect(result.confidence.level).toBe("low");
      expect(result.confidence.reason).toBeTruthy();
    });

    it("is low with very recent subscription history, even with several subscriptions", () => {
      const recent = ctx(
        Array.from({ length: 5 }, (_, i) => sub({ name: `Service ${i}`, createdAt: new Date("2025-12-30T00:00:00Z") })),
      );
      const result = computeHealthScore(recent)!;
      expect(result.confidence.level).toBe("low");
    });

    it("is high with several subscriptions and real history", () => {
      // Fixture default createdAt (2025-01-01) is ~1 year before todayIso
      // (2026-01-01) — real history depth.
      const result = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Spotify" }), sub({ name: "Hulu" }), sub({ name: "Adobe" })]))!;
      expect(result.confidence.level).toBe("high");
      expect(result.confidence.reason).toBeUndefined();
    });
  });

  // Rebalance pass — the concrete behavior requested: 100/100 should be
  // genuinely hard to reach, a real problem should visibly move the score
  // (not just shave a couple of points off it), and a genuinely clean
  // account should still land in the 90-100 band. See rules/health.ts's and
  // this file's own rebalance-pass comments for the two mechanisms (bigger
  // per-rule tiers, and the worst-dimension penalty) these tests cover.
  describe("rebalanced scoring — problems must cost more than a rounding error", () => {
    // Deliberately built so only health.duplicates has anything negative to
    // say: same category ("other", the fixture default) so concentration
    // has no opinion (only one category present), equal default amounts so
    // no outlier, renewal dates far in the future so overdue/renewal_risk
    // stay silent, manual source so no uncategorized-import gap. One real,
    // isolated finding — the realistic "otherwise fine, but you do have one
    // actual duplicate" account, not a portfolio riddled with problems.
    it("a single confirmed duplicate — otherwise clean — is enough to drop out of the 90-100 band", () => {
      const clean = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Hulu" })]))!;
      const oneDuplicate = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]))!;
      expect(clean.score).toBeGreaterThanOrEqual(90);
      expect(oneDuplicate.score).toBeLessThan(90);
      expect(oneDuplicate.rating).not.toBe("Excellent");
      // Not artificially tanked either — one real, moderate finding, not a
      // portfolio-wide catastrophe.
      expect(oneDuplicate.score).toBeGreaterThanOrEqual(70);
    });

    // A realistic "average, never actively reviewed" account: no exact
    // duplicates, but a plausible functional overlap (Spotify + Apple
    // Music), spending concentrated in one category with a genuine outlier
    // (Netflix at well over 2x the group's mean), and one overdue renewal
    // (Notion) — real, moderate findings a typical unexamined account
    // plausibly has, directly matching the factors this rebalance was asked
    // to make meaningful (unnecessary/overlapping subscriptions, high
    // recurring spending, upcoming renewals). Not an extreme, worst-case
    // portfolio — this should read as "worth a look" (Very Good/Good), not
    // "Excellent," and not be tanked into "Needs Attention" either.
    it("an average account with a few moderate findings does not default to 90-100 'Excellent'", () => {
      const result = computeHealthScore(
        ctx([
          sub({ name: "Spotify", category: "streaming", amountCents: 1099 }),
          sub({ name: "Apple Music", category: "streaming", amountCents: 1099 }),
          sub({ name: "Netflix", category: "streaming", amountCents: 5000 }),
          sub({ name: "Notion", category: "software", amountCents: 1000, nextRenewalDate: "2025-06-01" }),
        ]),
      )!;
      expect(result.rating).not.toBe("Excellent");
      expect(result.score).toBeLessThan(90);
      expect(result.score).toBeGreaterThanOrEqual(70);
    });

    // Two confirmed duplicate pairs is a genuinely bad redundancy problem
    // (dimension score capped at 40/100 — see rules/health.ts's duplicates
    // cap) — the overall score needs to actually reflect that instead of
    // being diluted down to "Very Good" by four dimensions parked at their
    // ceiling. This is the worst-dimension-penalty mechanism, isolated.
    it("a severe single-dimension problem pulls the overall score further than the plain weighted average would", () => {
      const result = computeHealthScore(
        ctx([
          sub({ name: "Netflix" }),
          sub({ name: "Netflix Premium" }),
          sub({ name: "Hulu" }),
          sub({ name: "Hulu Plus" }),
        ]),
      )!;
      const redundancy = result.dimensions.find((d) => d.key === "redundancy")!;
      expect(redundancy.score).toBeLessThanOrEqual(40);
      const weights: Record<string, number> = { spending: 0.2, redundancy: 0.3, growth: 0.1, renewal: 0.2, hygiene: 0.2 };
      const known = result.dimensions.filter((d) => d.status !== "unknown");
      const knownWeight = known.reduce((sum, d) => sum + weights[d.key], 0);
      const plainWeightedAverage = known.reduce((sum, d) => sum + d.score * weights[d.key], 0) / knownWeight;
      expect(result.score).toBeLessThan(Math.round(plainWeightedAverage));
      expect(result.rating).not.toBe("Excellent");
      expect(result.rating).not.toBe("Very Good");
      // Bounded, not punitive beyond what the evidence supports — recomputed
      // from the same two correction terms computeHealthScore itself applies
      // (worstDimensionPenalty, capped at 35; spreadPenalty, a continuous
      // shortfall-below-70 sum excluding the single worst dimension, scaled
      // 0.25x and capped at 18) rather than a hardcoded magic number, so
      // this stays correct if either cap is retuned later without needing
      // hand-traced arithmetic re-derived here (same self-verifying pattern
      // as the weighted-average test above).
      const worstScore = Math.min(...known.map((d) => d.score));
      const worstPenalty = Math.min(35, Math.max(0, (90 - worstScore) * 0.38));
      const shortfalls = known.map((d) => Math.max(0, 70 - d.score)).sort((a, b) => b - a);
      const excessShortfall = shortfalls.slice(1).reduce((sum, s) => sum + s, 0);
      const spreadPenalty = Math.min(18, Math.round(excessShortfall * 0.25));
      expect(result.score).toBeGreaterThanOrEqual(Math.round(plainWeightedAverage) - Math.ceil(worstPenalty) - spreadPenalty);
    });

    // The corrective term must never fire for a dimension that's merely
    // very good (90+, no real problem) — only genuinely bad ones.
    it("does not apply the worst-dimension penalty when every dimension is already 90+", () => {
      const result = computeHealthScore(ctx([sub({ name: "Netflix" }), sub({ name: "Hulu" }), sub({ name: "Adobe" })]))!;
      const known = result.dimensions.filter((d) => d.status !== "unknown");
      expect(known.every((d) => d.score >= 90)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(90);
    });

    // Health Score v2's spreadPenalty: a portfolio with genuine, evidenced
    // problems in *multiple independent* dimensions must score worse than
    // one with the exact same single problem alone — a compounding pattern
    // (duplicates AND a renewal spike) is a materially worse portfolio than
    // either issue in isolation, which the pre-v2 model (weighted average +
    // a single worst-dimension term) had no way to reflect.
    it("penalizes a portfolio with problems in multiple independent dimensions more than the same single problem alone", () => {
      // Both fixtures share the exact same 4 subscriptions and the exact
      // same total monthly spend (4997) — only BigBill's billing cycle and
      // renewal date differ, so the confirmed-duplicate pair's severity
      // (same pair count, same share of total spend) is identical in both,
      // isolating the difference below to the added renewal problem plus
      // spreadPenalty, not a side effect of redundancy quietly changing too.
      const oneProblem = computeHealthScore(
        ctx([
          sub({ name: "Netflix", amountCents: 999, nextRenewalDate: "2099-01-01" }),
          sub({ name: "Netflix Premium", amountCents: 999, nextRenewalDate: "2099-01-02" }),
          sub({ name: "Hulu", amountCents: 999, nextRenewalDate: "2099-01-03" }),
          sub({ name: "Big Bill", amountCents: 2000, billingCycle: "monthly", nextRenewalDate: "2099-01-04" }),
        ]),
      )!;
      const twoProblems = computeHealthScore(
        ctx([
          sub({ name: "Netflix", amountCents: 999, nextRenewalDate: "2099-01-01" }),
          sub({ name: "Netflix Premium", amountCents: 999, nextRenewalDate: "2099-01-02" }),
          sub({ name: "Hulu", amountCents: 999, nextRenewalDate: "2099-01-03" }),
          sub({ name: "Big Bill", amountCents: 24000, billingCycle: "yearly", nextRenewalDate: "2026-01-05" }),
        ]),
      )!;
      const redundancyOne = oneProblem.dimensions.find((d) => d.key === "redundancy")!.score;
      const redundancyTwo = twoProblems.dimensions.find((d) => d.key === "redundancy")!.score;
      expect(redundancyOne).toBe(redundancyTwo);
      const renewalTwo = twoProblems.dimensions.find((d) => d.key === "renewal")!;
      expect(renewalTwo.score).toBeLessThan(70);
      expect(twoProblems.score).toBeLessThan(oneProblem.score);
    });
  });

  describe("confidence — multi-currency coverage", () => {
    it("caps confidence at medium when a meaningful share of active subscriptions sit outside the primary currency", () => {
      const subs = [
        sub({ name: "Netflix", currency: "usd" }),
        sub({ name: "Hulu", currency: "usd" }),
        sub({ name: "UK Gym", currency: "gbp" }),
        sub({ name: "EU VPN", currency: "eur" }),
      ];
      const result = computeHealthScore(ctx(subs))!;
      expect(result.confidence.level).not.toBe("high");
    });

    it("does not cap confidence when the account is effectively single-currency", () => {
      const result = computeHealthScore(
        ctx([sub({ name: "Netflix" }), sub({ name: "Spotify" }), sub({ name: "Hulu" }), sub({ name: "Adobe" })]),
      )!;
      expect(result.confidence.level).toBe("high");
    });
  });

  // Health Score v2 adversarial-audit fix: a large share of active
  // subscriptions with an already-passed renewal date is a live signal
  // that this app's own "active" set might not reflect reality — every
  // dollar-based figure in the score is computed FROM that set. Confidence
  // must reflect that doubt rather than default to "high" purely because
  // subscription count and history depth look fine.
  describe("confidence — overdue-renewal density", () => {
    it("caps confidence at medium when a large share of active subscriptions are overdue", () => {
      // todayIso here is "2026-01-01" (this file's ctx default) — all three
      // dates below are strictly before it, so overdueRenewals counts them.
      const result = computeHealthScore(
        ctx([
          sub({ name: "Netflix", nextRenewalDate: "2025-10-01" }),
          sub({ name: "Hulu", nextRenewalDate: "2025-11-01" }),
          sub({ name: "Spotify", nextRenewalDate: "2025-12-01" }),
          sub({ name: "Adobe", nextRenewalDate: "2099-01-01" }),
        ]),
      )!;
      expect(result.confidence.level).not.toBe("high");
    });

    it("does not cap confidence for a single forgotten renewal among many", () => {
      const subs = [
        sub({ name: "Netflix", nextRenewalDate: "2025-10-01" }),
        ...["Hulu", "Spotify", "Adobe", "Disney", "Peacock", "Paramount"].map((name) => sub({ name })),
      ];
      const result = computeHealthScore(ctx(subs))!;
      expect(result.confidence.level).toBe("high");
    });
  });
});
