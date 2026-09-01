import { describe, it, expect } from "vitest";
import { findStaleSubscriptions, STALE_THRESHOLD_DAYS } from "./staleness";
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
    lastReviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const NOW = new Date("2026-08-31T00:00:00Z").getTime();
const days = (n: number) => n * 86_400_000;

describe("findStaleSubscriptions", () => {
  it("flags an active subscription not reviewed within the threshold", () => {
    const s = sub({ lastReviewedAt: new Date(NOW - days(STALE_THRESHOLD_DAYS + 1)) });
    const result = findStaleSubscriptions([s], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].subscription.id).toBe(s.id);
    expect(result[0].everReviewed).toBe(true);
    expect(result[0].daysSinceReviewed).toBe(STALE_THRESHOLD_DAYS + 1);
  });

  it("does not flag a subscription reviewed within the threshold", () => {
    const s = sub({ lastReviewedAt: new Date(NOW - days(STALE_THRESHOLD_DAYS - 1)) });
    expect(findStaleSubscriptions([s], NOW)).toHaveLength(0);
  });

  it("falls back to createdAt, with everReviewed=false, when never reviewed", () => {
    const s = sub({ lastReviewedAt: null, createdAt: new Date(NOW - days(STALE_THRESHOLD_DAYS + 10)) });
    const result = findStaleSubscriptions([s], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].everReviewed).toBe(false);
    expect(result[0].daysSinceReviewed).toBe(STALE_THRESHOLD_DAYS + 10);
  });

  it("never flags a paused or canceled subscription, however stale", () => {
    const paused = sub({ status: "paused", lastReviewedAt: null, createdAt: new Date(NOW - days(1000)) });
    const canceled = sub({ status: "canceled", lastReviewedAt: null, createdAt: new Date(NOW - days(1000)) });
    expect(findStaleSubscriptions([paused, canceled], NOW)).toHaveLength(0);
  });

  it("sorts longest-neglected first", () => {
    const recent = sub({ name: "Recent", lastReviewedAt: new Date(NOW - days(STALE_THRESHOLD_DAYS + 5)) });
    const oldest = sub({ name: "Oldest", lastReviewedAt: new Date(NOW - days(STALE_THRESHOLD_DAYS + 50)) });
    const result = findStaleSubscriptions([recent, oldest], NOW);
    expect(result.map((r) => r.subscription.name)).toEqual(["Oldest", "Recent"]);
  });

  it("exactly at the threshold counts as stale (inclusive boundary)", () => {
    const s = sub({ lastReviewedAt: new Date(NOW - days(STALE_THRESHOLD_DAYS)) });
    expect(findStaleSubscriptions([s], NOW)).toHaveLength(1);
  });
});
