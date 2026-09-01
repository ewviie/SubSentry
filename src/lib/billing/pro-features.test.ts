import { describe, it, expect } from "vitest";
import { PRO_MONTHLY_PRICE, PRO_FEATURES } from "./pro-features";

// This module is the single source of truth "what Pro actually unlocks and
// what it costs" (see its own header comment) — pricing-section.tsx (the
// homepage grid), login-pro-teaser.tsx (the login page), and Settings →
// Plan & Billing all import PRO_MONTHLY_PRICE/PRO_FEATURES from here rather
// than keeping their own copy, which is exactly how Settings' list once
// silently drifted out of sync (missing "Optimization recommendations")
// before this module existed. Locking down the exact values here means any
// future edit to either constant is a deliberate, visible change to this
// test, not a silent drift discovered by a user comparing two pages.
describe("PRO_MONTHLY_PRICE", () => {
  it("is the real, current Pro price — not an invented or annual figure", () => {
    expect(PRO_MONTHLY_PRICE).toBe("£4.99");
  });
});

describe("PRO_FEATURES", () => {
  it("lists exactly the real Pro benefits, in order, with no invented items", () => {
    expect(PRO_FEATURES).toEqual([
      "Unlimited active subscriptions",
      "Automatic daily watchdog sync for connected accounts",
      "Full Health Score across all 5 factors",
      "Every savings opportunity",
      "Optimization recommendations",
      "AI quick-add — 40/day",
      "Priority support",
    ]);
  });

  it("has no duplicate entries", () => {
    expect(new Set(PRO_FEATURES).size).toBe(PRO_FEATURES.length);
  });
});
