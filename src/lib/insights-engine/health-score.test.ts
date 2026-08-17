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
});
