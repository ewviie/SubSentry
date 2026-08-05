import { describe, it, expect } from "vitest";
import { HEALTH_RULES } from "./health";
import { sub } from "../test-fixtures";
import type { EngineContext } from "../types";

function ctx(subs: ReturnType<typeof sub>[]): EngineContext {
  return { subscriptions: subs, active: subs.filter((s) => s.status === "active"), todayIso: "2026-01-01", isPremium: false };
}

function ruleById(id: string) {
  const rule = HEALTH_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`missing rule ${id}`);
  return rule;
}

describe("health.duplicates", () => {
  const rule = ruleById("health.duplicates");
  it("positive when no duplicates", () => {
    const result = rule.evaluate(ctx([sub({ name: "Netflix" })]));
    expect(result?.severity).toBe("positive");
    expect(result?.scoreImpact).toBeGreaterThan(0);
  });
  it("penalizes duplicates, capped at -24", () => {
    const subs = Array.from({ length: 5 }, (_, i) => sub({ name: `Netflix ${i}` }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(-24);
  });
});

describe("health.concentration", () => {
  const rule = ruleById("health.concentration");
  it("positive when balanced across 3+ categories", () => {
    const result = rule.evaluate(
      ctx([sub({ category: "streaming" }), sub({ category: "fitness" }), sub({ category: "software" })]),
    );
    expect(result?.severity).toBe("positive");
  });
  it("flags 40%+ concentration", () => {
    const result = rule.evaluate(
      ctx([sub({ category: "streaming", amountCents: 8000 }), sub({ category: "fitness", amountCents: 2000 })]),
    );
    expect(result?.scoreImpact).toBe(-6);
  });
});

describe("health.expensive_outliers", () => {
  const rule = ruleById("health.expensive_outliers");
  it("null when nothing is an outlier", () => {
    expect(rule.evaluate(ctx([sub({ amountCents: 1000 }), sub({ amountCents: 1000 })]))).toBeNull();
  });
});

describe("health.canceled_history", () => {
  const rule = ruleById("health.canceled_history");
  it("null with no canceled history", () => {
    expect(rule.evaluate(ctx([sub({ status: "active" })]))).toBeNull();
  });
  it("positive bonus scaling with canceled count, capped at 6", () => {
    const subs = [sub({ status: "active" }), ...Array.from({ length: 5 }, () => sub({ status: "canceled" }))];
    const result = rule.evaluate(ctx(subs));
    expect(result?.scoreImpact).toBe(6);
  });
});

describe("health.recent_growth", () => {
  const rule = ruleById("health.recent_growth");
  it("null below 3 new subscriptions", () => {
    expect(rule.evaluate(ctx([sub({ createdAt: new Date("2025-12-31T00:00:00Z") })]))).toBeNull();
  });
  it("warns at 3+ new subscriptions in 30 days", () => {
    const subs = Array.from({ length: 3 }, () => sub({ createdAt: new Date("2025-12-31T00:00:00Z") }));
    const result = rule.evaluate(ctx(subs));
    expect(result?.severity).toBe("warning");
    expect(result?.scoreImpact).toBe(-4);
  });
});
