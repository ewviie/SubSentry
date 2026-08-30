import { describe, it, expect, afterEach } from "vitest";
import {
  FREE_PLAN_SUBSCRIPTION_LIMIT,
  MAX_ACTIVE_SUBSCRIPTIONS,
  hasReachedSubscriptionLimit,
  hasPaidAccess,
  isBetaAllAccess,
  getUpgradeUrl,
  isBillingPortalConfigured,
  shouldShowSubscriptionLimitBanner,
} from "./plan";

// The free beta unlocks paid access for every plan (see BETA_ALL_ACCESS in
// plan.ts) — these tests document that current state. Once the beta ends
// (BETA_ALL_ACCESS flipped to false), hasPaidAccess/hasReachedSubscriptionLimit
// revert to real plan-based behavior and the "over the limit" tests below
// should be restored to asserting `true`.
//
// This file deliberately never imports or mocks lib/dev/plan-preview: the
// two functions here are plain, synchronous, and completely unaware that
// mechanism exists (see this file's own header comment on why — Client
// Components call isBetaAllAccess() directly, so this module must stay
// free of next/headers). Its dev-preview-aware behavior is covered by
// plan-preview.test.ts's resolveHasPaidAccess/resolveHasReachedSubscriptionLimit
// tests instead.
describe("hasPaidAccess", () => {
  it("is true for every plan during the beta", () => {
    expect(isBetaAllAccess()).toBe(true);
    expect(hasPaidAccess("free")).toBe(true);
    expect(hasPaidAccess("pro")).toBe(true);
  });
});

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

  it("is false for a free user at or over the limit during the beta (limit gate is bypassed)", () => {
    expect(hasReachedSubscriptionLimit("free", FREE_PLAN_SUBSCRIPTION_LIMIT)).toBe(false);
    expect(hasReachedSubscriptionLimit("free", FREE_PLAN_SUBSCRIPTION_LIMIT + 1)).toBe(false);
  });
});

// Monetization pass, section 9: the progressive "N of 5 used" banner
// (dashboard/page.tsx, subscriptions/page.tsx). Takes isPremium directly —
// see the function's own comment for why that (not a raw plan check) is
// what makes this correctly inert for a real beta user.
describe("shouldShowSubscriptionLimitBanner", () => {
  it("is false for a premium caller regardless of count, including a real beta user", () => {
    expect(shouldShowSubscriptionLimitBanner(true, FREE_PLAN_SUBSCRIPTION_LIMIT)).toBe(false);
    expect(shouldShowSubscriptionLimitBanner(true, FREE_PLAN_SUBSCRIPTION_LIMIT + 50)).toBe(false);
  });

  it("is false for a free caller well under the limit — never nags from the very first subscription", () => {
    expect(shouldShowSubscriptionLimitBanner(false, 0)).toBe(false);
    expect(shouldShowSubscriptionLimitBanner(false, FREE_PLAN_SUBSCRIPTION_LIMIT - 2)).toBe(false);
  });

  it("is true for a free caller one below the limit ('4 of 5')", () => {
    expect(shouldShowSubscriptionLimitBanner(false, FREE_PLAN_SUBSCRIPTION_LIMIT - 1)).toBe(true);
  });

  it("is true for a free caller at or over the limit", () => {
    expect(shouldShowSubscriptionLimitBanner(false, FREE_PLAN_SUBSCRIPTION_LIMIT)).toBe(true);
    expect(shouldShowSubscriptionLimitBanner(false, FREE_PLAN_SUBSCRIPTION_LIMIT + 1)).toBe(true);
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

  it("returns null during the beta even with a payment link configured", () => {
    process.env.STRIPE_PAYMENT_LINK = "https://buy.stripe.com/test_abc123";
    expect(getUpgradeUrl("user-1")).toBeNull();
  });
});

describe("isBillingPortalConfigured", () => {
  const originalEnv = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalEnv;
    }
  });

  it("is false when no secret key is configured", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(isBillingPortalConfigured()).toBe(false);
  });

  it("is true when a secret key is configured", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc123";
    expect(isBillingPortalConfigured()).toBe(true);
  });
});
