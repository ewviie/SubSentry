import { describe, it, expect } from "vitest";
import {
  computeSavingsRecommendations,
  computeTotalPotentialSavingsMonthlyCents,
  computeTotalPotentialSavingsYearlyCents,
  computeTotalPotentialSavings,
  computeRealizedSavings,
  getSavingsPriority,
  splitSavingsRecommendationsByPlan,
  type SavingsRecommendation,
} from "./savings";
import type { Subscription, RealizedSavingsRecord } from "@/lib/db/schema";

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
    lastReviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let nextRealizedSavingsId = 1;
function realizedSavingsRecord(overrides: Partial<RealizedSavingsRecord>): RealizedSavingsRecord {
  return {
    id: `realized-${nextRealizedSavingsId++}`,
    userId: "user-1",
    subscriptionId: `sub-${nextRealizedSavingsId}`,
    subscriptionName: "Test Sub",
    amountCents: 999,
    billingCycle: "monthly",
    currency: "usd",
    subscriptionSource: "manual",
    canceledAt: new Date(),
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

  // Regression: SavingsRecommendation used to carry no currency field at
  // all, so every card rendering monthlySavingsCents/impactCents
  // (savings-recommendation-card.tsx, biggest-opportunity.ts) fell back to
  // formatCents' USD default regardless of the subscription's real
  // currency.
  it("carries the target (redundant) subscription's own currency for a duplicate", () => {
    const first = sub({ name: "UK Gym", amountCents: 2000, currency: "gbp" });
    const second = sub({ name: "UK Gym Plus", amountCents: 2500, currency: "gbp" });
    const result = computeSavingsRecommendations([first, second]);
    const duplicate = result.find((r) => r.type === "duplicate")!;
    expect(duplicate.currency).toBe("gbp");
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

  it("flags genuine functional overlap with the priciest subscription as the review target, no savings claimed", () => {
    const cheap = sub({ name: "Canva Pro", category: "software", amountCents: 1299 });
    const expensive = sub({ name: "Adobe Creative Cloud", category: "software", amountCents: 5499 });
    const result = computeSavingsRecommendations([cheap, expensive]);
    const overlap = result.find((r) => r.type === "functional_overlap")!;
    expect(overlap).toBeDefined();
    expect(overlap.targetSubscriptionId).toBe(expensive.id);
    expect(overlap.monthlySavingsCents).toBe(0);
    expect(overlap.involvedSubscriptionIds).toEqual(expect.arrayContaining([cheap.id, expensive.id]));
  });

  it("does not flag two subscriptions sharing only a broad category with no genuine functional overlap", () => {
    // Both "software", but a code host and a video-call tool solve nothing
    // similar — the exact false positive raw category-equality used to
    // produce (regression coverage for that fix).
    const result = computeSavingsRecommendations([sub({ name: "GitHub", category: "software" }), sub({ name: "Zoom", category: "software" })]);
    expect(result.some((r) => r.type === "functional_overlap")).toBe(false);
  });

  it("does not flag a single subscription with no functional-overlap partner", () => {
    const result = computeSavingsRecommendations([sub({ name: "Adobe Creative Cloud", category: "software" })]);
    expect(result.some((r) => r.type === "functional_overlap")).toBe(false);
  });

  // Regression (CodeRabbit finding): "Netflix" and "Netflix Premium" match
  // as a confirmed duplicate AND both resolve to the video_streaming
  // merchant group — without excluding the already-flagged-redundant half,
  // this produced two separate recommendations for the exact same pair.
  it("does not also flag a confirmed duplicate pair as a functional overlap", () => {
    const result = computeSavingsRecommendations([
      sub({ name: "Netflix", category: "streaming" }),
      sub({ name: "Netflix Premium", category: "streaming" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("duplicate");
  });

  it("still surfaces a genuine overlap between a kept duplicate-pair member and a distinct third service", () => {
    const result = computeSavingsRecommendations([
      sub({ name: "Netflix", category: "streaming" }),
      sub({ name: "Netflix Premium", category: "streaming" }),
      sub({ name: "Disney+", category: "streaming" }),
    ]);
    expect(result.some((r) => r.type === "duplicate")).toBe(true);
    const overlap = result.find((r) => r.type === "functional_overlap");
    expect(overlap).toBeDefined();
    expect(overlap!.involvedSubscriptionIds).not.toContain(result.find((r) => r.type === "duplicate")!.targetSubscriptionId);
  });

  // Regression (local-council review, Maintainability lens): this test's
  // original name/assertion ("sorts by monthly savings, descending")
  // predated the Phase 8 priority-tier-first sort and only passed because
  // evidenceTier "confirmed" already outranks "review" for an unrelated
  // reason — it wasn't actually verifying the behavior its name claimed.
  // Rewritten to test what's genuinely still untested: within the SAME
  // evidenceTier (two confirmed duplicates here), ordering by real dollar
  // impact descending. Cross-tier ordering has its own dedicated test
  // ("ranks a confirmed duplicate above a larger-dollar review-only
  // overlap", below).
  it("orders two confirmed duplicates within the same priority tier by dollar impact, descending", () => {
    const result = computeSavingsRecommendations([
      // Both redundant amounts clear the $15/mo "high" threshold, so both
      // pairs land in the same priority tier — impactCents is the only
      // thing left to order them by.
      sub({ name: "Netflix", amountCents: 500 }),
      sub({ name: "Netflix Premium", amountCents: 4000 }), // bigger duplicate saving
      sub({ name: "Spotify", amountCents: 500 }),
      sub({ name: "Spotify Premium", amountCents: 2000 }), // smaller duplicate saving
    ]);
    const duplicates = result.filter((r) => r.type === "duplicate");
    expect(duplicates).toHaveLength(2);
    expect(getSavingsPriority(duplicates[0])).toBe(getSavingsPriority(duplicates[1])); // same tier, verified
    expect(duplicates[0].impactCents).toBeGreaterThan(duplicates[1].impactCents);
  });

  // Regression (release-review finding #5): the same impactCents tiebreak
  // above compared raw cents with no currency check — a GBP finding's raw
  // cents outranking a USD one purely because 2000 > 1800 is not a real
  // magnitude comparison (this app has no exchange rate). A cross-currency
  // pair must tie on impactCents and fall through to the next tiebreaker
  // (urgencyDays) instead.
  it("does not rank a cross-currency finding above another by raw cents alone", () => {
    const today = "2026-01-01";
    const result = computeSavingsRecommendations(
      [
        // GBP pair: larger raw impactCents (2000), but renews further away.
        sub({ name: "Netflix", amountCents: 500, currency: "gbp", nextRenewalDate: "2026-06-01" }),
        sub({ name: "Netflix Premium", amountCents: 2000, currency: "gbp", nextRenewalDate: "2026-06-01" }),
        // USD pair: smaller raw impactCents (1800), but renews sooner.
        sub({ name: "Spotify", amountCents: 500, currency: "usd", nextRenewalDate: "2026-01-10" }),
        sub({ name: "Spotify Premium", amountCents: 1800, currency: "usd", nextRenewalDate: "2026-01-10" }),
      ],
      today,
    );
    const duplicates = result.filter((r) => r.type === "duplicate");
    expect(duplicates).toHaveLength(2);
    // Both clear the $15/mo "high" priority threshold and are both
    // "confirmed" evidence — same tier, so impactCents (then urgencyDays)
    // is what's actually being tested here.
    expect(getSavingsPriority(duplicates[0])).toBe(getSavingsPriority(duplicates[1]));
    expect(duplicates[0].impactCents).toBeLessThan(duplicates[1].impactCents);
    // Pre-fix, the GBP pair (higher raw cents) would sort first regardless
    // of currency. Post-fix, the sooner-renewing USD pair sorts first.
    expect(duplicates[0].currency).toBe("usd");
    expect(duplicates[1].currency).toBe("gbp");
  });

  // Phase 8 Part 6: flags 3+ individually-small active subscriptions whose
  // combined cost is a material share of total spend — see
  // findSmallSubscriptionsCluster's own comment in insights.ts.
  describe("small_subscriptions", () => {
    it("flags a real death-by-a-thousand-cuts pattern, never a claimed saving", () => {
      const result = computeSavingsRecommendations([
        sub({ name: "Dominant", amountCents: 3000 }),
        sub({ name: "Tiny1", amountCents: 300 }),
        sub({ name: "Tiny2", amountCents: 300 }),
        sub({ name: "Tiny3", amountCents: 300 }),
      ]);
      const small = result.find((r) => r.type === "small_subscriptions");
      expect(small).toBeDefined();
      expect(small!.monthlySavingsCents).toBe(0);
      expect(small!.impactCents).toBe(900);
      expect(small!.evidenceTier).toBe("review");
      expect(small!.involvedSubscriptionIds).toHaveLength(3);
    });

    it("does not fire for an evenly-priced portfolio", () => {
      const result = computeSavingsRecommendations([
        sub({ name: "A", amountCents: 1000 }),
        sub({ name: "B", amountCents: 1000 }),
        sub({ name: "C", amountCents: 1000 }),
        sub({ name: "D", amountCents: 1000 }),
      ]);
      expect(result.some((r) => r.type === "small_subscriptions")).toBe(false);
    });
  });

  describe("impactCents / evidenceTier / urgencyDays", () => {
    it("a confirmed duplicate has impactCents equal to monthlySavingsCents and evidenceTier 'confirmed'", () => {
      const result = computeSavingsRecommendations([sub({ name: "Netflix", amountCents: 1000 }), sub({ name: "Netflix Premium", amountCents: 1500 })]);
      const dup = result.find((r) => r.type === "duplicate")!;
      expect(dup.impactCents).toBe(dup.monthlySavingsCents);
      expect(dup.evidenceTier).toBe("confirmed");
    });

    it("a functional overlap has impactCents equal to the combined group cost and evidenceTier 'review'", () => {
      const result = computeSavingsRecommendations([
        sub({ name: "Spotify", amountCents: 1000 }),
        sub({ name: "Apple Music", amountCents: 1500 }),
      ]);
      const overlap = result.find((r) => r.type === "functional_overlap")!;
      expect(overlap.impactCents).toBe(2500);
      expect(overlap.evidenceTier).toBe("review");
    });

    it("urgencyDays reflects the soonest involved subscription's real renewal date", () => {
      const todayIso = "2026-06-01";
      const soon = sub({ name: "Netflix", nextRenewalDate: "2026-06-05" });
      const later = sub({ name: "Netflix Premium", nextRenewalDate: "2026-07-01" });
      const result = computeSavingsRecommendations([soon, later], todayIso);
      const dup = result.find((r) => r.type === "duplicate")!;
      expect(dup.urgencyDays).toBe(4); // min(4, 30) days out from todayIso
    });

    it("urgencyDays is negative for an already-overdue involved subscription", () => {
      const todayIso = "2026-06-01";
      const overdue = sub({ name: "Netflix", nextRenewalDate: "2026-05-01" });
      const future = sub({ name: "Netflix Premium", nextRenewalDate: "2026-07-01" });
      const result = computeSavingsRecommendations([overdue, future], todayIso);
      const dup = result.find((r) => r.type === "duplicate")!;
      expect(dup.urgencyDays).toBeLessThan(0);
    });
  });

  // Phase 8 Part 6: "do not simply sort by dollar amount" — a confirmed,
  // deterministic-evidence finding must outrank a larger-dollar review-only
  // finding, proving the ranking is priority-tier-first, not a raw
  // impactCents sort.
  it("ranks a confirmed duplicate above a larger-dollar review-only overlap", () => {
    const result = computeSavingsRecommendations([
      // Confirmed duplicate: crosses the $15/mo "high" threshold on its own.
      sub({ name: "Netflix", amountCents: 800 }),
      sub({ name: "Netflix Premium", amountCents: 1600 }),
      // Functional overlap: $80/mo combined — a much bigger dollar amount,
      // but review-only evidence caps it at "medium," never "high".
      sub({ name: "Adobe Creative Cloud", amountCents: 5000 }),
      sub({ name: "Canva Pro", amountCents: 3000 }),
    ]);
    const dupIndex = result.findIndex((r) => r.type === "duplicate");
    const overlapIndex = result.findIndex((r) => r.type === "functional_overlap");
    expect(dupIndex).toBeGreaterThanOrEqual(0);
    expect(overlapIndex).toBeGreaterThanOrEqual(0);
    expect(dupIndex).toBeLessThan(overlapIndex);
  });

  // Regression (local-council review, Devil's Advocate lens): within the
  // *same* priority tier ("medium" here — a small confirmed duplicate and
  // a large review-only overlap can both land there), evidenceTier must
  // break the tie before dollar impact — otherwise a bigger-but-unproven
  // finding could outrank a smaller-but-guaranteed one, distinguished only
  // by a badge a skimming user might not notice.
  it("within the same priority tier, a confirmed duplicate ranks above a larger-dollar review-only finding", () => {
    const result = computeSavingsRecommendations([
      // Confirmed duplicate: small, stays in the "medium" tier (below $15).
      sub({ name: "Netflix", amountCents: 300 }),
      sub({ name: "Netflix Premium", amountCents: 600 }),
      // Functional overlap: much larger combined amount, but review-only
      // evidence caps it at "medium" too — same tier as the duplicate above.
      sub({ name: "Adobe Creative Cloud", amountCents: 5000 }),
      sub({ name: "Canva Pro", amountCents: 3000 }),
    ]);
    const dup = result.find((r) => r.type === "duplicate")!;
    const overlap = result.find((r) => r.type === "functional_overlap")!;
    expect(overlap.impactCents).toBeGreaterThan(dup.impactCents); // overlap really is bigger in dollars
    expect(result.indexOf(dup)).toBeLessThan(result.indexOf(overlap)); // but confirmed still ranks first
  });

  describe("stale detection", () => {
    it("flags an active subscription never reviewed and added long ago", () => {
      const oldCreatedAt = new Date(Date.now() - 200 * 86_400_000);
      const result = computeSavingsRecommendations([
        sub({ name: "Old Gym", lastReviewedAt: null, createdAt: oldCreatedAt }),
      ]);
      const stale = result.find((r) => r.type === "stale");
      expect(stale).toBeDefined();
      expect(stale!.evidenceTier).toBe("review");
      expect(stale!.monthlySavingsCents).toBe(0); // never a proven saving
      expect(stale!.description).toContain("never reviewed");
    });

    it("flags an active subscription reviewed long ago, with different copy than never-reviewed", () => {
      const oldReview = new Date(Date.now() - 150 * 86_400_000);
      const result = computeSavingsRecommendations([
        sub({ name: "Old News", lastReviewedAt: oldReview, createdAt: new Date(Date.now() - 400 * 86_400_000) }),
      ]);
      const stale = result.find((r) => r.type === "stale");
      expect(stale).toBeDefined();
      expect(stale!.description).toContain("haven't reviewed this in");
      expect(stale!.description).not.toContain("never reviewed");
    });

    it("does not flag a recently-reviewed subscription", () => {
      const result = computeSavingsRecommendations([
        sub({ name: "Fresh", lastReviewedAt: new Date(), createdAt: new Date(Date.now() - 400 * 86_400_000) }),
      ]);
      expect(result.some((r) => r.type === "stale")).toBe(false);
    });

    it("ignores paused/canceled subscriptions regardless of staleness", () => {
      const oldCreatedAt = new Date(Date.now() - 400 * 86_400_000);
      const result = computeSavingsRecommendations([
        sub({ name: "Canceled Thing", status: "canceled", lastReviewedAt: null, createdAt: oldCreatedAt }),
      ]);
      expect(result.some((r) => r.type === "stale")).toBe(false);
    });
  });
});

describe("computeTotalPotentialSavingsMonthlyCents", () => {
  it("sums only duplicate-type recommendations, not functional_overlap", () => {
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

  // Regression (release-review follow-up): this used to sum
  // monthlySavingsCents across every duplicate recommendation regardless of
  // currency — a GBP duplicate's savings could silently inflate a
  // USD-denominated total. Two USD duplicate pairs vs. one GBP pair makes
  // USD the primary currency (majority by count); the GBP pair's savings
  // must be excluded from the total entirely, not converted or blended in.
  it("never sums a non-primary-currency duplicate's savings into the total", () => {
    const subs = [
      sub({ name: "Netflix", amountCents: 500, currency: "usd" }),
      sub({ name: "Netflix Premium", amountCents: 1000, currency: "usd" }),
      sub({ name: "Spotify", amountCents: 300, currency: "usd" }),
      sub({ name: "Spotify Premium", amountCents: 500, currency: "usd" }),
      sub({ name: "Hulu", amountCents: 400, currency: "gbp" }),
      sub({ name: "Hulu Plus", amountCents: 2000, currency: "gbp" }),
    ];
    const recommendations = computeSavingsRecommendations(subs);
    const duplicates = recommendations.filter((r) => r.type === "duplicate");
    expect(duplicates).toHaveLength(3); // 2 usd pairs + 1 gbp pair, all detected
    const total = computeTotalPotentialSavingsMonthlyCents(recommendations);
    expect(total).toBe(1500); // 1000 (Netflix Premium) + 500 (Spotify Premium), usd only
    expect(total).not.toBe(3500); // the pre-fix behavior: 1000 + 500 + 2000 blended
  });
});

// Regression (release-review finding #4): engine.ts used to compute
// `yearlySavingsCents`/`estimatedYearlySavingsCents` as
// `monthlySavingsCents * 12` — double-rounding on top of monthlySavingsCents'
// own monthlyCents() rounding for a yearly-billed redundant subscription. A
// $99.99/yr duplicate rounds to 833 cents/mo (monthlyCents(9999, "yearly")),
// and 833 * 12 = 9996 cents ($99.96), not the real $99.99 (9999 cents).
// computeTotalPotentialSavingsYearlyCents must reproduce the true figure by
// summing each recommendation's own annualSavingsCents instead.
describe("computeTotalPotentialSavingsYearlyCents", () => {
  it("does not double-round a yearly-billed redundant subscription's savings", () => {
    const first = sub({ name: "Netflix", amountCents: 9999, billingCycle: "yearly" });
    const second = sub({ name: "Netflix Premium", amountCents: 9999, billingCycle: "yearly" });
    const recommendations = computeSavingsRecommendations([first, second]);
    expect(computeTotalPotentialSavingsMonthlyCents(recommendations)).toBe(833);
    expect(computeTotalPotentialSavingsYearlyCents(recommendations)).toBe(9999);
    expect(computeTotalPotentialSavingsYearlyCents(recommendations)).not.toBe(833 * 12);
  });

  it("sums only duplicate-type recommendations, not functional_overlap", () => {
    const first = sub({ name: "Netflix", category: "streaming", amountCents: 1000, billingCycle: "monthly" });
    const second = sub({ name: "Netflix Premium", category: "streaming", amountCents: 1500, billingCycle: "monthly" });
    const third = sub({ name: "Hulu", category: "streaming", amountCents: 500, billingCycle: "monthly" });
    const total = computeTotalPotentialSavingsYearlyCents(computeSavingsRecommendations([first, second, third]));
    expect(total).toBe(1500 * 12);
  });

  it("returns 0 for no recommendations", () => {
    expect(computeTotalPotentialSavingsYearlyCents([])).toBe(0);
  });

  // Same currency-safety regression as computeTotalPotentialSavingsMonthlyCents's
  // own test above, for the annual total.
  it("never sums a non-primary-currency duplicate's savings into the total", () => {
    const subs = [
      sub({ name: "Netflix", amountCents: 500, currency: "usd" }),
      sub({ name: "Netflix Premium", amountCents: 1000, currency: "usd" }),
      sub({ name: "Spotify", amountCents: 300, currency: "usd" }),
      sub({ name: "Spotify Premium", amountCents: 500, currency: "usd" }),
      sub({ name: "Hulu", amountCents: 400, currency: "gbp" }),
      sub({ name: "Hulu Plus", amountCents: 2000, currency: "gbp" }),
    ];
    const recommendations = computeSavingsRecommendations(subs);
    const total = computeTotalPotentialSavingsYearlyCents(recommendations);
    expect(total).toBe(1500 * 12); // usd only, annualized
    expect(total).not.toBe(3500 * 12); // the pre-fix behavior: gbp blended in
  });
});

// Retention pass: the combined {monthlyCents, yearlyCents, currency} reader
// (weekly-digest-job.ts's own digest, which has no other reliable way to
// know which currency a "potential savings" total is denominated in).
describe("computeTotalPotentialSavings", () => {
  it("reproduces both narrow totals plus the real currency they're in", () => {
    const first = sub({ name: "Netflix", category: "streaming", amountCents: 1000, billingCycle: "monthly", currency: "usd" });
    const second = sub({ name: "Netflix Premium", category: "streaming", amountCents: 1500, billingCycle: "monthly", currency: "usd" });
    const recommendations = computeSavingsRecommendations([first, second]);

    const combined = computeTotalPotentialSavings(recommendations);
    expect(combined.monthlyCents).toBe(computeTotalPotentialSavingsMonthlyCents(recommendations));
    expect(combined.yearlyCents).toBe(computeTotalPotentialSavingsYearlyCents(recommendations));
    expect(combined.currency).toBe("usd");
  });

  it("returns a null currency alongside zero totals when there's nothing to count", () => {
    expect(computeTotalPotentialSavings([])).toEqual({ monthlyCents: 0, yearlyCents: 0, currency: null });
  });

  it("never mislabels a non-primary-currency duplicate's savings with the wrong currency", () => {
    // A clear usd majority (2 duplicate pairs) against a single gbp pair —
    // same ratio computeTotalPotentialSavingsYearlyCents's own currency-
    // safety test above uses, so the majority isn't a coin-flip tie-break.
    const subs = [
      sub({ name: "Netflix", amountCents: 500, currency: "usd" }),
      sub({ name: "Netflix Premium", amountCents: 1000, currency: "usd" }),
      sub({ name: "Spotify", amountCents: 300, currency: "usd" }),
      sub({ name: "Spotify Premium", amountCents: 500, currency: "usd" }),
      sub({ name: "Hulu", amountCents: 400, currency: "gbp" }),
      sub({ name: "Hulu Plus", amountCents: 2000, currency: "gbp" }),
    ];
    const recommendations = computeSavingsRecommendations(subs);
    const combined = computeTotalPotentialSavings(recommendations);
    expect(combined.currency).toBe("usd");
    expect(combined.monthlyCents).toBe(1500);
  });
});

describe("computeRealizedSavings", () => {
  it("returns null totals and 0 count for no ledger rows", () => {
    expect(computeRealizedSavings([])).toEqual({ monthlyCents: null, yearlyCents: null, currency: null, canceledCount: 0 });
  });

  // Distinct from the old (pre-ledger) version's own "ignores active and
  // paused subscriptions" test — there's no `status` filter to test at all
  // anymore. Every row in the ledger already represents a genuine
  // cancellation by construction (queries.ts only ever writes one on a real
  // active->canceled transition); this function no longer filters anything,
  // it only sums and currency-checks what it's given.
  it("sums monthly-equivalent cost across every ledger row, mixed billing cycles, same currency", () => {
    const result = computeRealizedSavings([
      realizedSavingsRecord({ amountCents: 1000, billingCycle: "monthly", currency: "usd" }), // 1000/mo
      realizedSavingsRecord({ amountCents: 12000, billingCycle: "yearly", currency: "usd" }), // 1000/mo
    ]);
    expect(result.monthlyCents).toBe(2000);
    expect(result.yearlyCents).toBe(24000);
    expect(result.currency).toBe("usd");
    expect(result.canceledCount).toBe(2);
  });

  // Regression: yearlyCents used to be computed as totalMonthlyCents * 12,
  // double-rounding away from a canceled yearly subscription's own stored
  // price. Two canceled $99.99/yr subscriptions must report an exact
  // $199.98/yr realized saving (19998 cents), not $199.92 (19992 cents,
  // what monthlyCents(9999,"yearly")=833 summed twice then *12 would give).
  it("reports the exact annual total for canceled yearly subscriptions, not a double-rounded one", () => {
    const result = computeRealizedSavings([
      realizedSavingsRecord({ amountCents: 9999, billingCycle: "yearly", currency: "usd" }),
      realizedSavingsRecord({ amountCents: 9999, billingCycle: "yearly", currency: "usd" }),
    ]);
    expect(result.yearlyCents).toBe(19998);
  });

  it("counts every ledger row toward canceledCount, including a $0 one", () => {
    const result = computeRealizedSavings([realizedSavingsRecord({ amountCents: 0, currency: "usd" })]);
    expect(result.canceledCount).toBe(1);
    expect(result.monthlyCents).toBe(0);
  });

  // Regression: currency is unvalidated free text on this schema (see
  // money.ts's sumMonthlyCentsIfSingleCurrency, which enforces the same
  // rule for the import-review total) — summing raw cents across different
  // currencies would produce a number wearing a real one's formatting.
  // canceledCount still reflects both (currency-independent), but no dollar
  // total is claimed.
  it("returns null totals (never a fabricated cross-currency sum) when the ledger spans more than one currency", () => {
    const result = computeRealizedSavings([
      realizedSavingsRecord({ amountCents: 1000, currency: "usd" }),
      realizedSavingsRecord({ amountCents: 1000, currency: "eur" }),
    ]);
    expect(result.monthlyCents).toBeNull();
    expect(result.yearlyCents).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.canceledCount).toBe(2);
  });

  // CodeRabbit review regression: "usd" and "USD" are the same currency —
  // a case-sensitive comparison would wrongly treat this as mixed and
  // return a null total for what's actually a single-currency case.
  it("treats differently-cased currency codes as the same currency", () => {
    const result = computeRealizedSavings([
      realizedSavingsRecord({ amountCents: 1000, currency: "usd" }),
      realizedSavingsRecord({ amountCents: 1000, currency: "USD" }),
    ]);
    expect(result.monthlyCents).toBe(2000);
    expect(result.currency).toBe("usd");
  });

  // The whole point of the ledger over the old live-scan version: this
  // function never re-derives anything from `Subscription` at all anymore —
  // it only ever reads the snapshot columns already on each row. A
  // subscription's current (possibly since-edited, or deleted-and-gone) row
  // is never consulted, so there is nothing here to mutate or delete out
  // from under this total. Nothing to actually assert on this pure function
  // beyond its own input type no longer being `Subscription[]` — the real
  // guarantee is enforced at the write side (queries.realized-savings.test.ts)
  // and the schema's own onDelete: "set null" (schema.ts).
  it("still reports a real total from a row whose subscriptionId is null (the original subscription was later deleted)", () => {
    const result = computeRealizedSavings([realizedSavingsRecord({ subscriptionId: null, amountCents: 1500 })]);
    expect(result.monthlyCents).toBe(1500);
    expect(result.canceledCount).toBe(1);
  });
});

describe("getSavingsPriority", () => {
  function rec(impactCents: number, evidenceTier: SavingsRecommendation["evidenceTier"] = "confirmed"): SavingsRecommendation {
    return {
      id: "r1",
      type: evidenceTier === "confirmed" ? "duplicate" : "functional_overlap",
      title: "t",
      description: "d",
      actionLabel: "Review",
      monthlySavingsCents: evidenceTier === "confirmed" ? impactCents : 0,
      annualSavingsCents: evidenceTier === "confirmed" ? impactCents * 12 : 0,
      impactCents,
      evidenceTier,
      urgencyDays: 30,
      targetSubscriptionId: "sub-1",
      involvedSubscriptionIds: ["sub-1"],
      currency: "usd",
    };
  }

  it("is 'low' for $0 impact regardless of evidence tier", () => {
    expect(getSavingsPriority(rec(0, "confirmed"))).toBe("low");
    expect(getSavingsPriority(rec(0, "review"))).toBe("low");
  });

  it("is 'medium' for a small confirmed duplicate saving", () => {
    expect(getSavingsPriority(rec(500, "confirmed"))).toBe("medium");
  });

  it("is 'high' at and above the $15/mo threshold — confirmed evidence only", () => {
    expect(getSavingsPriority(rec(1500, "confirmed"))).toBe("high");
    expect(getSavingsPriority(rec(5000, "confirmed"))).toBe("high");
  });

  it("is 'medium' just below the threshold", () => {
    expect(getSavingsPriority(rec(1499, "confirmed"))).toBe("medium");
  });

  // Regression (Phase 8): review-only findings (functional_overlap,
  // small_subscriptions) used to always bucket "low" because
  // monthlySavingsCents is always 0 for them — a $60/mo overlap and a
  // $2/mo one read identically. impactCents now lets a large review-only
  // finding earn "medium," but it must never reach "high" (that label
  // implies a cancellation would deterministically recover the money,
  // which review-only evidence never proves).
  it("a large review-only finding is 'medium', never 'high', regardless of dollar amount", () => {
    expect(getSavingsPriority(rec(1500, "review"))).toBe("medium");
    expect(getSavingsPriority(rec(50_000, "review"))).toBe("medium");
  });

  it("a small review-only finding is still 'low'", () => {
    expect(getSavingsPriority(rec(300, "review"))).toBe("low");
  });
});

describe("splitSavingsRecommendationsByPlan", () => {
  let recId = 1;
  function rec(overrides: Partial<SavingsRecommendation> = {}): SavingsRecommendation {
    return {
      id: `rec-${recId++}`,
      type: "functional_overlap",
      title: "t",
      description: "d",
      actionLabel: "Review",
      monthlySavingsCents: 0,
      annualSavingsCents: 0,
      impactCents: 1000,
      evidenceTier: "review",
      urgencyDays: 30,
      targetSubscriptionId: "sub-1",
      involvedSubscriptionIds: ["sub-1"],
      currency: "usd",
      ...overrides,
    };
  }
  function confirmed(overrides: Partial<SavingsRecommendation> = {}): SavingsRecommendation {
    return rec({ type: "duplicate", evidenceTier: "confirmed", monthlySavingsCents: 1000, annualSavingsCents: 12000, ...overrides });
  }

  it("a premium caller sees every recommendation, with nothing teased", () => {
    const all = [confirmed(), rec(), rec()];
    const result = splitSavingsRecommendationsByPlan(all, true);
    expect(result.visible).toEqual(all);
    expect(result.teased).toBeNull();
  });

  // Monetization Council ruling: confirmed duplicates are never gated,
  // anywhere, on principle — this app's duplicate-detection promise is
  // already free everywhere else, and gating it on just this one list
  // would be an inconsistency, not a real restriction.
  it("a free caller sees every confirmed recommendation, no matter how many", () => {
    const confirmedRecs = [confirmed(), confirmed(), confirmed()];
    const result = splitSavingsRecommendationsByPlan(confirmedRecs, false);
    expect(result.visible).toEqual(confirmedRecs);
    expect(result.teased).toBeNull();
  });

  it("a free caller sees exactly one review-tier recommendation in full, even with several present", () => {
    const reviewRecs = [rec(), rec(), rec()];
    const result = splitSavingsRecommendationsByPlan(reviewRecs, false);
    expect(result.visible).toEqual([reviewRecs[0]]);
    expect(result.teased).not.toBeNull();
    expect(result.teased?.count).toBe(2);
  });

  it("a free caller sees confirmed items plus one review item, with the rest honestly teased by count and dollar total", () => {
    const first = confirmed({ impactCents: 500 });
    const secondConfirmed = confirmed({ impactCents: 800 });
    const visibleReview = rec({ impactCents: 1200, currency: "usd" });
    const hiddenA = rec({ impactCents: 900, currency: "usd" });
    const hiddenB = rec({ impactCents: 300, currency: "usd" });
    const result = splitSavingsRecommendationsByPlan([first, secondConfirmed, visibleReview, hiddenA, hiddenB], false);

    expect(result.visible).toEqual([first, secondConfirmed, visibleReview]);
    expect(result.teased).toEqual({ count: 2, totalCents: 1200, currency: "usd" });
  });

  it("preserves original relative order in the visible list rather than reshuffling confirmed-before-review", () => {
    const review1 = rec({ impactCents: 100 });
    const confirmedOne = confirmed({ impactCents: 500 });
    const all = [review1, confirmedOne];
    const result = splitSavingsRecommendationsByPlan(all, false);
    expect(result.visible).toEqual([review1, confirmedOne]);
  });

  it("never fabricates a dollar total across mismatched currencies — an honest gap, not a wrong number", () => {
    const visibleReview = rec({ currency: "usd" });
    const hiddenUsd = rec({ impactCents: 500, currency: "usd" });
    const hiddenGbp = rec({ impactCents: 500, currency: "gbp" });
    const result = splitSavingsRecommendationsByPlan([visibleReview, hiddenUsd, hiddenGbp], false);

    expect(result.teased?.count).toBe(2);
    expect(result.teased?.totalCents).toBeNull();
    expect(result.teased?.currency).toBeNull();
  });

  it("returns no tease at all when there is nothing beyond what's already visible", () => {
    const result = splitSavingsRecommendationsByPlan([confirmed(), rec()], false);
    expect(result.teased).toBeNull();
  });

  it("returns no tease for an empty list", () => {
    const result = splitSavingsRecommendationsByPlan([], false);
    expect(result.visible).toEqual([]);
    expect(result.teased).toBeNull();
  });
});
