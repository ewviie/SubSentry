import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateNotificationCandidates } from "./generate";
import { computeSavingsRecommendations } from "@/lib/subscriptions/savings";
import type { Subscription, SubscriptionPriceHistory } from "@/lib/db/schema";

let nextId = 1;
function sub(overrides: Partial<Subscription> = {}): Subscription {
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

function row(overrides: Partial<SubscriptionPriceHistory>): SubscriptionPriceHistory {
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

const NOW = new Date("2026-08-31T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("generateNotificationCandidates", () => {
  it("never produces a notification for an ordinary upcoming renewal — that belongs to the calendar/digest, not a feed", () => {
    const soon = sub({ nextRenewalDate: "2026-09-03" }); // 3 days out, well within the old notify window
    const result = generateNotificationCandidates({
      subscriptions: [soon],
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: [],
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    expect(result.filter((c) => c.subscriptionId === soon.id)).toEqual([]);
  });

  it("produces a renewal_lapsed candidate once a renewal date is overdue by a real margin, with a stable dedupeKey", () => {
    const lapsed = sub({ nextRenewalDate: "2026-08-20" }); // 11 days overdue
    const barelyOverdue = sub({ id: "barely", nextRenewalDate: "2026-08-30" }); // 1 day, inside the grace window
    const result = generateNotificationCandidates({
      subscriptions: [lapsed, barelyOverdue],
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: [],
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    const renewals = result.filter((c) => c.type === "renewal_lapsed");
    expect(renewals).toHaveLength(1);
    expect(renewals[0].subscriptionId).toBe(lapsed.id);
    expect(renewals[0].dedupeKey).toContain(lapsed.id);
    expect(renewals[0].dedupeKey).toContain("2026-08-20");
  });

  it("never surfaces a lapsed-renewal notification for a paused or canceled subscription", () => {
    const paused = sub({ nextRenewalDate: "2026-08-01", status: "paused" });
    const result = generateNotificationCandidates({
      subscriptions: [paused],
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: [],
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    expect(result.some((c) => c.type === "renewal_lapsed")).toBe(false);
  });

  it("produces a price_increase candidate from a genuine increase, with the correct annual impact and a change-scoped dedupeKey", () => {
    const s = sub({ id: "adobe", name: "Adobe" });
    const history = new Map([
      [
        "adobe",
        [
          row({ subscriptionId: "adobe", amountCents: 1999, observedAt: new Date("2026-01-01") }),
          row({ subscriptionId: "adobe", amountCents: 2299, observedAt: new Date("2026-06-01") }),
        ],
      ],
    ]);
    const result = generateNotificationCandidates({
      subscriptions: [s],
      priceHistoryBySubscriptionId: history,
      savingsRecommendations: [],
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    const increase = result.find((c) => c.type === "price_increase");
    expect(increase).toBeDefined();
    expect(increase!.severity).toBe("warning");
    expect(increase!.impactCents).toBe(300 * 12); // $3.00/mo more * 12
    expect(increase!.dedupeKey).toContain("adobe");
    expect(increase!.dedupeKey).toContain("2026-06-01");
  });

  it("does not produce a price_increase candidate for a decrease or an unchanged price", () => {
    const decreased = sub({ id: "d" });
    const unchanged = sub({ id: "u" });
    const history = new Map([
      ["d", [row({ subscriptionId: "d", amountCents: 2000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "d", amountCents: 1000, observedAt: new Date("2026-06-01") })]],
      ["u", [row({ subscriptionId: "u", amountCents: 1000, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "u", amountCents: 1000, observedAt: new Date("2026-06-01") })]],
    ]);
    const result = generateNotificationCandidates({
      subscriptions: [decreased, unchanged],
      priceHistoryBySubscriptionId: history,
      savingsRecommendations: [],
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    expect(result.some((c) => c.type === "price_increase")).toBe(false);
  });

  it("produces a stale_subscription candidate for a long-unreviewed active subscription", () => {
    const s = sub({ name: "Forgotten Gym", lastReviewedAt: null, createdAt: new Date("2026-01-01") });
    const result = generateNotificationCandidates({
      subscriptions: [s],
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: [],
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    const stale = result.find((c) => c.type === "stale_subscription");
    expect(stale).toBeDefined();
    expect(stale!.subscriptionId).toBe(s.id);
  });

  it("derives duplicate_subscription and savings_opportunity candidates from the caller's own savingsRecommendations, never recomputing detection", () => {
    const netflix = sub({ id: "n1", name: "Netflix", amountCents: 500, nextRenewalDate: "2026-01-01" });
    const netflixDup = sub({ id: "n2", name: "Netflix", amountCents: 500, nextRenewalDate: "2026-02-01" });
    const recommendations = computeSavingsRecommendations([netflix, netflixDup], "2026-08-31");
    const result = generateNotificationCandidates({
      subscriptions: [netflix, netflixDup],
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: recommendations,
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    const dup = result.find((c) => c.type === "duplicate_subscription");
    expect(dup).toBeDefined();
    expect(dup!.dedupeKey).toBe(`duplicate_subscription:${recommendations[0].id}`);
  });

  it("never double-notifies a stale finding as both stale_subscription and savings_opportunity", () => {
    const s = sub({ name: "Old Thing", lastReviewedAt: null, createdAt: new Date("2026-01-01") });
    const recommendations = computeSavingsRecommendations([s], "2026-08-31");
    expect(recommendations.some((r) => r.type === "stale")).toBe(true); // sanity: savings.ts really did flag it
    const result = generateNotificationCandidates({
      subscriptions: [s],
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: recommendations,
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    expect(result.filter((c) => c.subscriptionId === s.id)).toHaveLength(1); // stale_subscription only, not savings_opportunity too
    expect(result[0].type).toBe("stale_subscription");
  });

  it("never leaks more than the single free-visible savings_opportunity finding to a non-premium caller", () => {
    // Two independent functional-overlap-style findings: enough small,
    // similarly-priced subscriptions to trigger findSmallSubscriptionsCluster
    // twice over via two disjoint clusters is awkward to construct directly,
    // so this drives the same code path through two genuine functional-
    // overlap groups instead (curated merchant pairs from merchant-normalizer.ts).
    const subs = [
      sub({ id: "netflix", name: "Netflix", amountCents: 1550 }),
      sub({ id: "disney", name: "Disney Plus", amountCents: 1399 }),
      sub({ id: "nordvpn", name: "NordVPN", amountCents: 1299 }),
      sub({ id: "expressvpn", name: "ExpressVPN", amountCents: 1299 }),
    ];
    const recommendations = computeSavingsRecommendations(subs, "2026-08-31");
    const overlapFindings = recommendations.filter((r) => r.type === "functional_overlap");
    expect(overlapFindings.length).toBeGreaterThanOrEqual(2); // sanity: two real, independent findings exist

    const freeResult = generateNotificationCandidates({
      subscriptions: subs,
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: recommendations,
      today: "2026-08-31",
      isPremium: false,
      dismissedRecommendationIds: new Set(),
    });
    const freeOpportunities = freeResult.filter((c) => c.type === "savings_opportunity");
    expect(freeOpportunities.length).toBeLessThanOrEqual(1);

    const premiumResult = generateNotificationCandidates({
      subscriptions: subs,
      priceHistoryBySubscriptionId: new Map(),
      savingsRecommendations: recommendations,
      today: "2026-08-31",
      isPremium: true,
      dismissedRecommendationIds: new Set(),
    });
    const premiumOpportunities = premiumResult.filter((c) => c.type === "savings_opportunity");
    expect(premiumOpportunities.length).toBeGreaterThan(freeOpportunities.length);
  });

  it("returns nothing for an empty portfolio", () => {
    expect(
      generateNotificationCandidates({
        subscriptions: [],
        priceHistoryBySubscriptionId: new Map(),
        savingsRecommendations: [],
        today: "2026-08-31",
        isPremium: true,
        dismissedRecommendationIds: new Set(),
      }),
    ).toEqual([]);
  });

  describe("dismissal-awareness (watchdog phase)", () => {
    it("never re-surfaces a duplicate finding whose recommendation id has been dismissed", () => {
      const netflix = sub({ id: "n1", name: "Netflix", amountCents: 500, nextRenewalDate: "2026-01-01" });
      const netflixDup = sub({ id: "n2", name: "Netflix", amountCents: 500, nextRenewalDate: "2026-02-01" });
      const recommendations = computeSavingsRecommendations([netflix, netflixDup], "2026-08-31");
      const dupRec = recommendations.find((r) => r.type === "duplicate")!;

      const result = generateNotificationCandidates({
        subscriptions: [netflix, netflixDup],
        priceHistoryBySubscriptionId: new Map(),
        savingsRecommendations: recommendations,
        today: "2026-08-31",
        isPremium: true,
        dismissedRecommendationIds: new Set([dupRec.id]),
      });
      expect(result.some((c) => c.type === "duplicate_subscription")).toBe(false);
    });

    it("does NOT apply savings-recommendation dismissal to stale_subscription — that would permanently hide a recurring, genuinely-new finding", () => {
      const s = sub({ name: "Old Thing", lastReviewedAt: null, createdAt: new Date("2026-01-01") });
      const recommendations = computeSavingsRecommendations([s], "2026-08-31");
      const staleRec = recommendations.find((r) => r.type === "stale")!;

      const result = generateNotificationCandidates({
        subscriptions: [s],
        priceHistoryBySubscriptionId: new Map(),
        savingsRecommendations: recommendations,
        today: "2026-08-31",
        isPremium: true,
        // Dismissing the savings.ts "stale" recommendation id must not
        // suppress the stale_subscription notification forever — staleness
        // recurs on a timer (see generate.ts's own comment).
        dismissedRecommendationIds: new Set([staleRec.id]),
      });
      expect(result.some((c) => c.type === "stale_subscription")).toBe(true);
    });
  });

  describe("already-reviewed price increases (watchdog phase)", () => {
    it("inserts a price_increase candidate already-read when the subscription was reviewed after the change", () => {
      const reviewedAfter = new Date("2026-07-01T00:00:00Z"); // after the 2026-06-01 change below
      const s = sub({ id: "reviewed", lastReviewedAt: reviewedAfter });
      const history = new Map([
        [
          "reviewed",
          [
            row({ subscriptionId: "reviewed", amountCents: 1999, observedAt: new Date("2026-01-01") }),
            row({ subscriptionId: "reviewed", amountCents: 2299, observedAt: new Date("2026-06-01") }),
          ],
        ],
      ]);
      const result = generateNotificationCandidates({
        subscriptions: [s],
        priceHistoryBySubscriptionId: history,
        savingsRecommendations: [],
        today: "2026-08-31",
        isPremium: true,
        dismissedRecommendationIds: new Set(),
      });
      const increase = result.find((c) => c.type === "price_increase")!;
      expect(increase).toBeDefined();
      expect(increase.readAt).not.toBeNull();
    });

    it("leaves a price_increase candidate unread when the subscription was never reviewed, or reviewed before the change", () => {
      const reviewedBefore = new Date("2026-02-01T00:00:00Z"); // before the 2026-06-01 change below
      const s = sub({ id: "before", lastReviewedAt: reviewedBefore });
      const neverReviewed = sub({ id: "never", lastReviewedAt: null });
      const history = new Map([
        ["before", [row({ subscriptionId: "before", amountCents: 1999, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "before", amountCents: 2299, observedAt: new Date("2026-06-01") })]],
        ["never", [row({ subscriptionId: "never", amountCents: 1999, observedAt: new Date("2026-01-01") }), row({ subscriptionId: "never", amountCents: 2299, observedAt: new Date("2026-06-01") })]],
      ]);
      const result = generateNotificationCandidates({
        subscriptions: [s, neverReviewed],
        priceHistoryBySubscriptionId: history,
        savingsRecommendations: [],
        today: "2026-08-31",
        isPremium: true,
        dismissedRecommendationIds: new Set(),
      });
      const increases = result.filter((c) => c.type === "price_increase");
      expect(increases).toHaveLength(2);
      expect(increases.every((c) => !c.readAt)).toBe(true);
    });
  });
});
