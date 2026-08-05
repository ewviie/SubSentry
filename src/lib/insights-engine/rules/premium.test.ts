import { describe, it, expect } from "vitest";
import { PREMIUM_RULES } from "./premium";
import { sub } from "../test-fixtures";
import type { EngineContext } from "../types";

function ctx(subs: ReturnType<typeof sub>[]): EngineContext {
  return { subscriptions: subs, active: subs.filter((s) => s.status === "active"), todayIso: "2026-01-01", isPremium: true };
}

function ruleById(id: string) {
  return PREMIUM_RULES.find((r) => r.id === id)!;
}

describe("premium.annual_switch_savings", () => {
  const rule = ruleById("premium.annual_switch_savings");
  it("null with no monthly subscriptions", () => {
    expect(rule.evaluate(ctx([sub({ billingCycle: "yearly", amountCents: 12000 })]))).toBeNull();
  });
  it("estimates savings for monthly subscriptions above the noise floor", () => {
    const result = rule.evaluate(ctx([sub({ billingCycle: "monthly", amountCents: 5000 })]));
    expect(result).not.toBeNull();
    expect(result!.monthlySavingsCents).toBeGreaterThan(0);
    expect(result!.premium).toBe(true);
  });
});

describe("premium.functional_overlap", () => {
  const rule = ruleById("premium.functional_overlap");
  it("null with fewer than 3 in the same category", () => {
    expect(rule.evaluate(ctx([sub({ category: "streaming" }), sub({ category: "streaming" })]))).toBeNull();
  });
  it("flags 3+ subscriptions in the same category", () => {
    const subs = Array.from({ length: 3 }, () => sub({ category: "streaming" }));
    expect(rule.evaluate(ctx(subs))).not.toBeNull();
  });
});

describe("premium.risk_category_concentration", () => {
  const rule = ruleById("premium.risk_category_concentration");
  it("critical at 60%+ concentration", () => {
    const result = rule.evaluate(
      ctx([sub({ category: "streaming", amountCents: 9000 }), sub({ category: "fitness", amountCents: 1000 })]),
    );
    expect(result?.severity).toBe("critical");
  });
  it("null below 60%", () => {
    expect(
      rule.evaluate(ctx([sub({ category: "streaming", amountCents: 5000 }), sub({ category: "fitness", amountCents: 5000 })])),
    ).toBeNull();
  });
});

describe("premium.risk_expensive_duplicate", () => {
  const rule = ruleById("premium.risk_expensive_duplicate");
  it("critical when a duplicate's cost is 20%+ of total spend", () => {
    const result = rule.evaluate(ctx([sub({ name: "Netflix", amountCents: 1000 }), sub({ name: "Netflix Premium", amountCents: 1000 })]));
    expect(result?.severity).toBe("critical");
  });
});
