import { describe, it, expect } from "vitest";
import { FREE_RULES } from "./free";
import { sub } from "../test-fixtures";
import type { EngineContext } from "../types";

function ctx(subs: ReturnType<typeof sub>[]): EngineContext {
  return { subscriptions: subs, active: subs.filter((s) => s.status === "active"), todayIso: "2026-01-01", isPremium: false };
}

describe("free.biggest_subscription", () => {
  const rule = FREE_RULES.find((r) => r.id === "free.biggest_subscription")!;
  it("null with no active subscriptions", () => {
    expect(rule.evaluate(ctx([]))).toBeNull();
  });
  it("identifies the highest monthly-equivalent cost", () => {
    const big = sub({ name: "Big", amountCents: 5000 });
    const result = rule.evaluate(ctx([sub({ name: "Small", amountCents: 500 }), big]));
    expect(result?.subscriptionIds).toEqual([big.id]);
  });
});

describe("free.cheapest_subscription", () => {
  const rule = FREE_RULES.find((r) => r.id === "free.cheapest_subscription")!;
  it("null with fewer than 2 subscriptions", () => {
    expect(rule.evaluate(ctx([sub({})]))).toBeNull();
  });
  it("identifies the lowest monthly-equivalent cost", () => {
    const cheap = sub({ name: "Cheap", amountCents: 500 });
    const result = rule.evaluate(ctx([cheap, sub({ name: "Big", amountCents: 5000 })]));
    expect(result?.subscriptionIds).toEqual([cheap.id]);
  });
});
