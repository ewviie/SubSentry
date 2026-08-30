import { describe, it, expect, vi } from "vitest";
import {
  checkQuickAddRateLimit,
  checkNarrateInsightsRateLimit,
  quickAddRateLimitMessage,
  FREE_QUICK_ADD_DAILY_LIMIT,
  PREMIUM_QUICK_ADD_DAILY_LIMIT,
} from "./rate-limit";

// resolveHasPaidAccess (lib/dev/plan-preview.ts — what rate-limit.ts
// actually calls instead of hasPaidAccess directly, see that file's own
// comment) is mocked per-test, not left to the real BETA_ALL_ACCESS value
// in billing/plan.ts, so these tests deterministically exercise both the
// Free and Premium buckets regardless of whether the beta flag happens to
// be on or off when this suite runs — same vi.hoisted + partial-mock
// pattern queries.reactivation.test.ts already uses for this exact module.
// Async (mockResolvedValue, not mockReturnValue): the real function is —
// so every checkX(...) call below awaits its result too.
const { hasPaidAccessMock } = vi.hoisted(() => ({ hasPaidAccessMock: vi.fn<(plan: "free" | "pro") => Promise<boolean>>() }));
vi.mock("@/lib/dev/plan-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dev/plan-preview")>();
  return { ...actual, resolveHasPaidAccess: hasPaidAccessMock };
});

// Regression coverage for the fix that split one shared AI rate-limit
// bucket into two: quick-add (parsing a typed subscription) and
// narrate-insights ("Rewrite with AI") used to both consume from the same
// 20/day-per-user limiter, so exhausting one silently blocked the other —
// confusing, since the two are unrelated features from a user's point of
// view. These confirm they're now genuinely independent, not just two
// names for the same underlying bucket.
describe("checkQuickAddRateLimit and checkNarrateInsightsRateLimit are independent buckets", () => {
  it("exhausting checkQuickAddRateLimit for a user does not affect their checkNarrateInsightsRateLimit", async () => {
    hasPaidAccessMock.mockResolvedValue(true); // Premium ceiling (40) — plenty of headroom to exhaust in 45 calls
    const userId = `test-user-${Math.random()}`;

    let lastQuickAdd;
    for (let i = 0; i < 45; i++) lastQuickAdd = await checkQuickAddRateLimit(userId, "pro");
    expect(lastQuickAdd?.allowed).toBe(false);

    // The same user's narrate-insights quota is untouched.
    expect((await checkNarrateInsightsRateLimit(userId, "pro")).allowed).toBe(true);
  });

  it("exhausting checkNarrateInsightsRateLimit for a user does not affect their checkQuickAddRateLimit", async () => {
    hasPaidAccessMock.mockResolvedValue(true);
    const userId = `test-user-${Math.random()}`;

    let lastNarrate;
    for (let i = 0; i < 25; i++) lastNarrate = await checkNarrateInsightsRateLimit(userId, "pro");
    expect(lastNarrate?.allowed).toBe(false);

    expect((await checkQuickAddRateLimit(userId, "pro")).allowed).toBe(true);
  });

  it("each limiter still blocks once its own limit is exhausted for a given key", async () => {
    hasPaidAccessMock.mockResolvedValue(true);
    const quickAddUser = `test-user-${Math.random()}`;
    const narrateUser = `test-user-${Math.random()}`;

    let lastQuickAdd;
    for (let i = 0; i < 45; i++) lastQuickAdd = await checkQuickAddRateLimit(quickAddUser, "pro");
    expect(lastQuickAdd?.allowed).toBe(false);

    let lastNarrate;
    for (let i = 0; i < 25; i++) lastNarrate = await checkNarrateInsightsRateLimit(narrateUser, "pro");
    expect(lastNarrate?.allowed).toBe(false);
  });
});

// Monetization Council P0: Free and Premium must be genuinely independent
// ceilings, not the same bucket relabeled — a free-plan user exhausting
// their own quota must never be able to "borrow" a premium-plan user's
// remaining calls, and vice versa, even though both route through the same
// createPlanAwareRateLimiter factory.
describe("plan-aware ceilings", () => {
  it("gives a free-plan user the lower quick-add ceiling (5/day)", async () => {
    hasPaidAccessMock.mockResolvedValue(false);
    const userId = `free-user-${Math.random()}`;

    for (let i = 0; i < 5; i++) {
      expect((await checkQuickAddRateLimit(userId, "free")).allowed).toBe(true);
    }
    expect((await checkQuickAddRateLimit(userId, "free")).allowed).toBe(false);
  });

  it("gives a premium-plan user a materially higher quick-add ceiling (40/day)", async () => {
    hasPaidAccessMock.mockResolvedValue(true);
    const userId = `pro-user-${Math.random()}`;

    for (let i = 0; i < 40; i++) {
      expect((await checkQuickAddRateLimit(userId, "pro")).allowed).toBe(true);
    }
    expect((await checkQuickAddRateLimit(userId, "pro")).allowed).toBe(false);
  });

  it("gives a free-plan user the lower narrate-insights ceiling (3/day)", async () => {
    hasPaidAccessMock.mockResolvedValue(false);
    const userId = `free-user-${Math.random()}`;

    for (let i = 0; i < 3; i++) {
      expect((await checkNarrateInsightsRateLimit(userId, "free")).allowed).toBe(true);
    }
    expect((await checkNarrateInsightsRateLimit(userId, "free")).allowed).toBe(false);
  });

  it("gives a premium-plan user a materially higher narrate-insights ceiling (20/day)", async () => {
    hasPaidAccessMock.mockResolvedValue(true);
    const userId = `pro-user-${Math.random()}`;

    for (let i = 0; i < 20; i++) {
      expect((await checkNarrateInsightsRateLimit(userId, "pro")).allowed).toBe(true);
    }
    expect((await checkNarrateInsightsRateLimit(userId, "pro")).allowed).toBe(false);
  });

  it("a free-plan user exhausting their own bucket cannot draw down a premium-plan user's separate bucket", async () => {
    hasPaidAccessMock.mockResolvedValue(false);
    const freeUser = `free-user-${Math.random()}`;
    for (let i = 0; i < 6; i++) await checkQuickAddRateLimit(freeUser, "free");

    hasPaidAccessMock.mockResolvedValue(true);
    const proUser = `pro-user-${Math.random()}`;
    expect((await checkQuickAddRateLimit(proUser, "pro")).allowed).toBe(true);
  });

  it("peek respects the caller's plan without consuming a slot", async () => {
    hasPaidAccessMock.mockResolvedValue(false);
    const userId = `free-user-${Math.random()}`;

    expect((await checkNarrateInsightsRateLimit.peek(userId, "free")).allowed).toBe(true);
    // A pure peek must not have consumed a slot — the real limit (3) is
    // still fully available afterward.
    for (let i = 0; i < 3; i++) {
      expect((await checkNarrateInsightsRateLimit(userId, "free")).allowed).toBe(true);
    }
    expect((await checkNarrateInsightsRateLimit.peek(userId, "free")).allowed).toBe(false);
  });
});

// Monetization pass, section 8: quick-add/route.ts's 429 response names the
// real Pro number at the exact moment a free caller hits their own ceiling.
// Tested here, as a pure function, rather than through a real HTTP call
// against the route — every E2E test in this suite runs against a real
// `next build && next start` server with BETA_ALL_ACCESS on and no
// dev-preview available (see dev-plan-preview.spec.ts's own comment), so a
// genuine request can only ever reach the isPremium=true branch; there's no
// way to exercise the free-tier message through a real call in that
// environment. quickAddRateLimitMessage itself has no such dependency.
describe("quickAddRateLimitMessage", () => {
  it("names the real free ceiling and the real Pro ceiling for a free caller", () => {
    const message = quickAddRateLimitMessage(false);
    expect(message).toContain(`${FREE_QUICK_ADD_DAILY_LIMIT} free AI additions`);
    expect(message).toContain(`Pro includes ${PREMIUM_QUICK_ADD_DAILY_LIMIT}/day`);
  });

  it("never tells an already-premium caller to upgrade to what they already have", () => {
    const message = quickAddRateLimitMessage(true);
    expect(message).toContain(`${PREMIUM_QUICK_ADD_DAILY_LIMIT} AI additions`);
    expect(message.toLowerCase()).not.toContain("pro");
    expect(message.toLowerCase()).not.toContain("upgrade");
  });
});
