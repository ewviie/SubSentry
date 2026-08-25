import { describe, it, expect } from "vitest";
import { HEALTH_RULES } from "./health";
import { sub } from "../test-fixtures";
import type { EngineContext } from "../types";
import type { SubscriptionPriceHistory } from "@/lib/db/schema";

function ctx(
  subs: ReturnType<typeof sub>[],
  priceHistoryBySubscriptionId?: Map<string, SubscriptionPriceHistory[]>,
): EngineContext {
  return {
    subscriptions: subs,
    active: subs.filter((s) => s.status === "active"),
    todayIso: "2026-01-01",
    isPremium: false,
    priceHistoryBySubscriptionId,
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
  it("penalizes duplicates, capped at -60", () => {
    const subs = Array.from({ length: 5 }, (_, i) => sub({ name: `Netflix ${i}` }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(-60);
    expect(result?.dimension).toBe("redundancy");
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
    const subs = [sub({ status: "active" }), ...Array.from({ length: 5 }, () => sub({ status: "canceled" }))];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(24);
    expect(result?.dimension).toBe("hygiene");
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
});
