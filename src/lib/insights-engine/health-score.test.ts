import { describe, it, expect } from "vitest";
import { computeHealthScore } from "./health-score";
import { sub } from "./test-fixtures";
import type { EngineContext } from "./types";

function ctx(subs: ReturnType<typeof sub>[], overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    subscriptions: subs,
    active: subs.filter((s) => s.status === "active"),
    todayIso: "2026-01-01",
    isPremium: false,
    ...overrides,
  };
}

describe("computeHealthScore", () => {
  it("returns null with no active subscriptions", () => {
    expect(computeHealthScore(ctx([]))).toBeNull();
  });

  it("scores a clean single subscription high, with a breakdown", () => {
    const result = computeHealthScore(ctx([sub({ name: "Netflix" })]));
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(90);
    expect(result!.rating).toBe("Excellent");
    expect(result!.breakdown.length).toBeGreaterThan(0);
  });

  it("penalizes duplicate subscriptions", () => {
    const clean = computeHealthScore(ctx([sub({ name: "Netflix" })]))!;
    const withDup = computeHealthScore(
      ctx([sub({ name: "Netflix" }), sub({ name: "Netflix Premium" })]),
    )!;
    expect(withDup.score).toBeLessThan(clean.score);
    expect(withDup.breakdown.some((b) => b.delta < 0)).toBe(true);
  });

  it("clamps score into [0, 100]", () => {
    const many = Array.from({ length: 6 }, (_, i) => sub({ name: `Netflix ${i}`, amountCents: 999 }));
    const result = computeHealthScore(ctx(many))!;
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("assigns rating tiers matching the score", () => {
    const excellent = computeHealthScore(ctx([sub({ name: "Netflix" })]))!;
    expect(excellent.score).toBeGreaterThanOrEqual(90);
    expect(excellent.rating).toBe("Excellent");
  });
});
