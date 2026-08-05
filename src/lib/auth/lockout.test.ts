import { describe, it, expect } from "vitest";
import { delayForAttempt } from "./lockout";

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
