import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysUntilRenewal,
  getDuplicateFlaggedIds,
  getHighCostFlaggedIds,
  getNeedsReviewIds,
  isRecentlyAdded,
  isUpcomingRenewal,
} from "./filters";
import { computeInsights } from "./insights";
import type { Subscription } from "@/lib/db/schema";

// Pinned so day-boundary math (daysUntilRenewal, isRecentlyAdded,
// isUpcomingRenewal) can't flake depending on what wall-clock moment the
// test happens to run at, e.g. right around UTC midnight.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

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

describe("getDuplicateFlaggedIds", () => {
  it("flags both subscriptions in a likely-duplicate pair", () => {
    const a = sub({ name: "Netflix" });
    const b = sub({ name: "Netflix Premium" });
    const insights = computeInsights([a, b]);
    const flagged = getDuplicateFlaggedIds(insights);
    expect(flagged.has(a.id)).toBe(true);
    expect(flagged.has(b.id)).toBe(true);
  });

  it("does not flag subscriptions only sharing a category as duplicates", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming" }),
      sub({ name: "Disney+", category: "streaming" }),
    ];
    const insights = computeInsights(subs);
    const flagged = getDuplicateFlaggedIds(insights);
    expect(flagged.size).toBe(0);
  });
});

describe("getHighCostFlaggedIds", () => {
  it("flags a subscription that costs much more than a typical one", () => {
    const outlier = sub({ name: "Big", amountCents: 10000 });
    const subs = [outlier, sub({ amountCents: 500 }), sub({ amountCents: 500 })];
    const insights = computeInsights(subs);
    expect(getHighCostFlaggedIds(insights).has(outlier.id)).toBe(true);
  });
});

describe("getNeedsReviewIds", () => {
  it("includes overdue and duplicate subscriptions but not info-only insights", () => {
    const overdue = sub({ name: "Gym", nextRenewalDate: "2020-01-01" });
    const insights = computeInsights([overdue]);
    expect(getNeedsReviewIds(insights).has(overdue.id)).toBe(true);
  });

  it("does not include subscriptions only flagged by an info-severity insight", () => {
    const subs = [
      sub({ name: "Netflix", category: "streaming", amountCents: 5000 }),
      sub({ name: "Spotify", category: "software", amountCents: 500 }),
    ];
    const insights = computeInsights(subs);
    // expensive_category is info severity, not warning
    expect(getNeedsReviewIds(insights).size).toBe(0);
  });
});

describe("isRecentlyAdded", () => {
  it("is true for a subscription created moments ago", () => {
    expect(isRecentlyAdded(sub({ createdAt: new Date() }))).toBe(true);
  });

  it("is false for a subscription created 30 days ago", () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    expect(isRecentlyAdded(sub({ createdAt: old }))).toBe(false);
  });
});

describe("isUpcomingRenewal", () => {
  it("is true for a renewal within 30 days", () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect(isUpcomingRenewal(sub({ nextRenewalDate: soon }))).toBe(true);
  });

  it("is false for a renewal far in the future", () => {
    expect(isUpcomingRenewal(sub({ nextRenewalDate: "2099-01-01" }))).toBe(false);
  });

  it("is false for a renewal date already in the past", () => {
    expect(isUpcomingRenewal(sub({ nextRenewalDate: "2020-01-01" }))).toBe(false);
  });
});

describe("daysUntilRenewal", () => {
  it("returns a positive number of days for a future renewal", () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect(daysUntilRenewal(sub({ nextRenewalDate: future }))).toBe(3);
  });

  it("returns a negative number of days for a past renewal", () => {
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    expect(daysUntilRenewal(sub({ nextRenewalDate: past }))).toBe(-3);
  });
});
