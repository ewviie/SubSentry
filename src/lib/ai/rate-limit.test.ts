import { describe, it, expect } from "vitest";
import { checkQuickAddRateLimit, checkNarrateInsightsRateLimit } from "./rate-limit";

// Regression coverage for the fix that split one shared AI rate-limit
// bucket into two: quick-add (parsing a typed subscription) and
// narrate-insights ("Rewrite with AI") used to both consume from the same
// 20/day-per-user limiter, so exhausting one silently blocked the other —
// confusing, since the two are unrelated features from a user's point of
// view. These confirm they're now genuinely independent, not just two
// names for the same underlying bucket.
describe("checkQuickAddRateLimit and checkNarrateInsightsRateLimit are independent buckets", () => {
  it("exhausting checkQuickAddRateLimit for a user does not affect their checkNarrateInsightsRateLimit", () => {
    const userId = `test-user-${Math.random()}`;

    let lastQuickAdd;
    for (let i = 0; i < 25; i++) lastQuickAdd = checkQuickAddRateLimit(userId);
    expect(lastQuickAdd?.allowed).toBe(false);

    // The same user's narrate-insights quota is untouched.
    expect(checkNarrateInsightsRateLimit(userId).allowed).toBe(true);
  });

  it("exhausting checkNarrateInsightsRateLimit for a user does not affect their checkQuickAddRateLimit", () => {
    const userId = `test-user-${Math.random()}`;

    let lastNarrate;
    for (let i = 0; i < 25; i++) lastNarrate = checkNarrateInsightsRateLimit(userId);
    expect(lastNarrate?.allowed).toBe(false);

    expect(checkQuickAddRateLimit(userId).allowed).toBe(true);
  });

  it("each limiter still blocks once its own limit is exhausted for a given key", () => {
    const quickAddUser = `test-user-${Math.random()}`;
    const narrateUser = `test-user-${Math.random()}`;

    let lastQuickAdd;
    for (let i = 0; i < 25; i++) lastQuickAdd = checkQuickAddRateLimit(quickAddUser);
    expect(lastQuickAdd?.allowed).toBe(false);

    let lastNarrate;
    for (let i = 0; i < 25; i++) lastNarrate = checkNarrateInsightsRateLimit(narrateUser);
    expect(lastNarrate?.allowed).toBe(false);
  });
});
