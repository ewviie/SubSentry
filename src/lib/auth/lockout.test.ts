import { describe, it, expect } from "vitest";
import { delayForAttempt, shouldRequireCaptcha } from "./lockout";

describe("delayForAttempt", () => {
  it("no delay for the first two attempts", () => {
    expect(delayForAttempt(0)).toBe(0);
    expect(delayForAttempt(1)).toBe(0);
  });

  it("a short delay after 2-3 prior failures", () => {
    expect(delayForAttempt(2)).toBe(1500);
    expect(delayForAttempt(3)).toBe(1500);
  });

  it("a longer delay once 4+ prior failures accumulate", () => {
    expect(delayForAttempt(4)).toBe(4000);
    expect(delayForAttempt(10)).toBe(4000);
  });

  it("delay is monotonically non-decreasing with more prior failures", () => {
    for (let i = 0; i < 10; i++) {
      expect(delayForAttempt(i + 1)).toBeGreaterThanOrEqual(delayForAttempt(i));
    }
  });
});

// Regression coverage for the lockout-as-DoS fix: before this, login had no
// CAPTCHA gate at all, so 5 cheap, unauthenticated wrong-password POSTs
// against a known email locked it out for 15 minutes, repeatable forever.
// This is the exact predicate api/auth/login/route.ts now checks (alongside
// isCaptchaConfigured()) before even looking at the submitted password.
describe("shouldRequireCaptcha", () => {
  it("does not require CAPTCHA before any friction delay has kicked in", () => {
    expect(shouldRequireCaptcha(delayForAttempt(0))).toBe(false);
    expect(shouldRequireCaptcha(delayForAttempt(1))).toBe(false);
  });

  it("requires CAPTCHA the moment delayForAttempt starts adding friction (2+ prior failures)", () => {
    expect(shouldRequireCaptcha(delayForAttempt(2))).toBe(true);
    expect(shouldRequireCaptcha(delayForAttempt(4))).toBe(true);
    expect(shouldRequireCaptcha(delayForAttempt(10))).toBe(true);
  });

  it("agrees with delayForAttempt's own threshold rather than a second, hardcoded one", () => {
    for (let priorFailedCount = 0; priorFailedCount <= 6; priorFailedCount++) {
      expect(shouldRequireCaptcha(delayForAttempt(priorFailedCount))).toBe(delayForAttempt(priorFailedCount) > 0);
    }
  });
});
