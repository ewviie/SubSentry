import { describe, it, expect, afterEach } from "vitest";
import {
  FREE_PLAN_SUBSCRIPTION_LIMIT,
  MAX_ACTIVE_SUBSCRIPTIONS,
  hasReachedSubscriptionLimit,
  getUpgradeUrl,
} from "./plan";

describe("MAX_ACTIVE_SUBSCRIPTIONS", () => {
  it("is well above the free-plan limit, since it's a defensive ceiling, not a product limit", () => {
    expect(MAX_ACTIVE_SUBSCRIPTIONS).toBeGreaterThan(FREE_PLAN_SUBSCRIPTION_LIMIT * 100);
  });
});

describe("hasReachedSubscriptionLimit", () => {
  it("is false for a pro user regardless of count", () => {
    expect(hasReachedSubscriptionLimit("pro", FREE_PLAN_SUBSCRIPTION_LIMIT + 50)).toBe(false);
  });

  it("is false for a free user under the limit", () => {
    expect(hasReachedSubscriptionLimit("free", FREE_PLAN_SUBSCRIPTION_LIMIT - 1)).toBe(false);
  });

  it("is true for a free user at the limit", () => {
    expect(hasReachedSubscriptionLimit("free", FREE_PLAN_SUBSCRIPTION_LIMIT)).toBe(true);
  });

  it("is true for a free user over the limit", () => {
    expect(hasReachedSubscriptionLimit("free", FREE_PLAN_SUBSCRIPTION_LIMIT + 1)).toBe(true);
  });
});

describe("getUpgradeUrl", () => {
  const originalEnv = process.env.STRIPE_PAYMENT_LINK;

  afterEach(() => {
    // Assigning `undefined` to a process.env property coerces it to the
    // string "undefined" rather than deleting the key — delete explicitly
    // when there was nothing to restore.
    if (originalEnv === undefined) {
      delete process.env.STRIPE_PAYMENT_LINK;
    } else {
      process.env.STRIPE_PAYMENT_LINK = originalEnv;
    }
  });

  it("returns null when no payment link is configured", () => {
    delete process.env.STRIPE_PAYMENT_LINK;
    expect(getUpgradeUrl("user-1")).toBeNull();
  });

  it("appends client_reference_id to the configured payment link", () => {
    process.env.STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_abc123";
    const url = getUpgradeUrl("user-1");
    expect(url).toBe("https://buy.stripe.com/test_abc123?client_reference_id=user-1");
  });
});
