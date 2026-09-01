import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { computeWeeklyDigestSummary, computeMonthlyTotal, isDigestWorthSending } from "./digest";
import type { Subscription, SubscriptionPriceHistory, Notification } from "@/lib/db/schema";

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

let nextNotifId = 1;
function notif(overrides: Partial<Notification> = {}): Notification {
  return {
    id: `notif-${nextNotifId++}`,
    userId: "user-1",
    type: "price_increase",
    title: "Test notification",
    body: "Test body",
    severity: "info",
    impactCents: null,
    currency: null,
    subscriptionId: null,
    actionHref: null,
    dedupeKey: `dedupe-${nextNotifId}`,
    readAt: null,
    createdAt: new Date(),
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

describe("computeWeeklyDigestSummary", () => {
  it("summarizes spend, upcoming renewals, creeping cost, and new-notification counts from real data", () => {
    const priceIncreased = sub({ id: "adobe", name: "Adobe", amountCents: 2299 });
    const renewingSoon = sub({ id: "soon", name: "Renewing Soon", nextRenewalDate: "2026-09-02" });

    const history = new Map([
      [
        "adobe",
        [
          row({ subscriptionId: "adobe", amountCents: 1999, observedAt: new Date("2026-01-01") }),
          row({ subscriptionId: "adobe", amountCents: 2299, observedAt: new Date("2026-06-01") }),
        ],
      ],
    ]);
    const newNotifications = [
      notif({ type: "price_increase", subscriptionId: "adobe", severity: "warning", impactCents: 3600 }),
      notif({ type: "savings_opportunity", severity: "info", impactCents: 500 }),
    ];

    const summary = computeWeeklyDigestSummary([priceIncreased, renewingSoon], history, newNotifications, NOW);

    expect(summary.monthlyCents).toBeGreaterThan(0);
    expect(summary.currency).toBe("usd");
    expect(summary.upcomingRenewalsCount).toBe(1);
    expect(summary.upcomingRenewalsCents).toBe(renewingSoon.amountCents);
    expect(summary.creepingCostAnnualDeltaCents).toBeGreaterThan(0);
    expect(summary.newNotificationCounts.price_increase).toBe(1);
    expect(summary.newNotificationCounts.savings_opportunity).toBe(1);
    expect(summary.totalNewNotifications).toBe(2);
    // Highest severity (warning) wins the top-priority slot over the info one.
    expect(summary.topPriorityNotification?.title).toBe(newNotifications[0].title);
  });

  it("returns all-zero, null-safe fields for an empty portfolio with no new notifications", () => {
    const summary = computeWeeklyDigestSummary([], new Map(), [], NOW);
    expect(summary.monthlyCents).toBe(0);
    expect(summary.upcomingRenewalsCount).toBe(0);
    expect(summary.upcomingRenewalsCents).toBe(0);
    expect(summary.creepingCostAnnualDeltaCents).toBeNull();
    expect(summary.totalNewNotifications).toBe(0);
    expect(summary.topPriorityNotification).toBeNull();
  });

  it("upcomingRenewalsCents sums only the primary-currency renewals, never mixing currencies", () => {
    const usdMajority = [
      sub({ amountCents: 1000, currency: "usd", nextRenewalDate: "2026-09-02" }),
      sub({ amountCents: 2000, currency: "usd", nextRenewalDate: "2026-09-03" }),
      // A third usd sub, not renewing soon, so it counts toward `currency`
      // (the majority) but must NOT be added to the renewal total.
      sub({ amountCents: 999_999, currency: "usd", nextRenewalDate: "2099-01-01" }),
    ];
    const gbpOutlier = sub({ amountCents: 500, currency: "gbp", nextRenewalDate: "2026-09-03" });
    const summary = computeWeeklyDigestSummary([...usdMajority, gbpOutlier], new Map(), [], NOW);
    expect(summary.currency).toBe("usd");
    // Only the two soon-renewing usd subscriptions count — not the
    // far-future usd one, and not the gbp one (real spend, wrong currency).
    expect(summary.upcomingRenewalsCents).toBe(3000);
  });

  it("picks the highest-impact notification within the same severity as the top priority", () => {
    const small = notif({ type: "duplicate_subscription", severity: "warning", impactCents: 100, title: "Small one" });
    const big = notif({ type: "duplicate_subscription", severity: "warning", impactCents: 5000, title: "Big one" });
    const summary = computeWeeklyDigestSummary([], new Map(), [small, big], NOW);
    expect(summary.topPriorityNotification?.title).toBe("Big one");
  });
});

describe("computeMonthlyTotal", () => {
  it("sums active subscriptions' monthly-equivalent cost in the primary currency", () => {
    const result = computeMonthlyTotal([
      sub({ amountCents: 1000, billingCycle: "monthly", currency: "usd" }),
      sub({ amountCents: 1200, billingCycle: "yearly", currency: "usd" }), // -> 100/mo
    ]);
    expect(result.currency).toBe("usd");
    expect(result.cents).toBe(1100);
  });

  it("excludes canceled subscriptions", () => {
    const result = computeMonthlyTotal([sub({ amountCents: 1000, status: "canceled" })]);
    expect(result.cents).toBe(0);
    expect(result.currency).toBeNull();
  });

  it("returns a null currency and zero cents for an empty portfolio", () => {
    expect(computeMonthlyTotal([])).toEqual({ cents: 0, currency: null });
  });
});

describe("isDigestWorthSending", () => {
  it("is true whenever there's at least one genuinely new notification", () => {
    const summary = computeWeeklyDigestSummary([], new Map(), [notif()], NOW);
    expect(isDigestWorthSending(summary)).toBe(true);
  });

  it("is false when there's real spend but nothing new happened — no 'here's what you already saw' digest", () => {
    const summary = computeWeeklyDigestSummary([sub({ amountCents: 500 })], new Map(), [], NOW);
    expect(isDigestWorthSending(summary)).toBe(false);
  });

  it("is false for a totally empty portfolio", () => {
    const summary = computeWeeklyDigestSummary([], new Map(), [], NOW);
    expect(isDigestWorthSending(summary)).toBe(false);
  });
});
