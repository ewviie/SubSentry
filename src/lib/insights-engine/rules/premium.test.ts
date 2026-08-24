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

  // Regression, reproducing an exact real-account bug found via live
  // browser verification: totalAnnualCents used to sum amountCents * 12
  // across ALL monthly subscriptions regardless of currency. A portfolio of
  // 2 USD monthly subscriptions ($15.49 Netflix, $8.00 Notion) plus 1 GBP
  // monthly subscription (£25.00 UK Gym) used to compute "switching could
  // save an estimated $87.24/year" — a number that folded £25/mo raw cents
  // into a dollar-labeled estimate ((1549+800+2500)*12*0.15/12*12 = 8724
  // cents). The correct estimate only ever considers the primary (USD)
  // currency's monthly subscriptions: (1549+800)*12*0.15 rounded, /12
  // rounded, *12 = 4224 cents = $42.24/year.
  it("excludes a non-primary-currency monthly subscription from the annual-switch estimate", () => {
    const netflix = sub({ name: "Netflix", billingCycle: "monthly", amountCents: 1549, currency: "usd" });
    const notion = sub({ name: "Notion", billingCycle: "monthly", amountCents: 800, currency: "usd" });
    const ukGym = sub({ name: "UK Gym", billingCycle: "monthly", amountCents: 2500, currency: "gbp" });
    const result = rule.evaluate(ctx([netflix, notion, ukGym]));
    expect(result).not.toBeNull();
    expect(result!.currency).toBe("usd");
    expect(result!.monthlySavingsCents).toBe(352);
    expect(result!.description).toContain("$42.24/year");
    expect(result!.description).not.toContain("$87.24");
    expect(result!.subscriptionIds).not.toContain(ukGym.id);
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

describe("premium.risk_renewal_cluster", () => {
  const rule = ruleById("premium.risk_renewal_cluster");

  // Regression: count alone ("4+ renewals the same week") used to be
  // sufficient to claim "a real cash-flow crunch risk" regardless of
  // amount. 4 cheap renewals in the same week, in line with normal spend,
  // must not fire this rule.
  it("does not fire for a 4+ cluster whose total is in line with normal monthly spend", () => {
    const subs = [
      sub({ nextRenewalDate: "2026-01-05", amountCents: 500, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-06", amountCents: 500, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-07", amountCents: 500, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-08", amountCents: 500, billingCycle: "monthly" }),
    ];
    expect(rule.evaluate(ctx(subs))).toBeNull();
  });

  it("fires only when the clustered amount is genuinely well above typical monthly spend", () => {
    const subs = [
      sub({ nextRenewalDate: "2026-01-05", amountCents: 500, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-06", amountCents: 500, billingCycle: "monthly" }),
      sub({ nextRenewalDate: "2026-01-07", amountCents: 500, billingCycle: "monthly" }),
      // A large yearly charge landing the same week — genuinely unusual.
      sub({ nextRenewalDate: "2026-01-08", amountCents: 30000, billingCycle: "yearly" }),
    ];
    const result = rule.evaluate(ctx(subs));
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("critical");
  });
});

describe("premium.risk_rapid_growth", () => {
  const rule = ruleById("premium.risk_rapid_growth");

  it("does not fire below the evidence bar (10+)", () => {
    const subs = Array.from({ length: 5 }, () => sub({ createdAt: new Date("2025-12-31T00:00:00Z") }));
    expect(rule.evaluate(ctx(subs))).toBeNull();
  });

  // Regression: old copy claimed "Subscription count is growing rapidly...
  // before recurring cost compounds further" — a real spending-growth
  // claim this app has no evidence for (it only knows when a row was added
  // to SubSentry, not when the subscription actually started).
  it("at 10+, states only that subscriptions were added to SubSentry — never claims proven spending growth", () => {
    const subs = Array.from({ length: 10 }, () => sub({ createdAt: new Date("2025-12-31T00:00:00Z") }));
    const result = rule.evaluate(ctx(subs));
    expect(result).not.toBeNull();
    expect(result?.severity).toBe("warning");
    expect(result?.title.toLowerCase()).toContain("added to subsentry");
    expect(result?.title.toLowerCase()).not.toContain("growing rapidly");
    expect(result?.description.toLowerCase()).not.toContain("compound");
  });
});
