import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { groupRenewalsByProximity } from "./renewal-calendar";
import type { Subscription } from "@/lib/db/schema";

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

const NOW = new Date("2026-08-31T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("groupRenewalsByProximity", () => {
  it("buckets by proximity: overdue, this_week, this_month, later", () => {
    const overdue = sub({ name: "Overdue", nextRenewalDate: "2026-08-25" });
    const thisWeek = sub({ name: "This week", nextRenewalDate: "2026-09-03" });
    const thisMonth = sub({ name: "This month", nextRenewalDate: "2026-09-20" });
    const later = sub({ name: "Later", nextRenewalDate: "2026-11-01" });
    const buckets = groupRenewalsByProximity([overdue, thisWeek, thisMonth, later]);
    expect(buckets.map((b) => b.key)).toEqual(["overdue", "this_week", "this_month", "later"]);
    expect(buckets[0].subscriptions[0].name).toBe("Overdue");
    expect(buckets[1].subscriptions[0].name).toBe("This week");
    expect(buckets[2].subscriptions[0].name).toBe("This month");
    expect(buckets[3].subscriptions[0].name).toBe("Later");
  });

  it("excludes paused/canceled subscriptions", () => {
    const paused = sub({ status: "paused", nextRenewalDate: "2026-09-01" });
    const canceled = sub({ status: "canceled", nextRenewalDate: "2026-09-01" });
    expect(groupRenewalsByProximity([paused, canceled])).toEqual([]);
  });

  it("excludes renewals beyond the horizon", () => {
    const farOut = sub({ nextRenewalDate: "2028-01-01" });
    expect(groupRenewalsByProximity([farOut], 90)).toEqual([]);
  });

  it("respects a custom horizon", () => {
    const inTenDays = sub({ nextRenewalDate: "2026-09-10" });
    expect(groupRenewalsByProximity([inTenDays], 5)).toEqual([]);
    expect(groupRenewalsByProximity([inTenDays], 15)).toHaveLength(1);
  });

  it("sorts within each bucket soonest first", () => {
    const later1 = sub({ name: "Later A", nextRenewalDate: "2026-11-20" });
    const later2 = sub({ name: "Later B", nextRenewalDate: "2026-10-15" });
    const buckets = groupRenewalsByProximity([later1, later2]);
    expect(buckets[0].subscriptions.map((s) => s.name)).toEqual(["Later B", "Later A"]);
  });

  it("returns an empty array for no subscriptions", () => {
    expect(groupRenewalsByProximity([])).toEqual([]);
  });

  it("omits empty buckets entirely, never an empty-but-present group", () => {
    const onlyOverdue = sub({ nextRenewalDate: "2026-08-01" });
    const buckets = groupRenewalsByProximity([onlyOverdue]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].key).toBe("overdue");
  });
});
