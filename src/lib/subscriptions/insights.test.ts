import { describe, it, expect } from "vitest";
import {
  computeInsights,
  computePotentialSavingsMonthlyCents,
  computeFunctionalOverlapGroups,
  findSmallSubscriptionsCluster,
  smallSubscriptionsClusterTitle,
} from "./insights";
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

  it("combines multiple overdue renewals into one card instead of one per subscription", () => {
    const appleMusic = sub({ name: "Apple Music", category: "streaming", nextRenewalDate: "2020-01-01" });
    const spotify = sub({ name: "Spotify", category: "software", nextRenewalDate: "2020-01-05" });
    const insights = computeInsights([appleMusic, spotify]);
    const overdueInsights = insights.filter((i) => i.type === "overdue_renewal");
    expect(overdueInsights).toHaveLength(1);
    expect(overdueInsights[0].title).toBe("2 subscriptions have overdue renewals");
    expect(overdueInsights[0].subscriptionIds).toEqual([appleMusic.id, spotify.id]);
    expect(overdueInsights[0].description).toContain("Apple Music");
    expect(overdueInsights[0].description).toContain("Spotify");
  });

  it("flags a dominant category once it crosses the 40% share threshold", () => {
    const subs = [
      sub({ category: "streaming", amountCents: 5000, name: "Big Streaming" }),
      sub({ category: "software", amountCents: 1000, name: "Small Tool" }),
    ];
    const insights = computeInsights(subs);
    expect(insights.some((i) => i.type === "expensive_category")).toBe(true);
  });

  // Regression, reproducing an exact real-account bug found via live
  // browser verification: monthlyTotal/category cents used to sum across
  // ALL active subscriptions regardless of currency, so a single GBP
  // subscription (£25.00/mo) mixed into a USD total read as "Fitness makes
  // up 44% of your monthly spend ($25.00/mo)" — a dollar sign on a pound
  // amount, and a % computed against a fabricated mixed-currency total.
  // The category-concentration insight must exclude it entirely (2 USD
  // subscriptions alone don't clear the 40% share threshold either).
  it("excludes a non-primary-currency subscription from the expensive-category share", () => {
    const subs = [
      sub({ category: "streaming", amountCents: 1549, currency: "usd" }), // Netflix
      sub({ category: "software", amountCents: 800, currency: "usd" }), // Notion
      sub({ category: "fitness", amountCents: 2500, currency: "gbp" }), // UK Gym
    ];
    const insights = computeInsights(subs);
    const category = insights.find((i) => i.type === "expensive_category");
    // Streaming (Netflix, USD) legitimately dominates the USD-only total —
    // fitness (the GBP subscription) must never win this comparison or
    // appear in its dollar figure, even though it's the single biggest line
    // item by raw cents.
    expect(category?.title).toBe("Streaming is your biggest expense");
    expect(category?.description).toContain("$15.49/mo");
    expect(category?.description).not.toContain("$25.00");
    expect(category?.description).not.toContain("Fitness");
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

  // Regression: the dollar figure in this insight's own text used to be
  // computed as monthlyCents(...) * 12, double-rounding a yearly
  // subscription's annual cost away from its own stored price. A $99.99/yr
  // outlier must say "$99.99/year", never "$99.96/year".
  it("reports a yearly outlier's exact stored price in its description, not a double-rounded one", () => {
    const outlier = sub({ name: "Big Ticket", billingCycle: "yearly", amountCents: 9999 });
    const subs = [
      outlier,
      sub({ name: "Small A", amountCents: 100 }),
      sub({ name: "Small B", amountCents: 100 }),
    ];
    const insight = computeInsights(subs).find(
      (i) => i.type === "high_yearly_spend" && i.subscriptionIds.includes(outlier.id),
    );
    expect(insight?.description).toContain("$99.99/year");
    expect(insight?.description).not.toContain("$99.96/year");
  });

  // Regression: meanAnnual used to be computed across ALL active
  // subscriptions regardless of currency, so a large non-primary-currency
  // subscription could distort (or be wrongly judged against) a mean
  // blended from a different currency.
  it("computes the outlier mean only within the primary currency", () => {
    const outlier = sub({ name: "Big Ticket", amountCents: 10000, billingCycle: "monthly", currency: "usd" });
    const subs = [
      outlier,
      sub({ name: "Small A", amountCents: 500, currency: "usd" }),
      sub({ name: "Small B", amountCents: 500, currency: "usd" }),
      sub({ name: "Huge GBP", amountCents: 999999, billingCycle: "monthly", currency: "gbp" }), // must not raise the mean
    ];
    const insight = computeInsights(subs).find(
      (i) => i.type === "high_yearly_spend" && i.subscriptionIds.includes(outlier.id),
    );
    expect(insight).toBeDefined();
    expect(insight?.description).toContain("$1,200.00/year");
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

  // Regression: this duplicate-savings figure used to render with
  // formatCents(savings) — no currency argument, defaulting to USD — so a
  // GBP duplicate's savings text showed a "$" sign on a pound amount.
  it("labels a duplicate's savings with its own currency, not a hardcoded default", () => {
    const a = sub({ name: "UK Gym", currency: "gbp", amountCents: 2000 });
    const b = sub({ name: "UK Gym Plus", currency: "gbp", amountCents: 2500 });
    const insights = computeInsights([a, b]);
    const overlap = insights.find((i) => i.type === "possible_overlap" && i.title.includes("duplicate"));
    expect(overlap?.description).toContain("£25.00");
    expect(overlap?.description).not.toContain("$25.00");
  });

  it("does not flag unrelated names as duplicates", () => {
    const insights = computeInsights([sub({ name: "Netflix" }), sub({ name: "Spotify" })]);
    expect(insights.some((i) => i.type === "possible_overlap" && i.title.includes("duplicate"))).toBe(false);
  });

  it("flags a genuine functional-overlap group (not just shared category) as possible overlap", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming" }),
      sub({ name: "Disney+", category: "streaming" }),
    ];
    const insights = computeInsights(subs);
    expect(
      insights.some((i) => i.type === "possible_overlap" && i.description.toLowerCase().includes("video streaming")),
    ).toBe(true);
  });

  // Regression: raw category equality used to be sufficient to flag
  // "possible overlap" ("N active software subscriptions") even when the
  // subscriptions share nothing but a broad category — GitHub (code
  // hosting) and Zoom (video calls) are both "software" but solve
  // completely different problems.
  it("does not flag two subscriptions sharing only a broad category with no genuine functional overlap", () => {
    const subs = [sub({ name: "GitHub", category: "software" }), sub({ name: "Zoom", category: "software" })];
    const insights = computeInsights(subs);
    expect(insights.some((i) => i.type === "possible_overlap")).toBe(false);
  });

  // Regression (CodeRabbit finding): "Netflix" and "Netflix Premium" match
  // as a confirmed duplicate (near-identical name) AND both resolve to the
  // same video_streaming merchant group — without the exclusion, this used
  // to produce TWO possible_overlap insights for the exact same pair (one
  // "duplicate", one "functional overlap"), a confusing double-signal for
  // one piece of evidence.
  it("does not double-flag a confirmed duplicate pair as a separate functional overlap", () => {
    const subs = [sub({ name: "Netflix", category: "streaming" }), sub({ name: "Netflix Premium", category: "streaming" })];
    const insights = computeInsights(subs);
    const overlapInsights = insights.filter((i) => i.type === "possible_overlap");
    expect(overlapInsights).toHaveLength(1);
    expect(overlapInsights[0].description.toLowerCase()).toContain("same service");
  });

  it("still surfaces a genuine third-service overlap alongside a duplicate pair", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming" }),
      sub({ name: "Netflix Premium", category: "streaming" }),
      sub({ name: "Disney+", category: "streaming" }),
    ];
    const insights = computeInsights(subs);
    const overlapInsights = insights.filter((i) => i.type === "possible_overlap");
    // One for the Netflix/Netflix Premium duplicate, one for Netflix +
    // Disney+ genuinely being distinct competing services.
    expect(overlapInsights).toHaveLength(2);
    expect(overlapInsights.some((i) => i.description.toLowerCase().includes("video streaming"))).toBe(true);
  });
});

describe("computePotentialSavingsMonthlyCents", () => {
  it("returns 0 when there are no duplicate insights", () => {
    const insights = computeInsights([sub({ name: "Netflix" }), sub({ name: "Spotify" })]);
    expect(computePotentialSavingsMonthlyCents(insights)).toBe(0);
  });

  it("sums the redundant subscription's cost for a flagged duplicate", () => {
    const a = sub({ name: "Netflix", amountCents: 1599 });
    const b = sub({ name: "Netflix Premium", amountCents: 999 });
    const insights = computeInsights([a, b]);
    expect(computePotentialSavingsMonthlyCents(insights)).toBe(999);
  });

  it("does not double-count a subscription flagged as redundant in more than one pair", () => {
    // Three near-identical names: a~b, a~c, and b~c all match, so the
    // O(n^2) loop produces multiple insights that could double-count b's
    // and c's cost if not deduplicated by subscription id.
    const a = sub({ name: "Netflix", amountCents: 1000 });
    const b = sub({ name: "Netflix ", amountCents: 900 });
    const c = sub({ name: "netflix", amountCents: 800 });
    const insights = computeInsights([a, b, c]);
    const total = computePotentialSavingsMonthlyCents(insights);
    // b and c are each counted exactly once (never a, never twice) — a
    // range assertion here would silently accept undercounting (e.g. 800
    // alone) as a false pass, so assert the exact expected total.
    expect(total).toBe(900 + 800);
  });

  it("never counts the same-category informational insight as savings", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming", amountCents: 1000 }),
      sub({ name: "Disney+", category: "streaming", amountCents: 1000 }),
    ];
    const insights = computeInsights(subs);
    expect(computePotentialSavingsMonthlyCents(insights)).toBe(0);
  });
});

// computeHealthScore moved to src/lib/insights-engine/health-score.test.ts,
// covering the new weighted rule-based scorer.

describe("findSmallSubscriptionsCluster", () => {
  it("null with fewer than 4 active subscriptions", () => {
    const subs = [
      sub({ name: "A", amountCents: 5000 }),
      sub({ name: "B", amountCents: 100 }),
      sub({ name: "C", amountCents: 100 }),
    ];
    expect(findSmallSubscriptionsCluster(subs)).toBeNull();
  });

  // Regression: an evenly-priced portfolio must never trigger this — the
  // "small" bar is relative to the account's own mean, so nothing here can
  // even qualify as small in the first place.
  it("null when every subscription costs about the same (nothing is 'small' relative to the mean)", () => {
    const subs = [
      sub({ name: "A", amountCents: 1000 }),
      sub({ name: "B", amountCents: 1000 }),
      sub({ name: "C", amountCents: 1000 }),
      sub({ name: "D", amountCents: 1000 }),
    ];
    expect(findSmallSubscriptionsCluster(subs)).toBeNull();
  });

  it("null when fewer than 3 subscriptions qualify as small", () => {
    const subs = [
      sub({ name: "Big1", amountCents: 5000 }),
      sub({ name: "Big2", amountCents: 5000 }),
      sub({ name: "Big3", amountCents: 5000 }),
      sub({ name: "Small", amountCents: 100 }),
    ];
    // total = 15100, mean = 3775, half-mean = 1887.5 -> Small (100)
    // qualifies as "small", but it's alone — the 3-subscription count
    // floor isn't met, regardless of what its share would have been.
    expect(findSmallSubscriptionsCluster(subs)).toBeNull();
  });

  // A weaker version of this fixture (Dominant=8000 instead of 3000) drops
  // the small trio's share to ~10%, below the 20% floor, and correctly
  // returns null — the amount below is deliberately tuned to clear it.
  it("flags 3+ small subscriptions whose combined cost is a material share of spend", () => {
    const subs = [
      sub({ name: "Dominant", amountCents: 3000 }),
      sub({ name: "Tiny1", amountCents: 300 }),
      sub({ name: "Tiny2", amountCents: 300 }),
      sub({ name: "Tiny3", amountCents: 300 }),
    ];
    // total=3900, mean=975, half-mean=487.5 -> all 3 Tiny ones qualify.
    // combined=900, share=900/3900≈23% — clears the 20% floor.
    const result = findSmallSubscriptionsCluster(subs);
    expect(result).not.toBeNull();
    expect(result!.subscriptions).toHaveLength(3);
    expect(result!.subscriptions.every((s) => s.name.startsWith("Tiny"))).toBe(true);
    expect(result!.combinedMonthlyCents).toBe(900);
    expect(result!.shareOfTotal).toBeCloseTo(900 / 3900, 5);
  });

  it("null when small subscriptions add up to too small a share of total spend", () => {
    const subs = [
      sub({ name: "Dominant", amountCents: 8000 }),
      sub({ name: "Tiny1", amountCents: 300 }),
      sub({ name: "Tiny2", amountCents: 300 }),
      sub({ name: "Tiny3", amountCents: 300 }),
    ];
    // total=8900, share=900/8900≈10.1% — below the 20% floor.
    expect(findSmallSubscriptionsCluster(subs)).toBeNull();
  });

  // Double-counting guard: a subscription flagged here must never also be
  // eligible for health.expensive_outliers — "small" (<=50% of mean) and
  // "outlier" (>=200% of mean) can never overlap for the same subscription
  // by construction, but this proves it holds for the actual boundary math
  // rather than just asserting it in a comment.
  it("never includes a subscription that could also qualify as an expensive outlier", () => {
    const subs2 = [
      sub({ name: "Dominant", amountCents: 3000 }),
      sub({ name: "Tiny1", amountCents: 300 }),
      sub({ name: "Tiny2", amountCents: 300 }),
      sub({ name: "Tiny3", amountCents: 300 }),
    ];
    const total = 3000 + 300 * 3;
    const mean = total / 4;
    const result = findSmallSubscriptionsCluster(subs2)!;
    for (const s of result.subscriptions) {
      expect(s.amountCents).toBeLessThanOrEqual(mean * 2); // never an outlier-magnitude cost
    }
  });

  // CodeRabbit review regression: currency is unvalidated free text on this
  // schema — a mixed-currency active list must never sum raw cents across
  // currencies (the exact rule computeRealizedSavings already enforces
  // elsewhere). Bails out entirely rather than silently compute a
  // meaningless mean/total.
  it("null when active subscriptions span more than one currency", () => {
    const subs = [
      sub({ name: "Dominant", amountCents: 3000, currency: "usd" }),
      sub({ name: "Tiny1", amountCents: 300, currency: "usd" }),
      sub({ name: "Tiny2", amountCents: 300, currency: "usd" }),
      sub({ name: "Tiny3", amountCents: 300, currency: "gbp" }),
    ];
    expect(findSmallSubscriptionsCluster(subs)).toBeNull();
  });
});

describe("computeFunctionalOverlapGroups", () => {
  it("returns the group's currency, matching every member's own currency", () => {
    const subs = [sub({ name: "Netflix", currency: "usd" }), sub({ name: "Disney+", currency: "usd" })];
    const groups = computeFunctionalOverlapGroups(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0].currency).toBe("usd");
    expect(groups[0].combinedMonthlyCents).toBe(1998);
  });

  // CodeRabbit review regression: a currency-mismatched subscription must
  // not corrupt the group's combinedMonthlyCents — it simply doesn't join.
  it("excludes a currency-mismatched subscription from an otherwise-matching group", () => {
    const subs = [
      sub({ name: "Netflix", currency: "usd", amountCents: 1000 }),
      sub({ name: "Disney+", currency: "usd", amountCents: 1000 }),
      sub({ name: "Hulu", currency: "gbp", amountCents: 999 }),
    ];
    const groups = computeFunctionalOverlapGroups(subs);
    expect(groups).toHaveLength(1);
    expect(groups[0].subscriptions.map((s) => s.name).sort()).toEqual(["Disney+", "Netflix"]);
    expect(groups[0].combinedMonthlyCents).toBe(2000);
  });

  // A currency-mismatched pair with no other same-currency member to join
  // never forms a group at all — honest silence, not a fabricated
  // single-currency group out of a mismatched pair.
  it("never forms a 2-member group across two different currencies", () => {
    const subs = [sub({ name: "Netflix", currency: "usd" }), sub({ name: "Disney+", currency: "gbp" })];
    expect(computeFunctionalOverlapGroups(subs)).toEqual([]);
  });
});

// Regression (local-council review, Simplicity lens): health.ts and
// savings.ts used to each carry their own byte-for-byte-identical copy of
// this title string, and the description one line below had already
// silently drifted between the two. A shared formatter makes that specific
// drift impossible — both callers render the exact same title.
describe("smallSubscriptionsClusterTitle", () => {
  it("formats the count and combined monthly cost", () => {
    const cluster = findSmallSubscriptionsCluster([
      sub({ name: "Dominant", amountCents: 3000 }),
      sub({ name: "Tiny1", amountCents: 300 }),
      sub({ name: "Tiny2", amountCents: 300 }),
      sub({ name: "Tiny3", amountCents: 300 }),
    ])!;
    expect(smallSubscriptionsClusterTitle(cluster)).toBe("3 smaller subscriptions add up to $9.00/mo");
  });
});
