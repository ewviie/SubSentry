import { describe, it, expect } from "vitest";
import { HEALTH_RULES } from "./health";
import { sub } from "../test-fixtures";
import type { EngineContext } from "../types";
import type { SubscriptionPriceHistory } from "@/lib/db/schema";

function ctx(
  subs: ReturnType<typeof sub>[],
  priceHistoryBySubscriptionId?: Map<string, SubscriptionPriceHistory[]>,
  dismissedRecommendationIds?: Set<string>,
): EngineContext {
  return {
    subscriptions: subs,
    active: subs.filter((s) => s.status === "active"),
    todayIso: "2026-01-01",
    isPremium: false,
    priceHistoryBySubscriptionId,
    dismissedRecommendationIds,
  };
}

function historyRow(overrides: Partial<SubscriptionPriceHistory>): SubscriptionPriceHistory {
  return {
    id: overrides.id ?? "row-id",
    subscriptionId: "sub-id",
    userId: "user-1",
    amountCents: 1000,
    billingCycle: "monthly",
    currency: "usd",
    observedAt: new Date("2026-01-01T00:00:00Z"),
    source: "initial",
    ...overrides,
  };
}

function ruleById(id: string) {
  const rule = HEALTH_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`missing rule ${id}`);
  return rule;
}

describe("health.duplicates", () => {
  const rule = ruleById("health.duplicates");
  it("positive when no duplicates", () => {
    const result = rule.evaluate(ctx([sub({ name: "Netflix" })]));
    expect(result?.severity).toBe("positive");
    expect(result?.scoreImpact).toBeGreaterThan(0);
    expect(result?.dimension).toBe("redundancy");
  });
  // Final-calibration-review fix: ceiling raised 60->100 (see
  // confirmedDuplicateSeverity's own comment) — this fixture's raw value
  // (4 pairs, 80% share) is 90, no longer flattened to -60.
  it("penalizes duplicates, magnitude- and count-aware, capped at -100", () => {
    const subs = Array.from({ length: 5 }, (_, i) => sub({ name: `Netflix ${i}` }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(-90);
    expect(result?.dimension).toBe("redundancy");
  });

  // Health Score v2: magnitude-aware severity — a duplicate that's a tiny
  // share of total spend must hurt less than one that dominates it, even at
  // the same pair count.
  it("penalizes a duplicate that's a small share of total spend less than one that dominates it", () => {
    const small = rule.evaluate(
      ctx([sub({ name: "Netflix", amountCents: 999 }), sub({ name: "Netflix Premium", amountCents: 100 }), sub({ name: "Big Bill", amountCents: 9000 })]),
    );
    const large = rule.evaluate(ctx([sub({ name: "Netflix", amountCents: 999 }), sub({ name: "Netflix Premium", amountCents: 999 })]));
    expect(small?.scoreImpact).toBeLessThan(0);
    expect(large?.scoreImpact).toBeLessThan(small!.scoreImpact!);
  });

  // Health Score v2: a duplicate already surfaced on /savings and dismissed,
  // but still present today, is stronger evidence than a fresh finding —
  // real, stored data (dismissedSavingsRecommendations), not an inference.
  it("penalizes a dismissed-but-unresolved duplicate more than an identical fresh one", () => {
    const netflix = sub({ id: "keep-id", name: "Netflix" });
    const premium = sub({ id: "redundant-id", name: "Netflix Premium" });
    const fresh = rule.evaluate(ctx([netflix, premium]));
    const stale = rule.evaluate(ctx([netflix, premium], undefined, new Set([`duplicate-${netflix.id}-${premium.id}`])));
    expect(stale?.scoreImpact).toBeLessThan(fresh!.scoreImpact!);
  });
});

describe("health.functional_overlap", () => {
  const rule = ruleById("health.functional_overlap");
  it("null when nothing resolves to a shared overlap group", () => {
    // Both "software" category, but a code host and a video-call tool share
    // no functional-overlap group — category alone must not trigger this.
    expect(rule.evaluate(ctx([sub({ name: "GitHub" }), sub({ name: "Zoom" })]))).toBeNull();
  });
  it("flags a genuine functional-overlap group", () => {
    const result = rule.evaluate(ctx([sub({ name: "Spotify" }), sub({ name: "Apple Music" })]));
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("info");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.dimension).toBe("redundancy");
  });

  // Regression (CodeRabbit finding): "Netflix" and "Netflix Premium" are a
  // confirmed duplicate (health.duplicates already penalizes this pair) AND
  // both resolve to the video_streaming group — without excluding the
  // already-flagged-redundant half, the redundancy dimension double-counted
  // one piece of evidence as two separate penalties.
  it("does not also penalize a pair that health.duplicates already flagged as a confirmed duplicate", () => {
    expect(rule.evaluate(ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]))).toBeNull();
  });
});

describe("health.concentration", () => {
  const rule = ruleById("health.concentration");
  it("positive when balanced across 3+ categories", () => {
    const result = rule.evaluate(
      ctx([sub({ category: "streaming" }), sub({ category: "fitness" }), sub({ category: "software" })]),
    );
    expect(result?.severity).toBe("positive");
    expect(result?.dimension).toBe("spending");
  });
  it("flags 40%+ concentration", () => {
    const result = rule.evaluate(
      ctx([sub({ category: "streaming", amountCents: 8000 }), sub({ category: "fitness", amountCents: 2000 })]),
    );
    expect(result?.scoreImpact).toBe(-16);
    expect(result?.dimension).toBe("spending");
  });

  // Regression (local-council review, Devil's Advocate lens): a category
  // whose sole contributor is also a real cost outlier used to be
  // penalized twice for one fact — once here, once by
  // health.expensive_outliers. The outliers rule already covers this case
  // with the more specific framing, so concentration now stays silent
  // when its dominant category has exactly one, already-outlier member.
  it("does not also flag concentration when the dominant category's sole member is already an expensive outlier", () => {
    const result = rule.evaluate(
      ctx([sub({ category: "streaming", amountCents: 8000 }), sub({ category: "fitness", amountCents: 1000 }), sub({ category: "software", amountCents: 1000 })]),
    );
    expect(result).toBeNull();
  });

  // But a dominant category with 2+ real contributors is still genuine,
  // independent evidence — never suppressed just because one of its
  // members happens to also be pricier than average.
  it("still flags concentration when the dominant category has 2+ contributors, even if one is pricier", () => {
    const result = rule.evaluate(
      ctx([
        sub({ category: "streaming", amountCents: 4000 }),
        sub({ category: "streaming", amountCents: 4000 }),
        sub({ category: "fitness", amountCents: 1000 }),
        sub({ category: "software", amountCents: 1000 }),
      ]),
    );
    expect(result).not.toBeNull();
    expect(result?.scoreImpact).toBeLessThan(0);
  });
});

describe("health.expensive_outliers", () => {
  const rule = ruleById("health.expensive_outliers");
  it("positive (not null) when nothing is an outlier, given 2+ subscriptions to compare", () => {
    const result = rule.evaluate(ctx([sub({ amountCents: 1000 }), sub({ amountCents: 1000 })]));
    expect(result?.severity).toBe("positive");
    expect(result?.dimension).toBe("spending");
  });
  it("null with fewer than 2 subscriptions — nothing to compare against", () => {
    expect(rule.evaluate(ctx([sub({ amountCents: 1000 })]))).toBeNull();
  });
  it("negative when a real outlier exists", () => {
    const result = rule.evaluate(ctx([sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 10000 })]));
    expect(result?.scoreImpact).toBeLessThan(0);
  });

  // Health Score v2 adversarial-audit fix: magnitude-aware, not just
  // count-aware — a single subscription that's barely 2x the mean and one
  // that dominates nearly the entire portfolio's spend must not score
  // identically. Both fixtures have exactly 1 outlier (same count), so any
  // difference in scoreImpact is attributable to the magnitude factor.
  it("penalizes a portfolio-dominating outlier more than a barely-qualifying one", () => {
    // 6 items in both fixtures so the comparison isolates magnitude, not
    // count: 5 baseline subs + 1 outlier. Barely-qualifying: outlier's
    // share of total (2510/7510 ≈ 33%) stays under the 40% floor where
    // expensiveOutlierMagnitudeFactor starts scaling, so this fixture's
    // penalty is the original, unscaled -16. Dominating: outlier's share
    // (9700/10200 ≈ 95%) is deep into the scaled range, capped at 2x.
    const barelyQualifying = rule.evaluate(
      ctx([sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 2510 })]),
    );
    const dominating = rule.evaluate(
      ctx([sub({ amountCents: 100 }), sub({ amountCents: 100 }), sub({ amountCents: 100 }), sub({ amountCents: 100 }), sub({ amountCents: 100 }), sub({ amountCents: 9700 })]),
    );
    expect(barelyQualifying?.scoreImpact).toBe(-16);
    expect(dominating?.scoreImpact).toBeLessThan(barelyQualifying!.scoreImpact!);
  });

  // Regression: this used to render formatCents(o.annualCents) with no
  // currency argument, so a non-USD outlier's own currency symbol was lost.
  it("labels an outlier's cost with its own currency, not a hardcoded default", () => {
    const result = rule.evaluate(
      ctx([
        sub({ name: "UK Gym", amountCents: 2000, currency: "gbp" }),
        sub({ name: "Small", amountCents: 200, currency: "gbp" }),
        sub({ name: "Big UK Sub", amountCents: 20000, currency: "gbp" }),
      ]),
    );
    expect(result?.description).toContain("£");
    expect(result?.description).not.toContain("$");
  });
});

describe("health.small_subscriptions_add_up", () => {
  const rule = ruleById("health.small_subscriptions_add_up");

  it("null for an evenly-priced portfolio — nothing is 'small' relative to the mean", () => {
    const subs = [sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 1000 }), sub({ amountCents: 1000 })];
    expect(rule.evaluate(ctx(subs))).toBeNull();
  });

  it("flags a real death-by-a-thousand-cuts pattern", () => {
    const subs = [
      sub({ name: "Dominant", amountCents: 3000 }),
      sub({ name: "Tiny1", amountCents: 300 }),
      sub({ name: "Tiny2", amountCents: 300 }),
      sub({ name: "Tiny3", amountCents: 300 }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("info");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.dimension).toBe("spending");
    expect(result?.subscriptionIds).toHaveLength(3);
  });

  // Double-counting guard: the same 3 subscriptions must never also fire
  // health.expensive_outliers — complementary evidence about the same
  // portfolio, not the same fact counted twice.
  it("does not overlap with health.expensive_outliers for the same fixture", () => {
    const subs = [
      sub({ name: "Dominant", amountCents: 3000 }),
      sub({ name: "Tiny1", amountCents: 300 }),
      sub({ name: "Tiny2", amountCents: 300 }),
      sub({ name: "Tiny3", amountCents: 300 }),
    ];
    const outliers = ruleById("health.expensive_outliers").evaluate(ctx(subs));
    const smallCluster = rule.evaluate(ctx(subs));
    expect(smallCluster).not.toBeNull();
    // Either outliers found nothing, or its flagged ids share no overlap
    // with the small cluster's flagged ids.
    if (outliers?.subscriptionIds) {
      const overlap = outliers.subscriptionIds.filter((id) => smallCluster!.subscriptionIds.includes(id));
      expect(overlap).toHaveLength(0);
    }
  });
});

describe("health.uncategorized_imports", () => {
  const rule = ruleById("health.uncategorized_imports");

  it("null with no imported subscriptions at all (nothing to be positive or negative about)", () => {
    expect(rule.evaluate(ctx([sub({ source: "manual", category: "other" })]))).toBeNull();
  });

  it("positive when every imported subscription is categorized", () => {
    const result = rule.evaluate(ctx([sub({ source: "csv_import", category: "streaming" })]));
    expect(result?.severity).toBe("positive");
    expect(result?.dimension).toBe("hygiene");
  });

  it("does not flag a manually-entered 'Other' category — a deliberate user choice, not a data gap", () => {
    const result = rule.evaluate(ctx([sub({ source: "manual", category: "other" }), sub({ source: "csv_import", category: "streaming" })]));
    expect(result?.severity).toBe("positive"); // the one import present IS categorized
  });

  it("flags an imported, unrecognized-merchant subscription filed under Other", () => {
    const result = rule.evaluate(ctx([sub({ name: "Unknown Corp", source: "csv_import", category: "other" })]));
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("info");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.dimension).toBe("hygiene");
    expect(result?.subscriptionIds).toHaveLength(1);
  });
});

describe("health.canceled_history", () => {
  const rule = ruleById("health.canceled_history");
  it("null with no canceled history", () => {
    expect(rule.evaluate(ctx([sub({ status: "active" })]))).toBeNull();
  });
  it("positive bonus scaling with canceled count, capped at 24", () => {
    // Distinct names from the active sub (and from each other) — none of
    // these canceled subscriptions should read as a reactivation of "Test
    // Sub" (the active one), which is exactly what this test is isolating:
    // count-scaling for genuinely resolved cancellations.
    const subs = [
      sub({ status: "active" }),
      ...["Aurora", "Bramble", "Cascade", "Driftwood", "Ember"].map((name) => sub({ name, status: "canceled" })),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(24);
    expect(result?.dimension).toBe("hygiene");
  });

  // Health Score v2 audit fix: a canceled subscription that's since come
  // back (same name, now active) is a reactivation, not resolved pruning —
  // health.reactivation already penalizes it from the active side, so it
  // must not also earn a positive credit here.
  it("does not credit a canceled subscription that's since been reactivated", () => {
    const subs = [sub({ name: "Netflix", status: "canceled" }), sub({ name: "Netflix", status: "active" })];
    expect(rule.evaluate(ctx(subs))).toBeNull();
  });

  it("still credits a genuinely resolved cancellation alongside an unrelated reactivation", () => {
    const subs = [
      sub({ name: "Netflix", status: "canceled" }),
      sub({ name: "Netflix", status: "active" }), // reactivated — excluded
      sub({ name: "Hulu", status: "canceled" }), // genuinely resolved — still credited
      sub({ name: "Spotify", status: "active" }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(8); // 1 genuinely-pruned subscription (Hulu) * WEAK
  });
});

describe("health.recent_growth", () => {
  const rule = ruleById("health.recent_growth");
  // Bar deliberately raised from the old model's 3+ to 5+ — see this rule's
  // own comment on why this app can't distinguish real spending growth from
  // a bulk import, and 3 is too low a bar for a signal this uncertain.
  it("does not warn at 3 new subscriptions — below the honest evidence bar", () => {
    const subs = Array.from({ length: 3 }, () => sub({ createdAt: new Date("2025-12-31T00:00:00Z") }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.severity).not.toBe("warning");
  });
  it("flags at 5+ new subscriptions in 30 days, with honest wording (never claims proven growth)", () => {
    const subs = Array.from({ length: 5 }, () => sub({ createdAt: new Date("2025-12-31T00:00:00Z") }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.severity).toBe("info");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.title.toLowerCase()).toContain("added to subsentry");
    expect(result?.title.toLowerCase()).not.toContain("growing rapidly");
    expect(result?.dimension).toBe("growth");
  });
});

describe("health.renewal_risk", () => {
  const rule = ruleById("health.renewal_risk");

  // Regression: the old model penalized any 3+ renewals landing the same
  // week regardless of dollar amount. Clustering alone is explicitly not a
  // health problem per this rewrite's brief — only a genuine, evidenced
  // cash-flow spike (upcoming 30-day total well above typical monthly
  // spend) should move the score.
  it("does not penalize a cluster far in the future — not even in the next 30 days", () => {
    const subs = [sub({ nextRenewalDate: "2099-01-01" }), sub({ nextRenewalDate: "2099-01-02" }), sub({ nextRenewalDate: "2099-01-03" })];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(0);
    expect(result?.severity).toBe("info");
  });

  it("does not penalize 3+ near-term renewals when the total is still in line with normal spend", () => {
    // All-monthly subscriptions renewing soon: upcoming 30-day cash roughly
    // equals the monthly total by construction — never a 1.5x spike.
    const subs = [
      sub({ nextRenewalDate: "2026-01-05", amountCents: 1000, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-06", amountCents: 1000, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-07", amountCents: 1000, billingCycle: "monthly" }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(0);
  });

  it("penalizes a genuine cash-flow spike — a large yearly charge landing alongside the normal monthly baseline", () => {
    const subs = [
      sub({ nextRenewalDate: "2026-01-05", amountCents: 1000, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-06", amountCents: 1000, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-07", amountCents: 20000, billingCycle: "yearly" }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result?.severity).toBe("warning");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.dimension).toBe("renewal");
  });

  // Regression: monthly/upcoming totals used to sum amountCents across ALL
  // active subscriptions regardless of currency, so a large non-primary-
  // currency renewal landing the same week could fabricate (or mask) a
  // "spike" that was never real in the account's own currency. A large GBP
  // renewal alongside a normal USD monthly baseline must not trigger a USD
  // cash-flow-spike warning.
  it("does not fabricate a cash-flow spike from a non-primary-currency renewal", () => {
    const subs = [
      sub({ nextRenewalDate: "2026-01-05", amountCents: 1000, billingCycle: "monthly", currency: "usd" }),
      sub({ nextRenewalDate: "2026-01-06", amountCents: 1000, billingCycle: "monthly", currency: "usd" }),
      // A large GBP yearly charge landing the same week — real money, but
      // not part of this account's USD baseline or USD upcoming total.
      sub({ nextRenewalDate: "2026-01-07", amountCents: 20000, billingCycle: "yearly", currency: "gbp" }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(0);
    expect(result?.severity).not.toBe("warning");
  });

  it("positive when renewals are well spread out with no cluster at all", () => {
    const subs = [
      sub({ nextRenewalDate: "2026-01-05" }),
      sub({ nextRenewalDate: "2026-03-05" }),
      sub({ nextRenewalDate: "2026-06-05" }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result?.severity).toBe("positive");
  });
});

describe("health.overdue_renewals", () => {
  const rule = ruleById("health.overdue_renewals");
  it("positive when nothing is overdue", () => {
    const result = rule.evaluate(ctx([sub({ nextRenewalDate: "2099-01-01" })]));
    expect(result?.severity).toBe("positive");
    expect(result?.dimension).toBe("hygiene");
  });
  it("warns and penalizes when an active subscription's renewal date has passed", () => {
    const overdue = sub({ name: "Netflix", nextRenewalDate: "2020-01-01" });
    const result = rule.evaluate(ctx([overdue]));
    expect(result?.severity).toBe("warning");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.subscriptionIds).toContain(overdue.id);
  });

  // Regression (CodeRabbit finding): an unbounded name-list join could
  // produce one long, unreadable comma-separated description for a user
  // with many flagged subscriptions at once — every subscriptionIds entry
  // is still included (nothing is silently dropped from the actual data),
  // only the rendered description text truncates.
  it("truncates the description's name list at 4+ overdue subscriptions, without dropping any from subscriptionIds", () => {
    const names = ["Aurora", "Bramble", "Cascade", "Driftwood", "Ember"];
    const subs = names.map((name) => sub({ name, nextRenewalDate: "2020-01-01" }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.subscriptionIds).toHaveLength(5);
    expect(result?.description).toContain("and 2 more");
    expect(result?.description).not.toContain("Ember");
  });
});

describe("health.price_increases", () => {
  const rule = ruleById("health.price_increases");

  it("null with no price-history map at all — not enough evidence to have an opinion", () => {
    expect(rule.evaluate(ctx([sub({ id: "a" })]))).toBeNull();
  });

  it("null when every active subscription has fewer than 2 recorded history rows", () => {
    const history = new Map([["a", [historyRow({ subscriptionId: "a" })]]]);
    expect(rule.evaluate(ctx([sub({ id: "a" })], history))).toBeNull();
  });

  it("positive when there's enough history but nothing increased", () => {
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const result = rule.evaluate(ctx([sub({ id: "a", amountCents: 1000 })], history));
    expect(result?.severity).toBe("positive");
    expect(result?.dimension).toBe("spending");
    expect(result?.scoreImpact).toBeGreaterThan(0);
  });

  it("warns and penalizes when an active subscription's price genuinely went up", () => {
    const netflix = sub({ id: "netflix", name: "Netflix", amountCents: 1799 });
    const history = new Map([
      [
        "netflix",
        [
          historyRow({ subscriptionId: "netflix", amountCents: 1549, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "netflix", amountCents: 1799, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const result = rule.evaluate(ctx([netflix], history));
    expect(result?.severity).toBe("warning");
    expect(result?.dimension).toBe("spending");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.subscriptionIds).toEqual(["netflix"]);
    expect(result?.description).toContain("Netflix");
    expect(result?.description).toContain("%");
  });

  it("does not flag a subscription whose price only decreased", () => {
    const history = new Map([
      [
        "a",
        [
          historyRow({ subscriptionId: "a", amountCents: 1500, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "a", amountCents: 1000, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const result = rule.evaluate(ctx([sub({ id: "a", amountCents: 1000 })], history));
    expect(result?.severity).toBe("positive");
  });

  it("only counts subscriptions with recorded history — a subscription with none is silently excluded, not treated as unchanged", () => {
    const flagged = sub({ id: "flagged", name: "Flagged", amountCents: 1800 });
    const noHistory = sub({ id: "no-history", name: "NoHistory", amountCents: 500 });
    const history = new Map([
      [
        "flagged",
        [
          historyRow({ subscriptionId: "flagged", amountCents: 1500, observedAt: new Date("2026-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "flagged", amountCents: 1800, observedAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      ],
    ]);
    const result = rule.evaluate(ctx([flagged, noHistory], history));
    expect(result?.subscriptionIds).toEqual(["flagged"]);
    expect(result?.description).not.toContain("NoHistory");
  });

  // Health Score v2: a flat, once-per-rule kicker on top of the base
  // per-increase penalty when at least one active subscription shows 2+
  // recorded changes (3+ history rows) in the trailing 12 months.
  it("adds a repeated-change kicker when a subscription has 3+ recorded price points", () => {
    const netflix = sub({ id: "netflix", name: "Netflix", amountCents: 1799 });
    const singleChangeHistory = new Map([
      [
        "netflix",
        [
          historyRow({ subscriptionId: "netflix", amountCents: 1549, observedAt: new Date("2025-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "netflix", amountCents: 1799, observedAt: new Date("2025-06-01T00:00:00Z") }),
        ],
      ],
    ]);
    const repeatedHistory = new Map([
      [
        "netflix",
        [
          historyRow({ subscriptionId: "netflix", amountCents: 1400, observedAt: new Date("2025-01-01T00:00:00Z") }),
          historyRow({ subscriptionId: "netflix", amountCents: 1549, observedAt: new Date("2025-06-01T00:00:00Z") }),
          historyRow({ subscriptionId: "netflix", amountCents: 1799, observedAt: new Date("2025-11-01T00:00:00Z") }),
        ],
      ],
    ]);
    const singleResult = rule.evaluate(ctx([netflix], singleChangeHistory));
    const repeatedResult = rule.evaluate(ctx([netflix], repeatedHistory));
    expect(repeatedResult?.scoreImpact).toBeLessThan(singleResult!.scoreImpact!);
  });

  // Final-calibration-review fix: the whole reason priceIncreaseSeverity
  // exists — a randomized calibration sweep found that once 2+
  // subscriptions had a genuine, material price increase, a portfolio
  // where EVERY subscription's price nearly doubled (+80%) scored
  // identically (-32, the old flat cap) to one where only two rose a
  // modest 30%. Builds 4-subscription portfolios where `increasedCount` of
  // them have a real, material (well above the $30/yr floor) increase of
  // `pct`, and confirms the penalty now differentiates both by count AND
  // by magnitude, up through the new -48 ceiling.
  function buildPriceIncreasePortfolio(increasedCount: number, pct: number) {
    const names = ["Netflix", "Hulu", "Spotify", "Adobe"];
    const toAmounts = [1799, 1499, 1299, 5999];
    const subs = names.map((name, i) => sub({ id: `pi${i}`, name, amountCents: toAmounts[i], createdAt: new Date("2024-01-01T00:00:00Z") }));
    const history = new Map<string, SubscriptionPriceHistory[]>();
    for (let i = 0; i < names.length; i++) {
      const to = toAmounts[i];
      const from = i < increasedCount ? Math.round(to / (1 + pct)) : to;
      history.set(`pi${i}`, [
        historyRow({ subscriptionId: `pi${i}`, amountCents: from, observedAt: new Date("2025-01-01T00:00:00Z") }),
        historyRow({ subscriptionId: `pi${i}`, amountCents: to, observedAt: new Date("2026-01-01T00:00:00Z") }),
      ]);
    }
    return { subs, history };
  }

  it("penalizes 4/4 subscriptions increasing more than 2/4, at the same magnitude", () => {
    const two = buildPriceIncreasePortfolio(2, 0.8);
    const four = buildPriceIncreasePortfolio(4, 0.8);
    const twoResult = rule.evaluate(ctx(two.subs, two.history));
    const fourResult = rule.evaluate(ctx(four.subs, four.history));
    expect(fourResult?.scoreImpact).toBeLessThan(twoResult!.scoreImpact!);
    // Neither collapses to the old flat -32 cap.
    expect(twoResult?.scoreImpact).not.toBe(-32);
    expect(fourResult?.scoreImpact).not.toBe(-32);
  });

  it("penalizes a severe (+80%) increase more than a modest (+30%) one, at the same count", () => {
    const modest = buildPriceIncreasePortfolio(4, 0.3);
    const severe = buildPriceIncreasePortfolio(4, 0.8);
    const modestResult = rule.evaluate(ctx(modest.subs, modest.history));
    const severeResult = rule.evaluate(ctx(severe.subs, severe.history));
    expect(severeResult?.scoreImpact).toBeLessThan(modestResult!.scoreImpact!);
  });

  it("never exceeds the new -48 ceiling", () => {
    const worst = buildPriceIncreasePortfolio(4, 0.8);
    const result = rule.evaluate(ctx(worst.subs, worst.history));
    expect(result?.scoreImpact).toBeGreaterThanOrEqual(-48);
  });
});

describe("health.portfolio_concentration", () => {
  const rule = ruleById("health.portfolio_concentration");

  it("null with fewer than 3 subscriptions", () => {
    expect(rule.evaluate(ctx([sub({ amountCents: 1000 }), sub({ amountCents: 1000 })]))).toBeNull();
  });

  it("null for a perfectly even split", () => {
    const subs = Array.from({ length: 4 }, () => sub({ amountCents: 1000 }));
    expect(rule.evaluate(ctx(subs))).toBeNull();
  });

  it("flags genuine imbalance from two large subscriptions, neither individually a 2x-mean outlier", () => {
    // 4 subscriptions: two large, two trivial. Mean is 2500, so the 2x-mean
    // outlier bar is 5000 — both A (4900) and B (4800) sit just under it,
    // so health.expensive_outliers has nothing to say here; the imbalance
    // is only visible at the whole-portfolio level.
    const subs = [
      sub({ name: "A", amountCents: 4900 }),
      sub({ name: "B", amountCents: 4800 }),
      sub({ name: "C", amountCents: 150 }),
      sub({ name: "D", amountCents: 150 }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result).not.toBeNull();
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.dimension).toBe("spending");
  });

  it("stays silent when its top contributor is already flagged by health.expensive_outliers — same fact, not double-counted", () => {
    const subs = [sub({ name: "Small A", amountCents: 100 }), sub({ name: "Small B", amountCents: 100 }), sub({ name: "Huge", amountCents: 10_000 })];
    expect(rule.evaluate(ctx(subs))).toBeNull();
  });
});

describe("health.reactivation", () => {
  const rule = ruleById("health.reactivation");

  it("null with no canceled history", () => {
    expect(rule.evaluate(ctx([sub({ name: "Netflix" })]))).toBeNull();
  });

  it("flags an active subscription whose name matches a previously-canceled one", () => {
    const canceled = sub({ name: "Netflix", status: "canceled" });
    const active = sub({ name: "Netflix" });
    const result = rule.evaluate(ctx([canceled, active]));
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("info");
    expect(result?.scoreImpact).toBeLessThan(0);
    expect(result?.dimension).toBe("hygiene");
    expect(result?.subscriptionIds).toEqual([active.id]);
  });

  it("does not flag an active subscription with no canceled counterpart", () => {
    const canceled = sub({ name: "Netflix", status: "canceled" });
    const active = sub({ name: "Spotify" });
    expect(rule.evaluate(ctx([canceled, active]))).toBeNull();
  });
});
