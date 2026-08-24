import { describe, it, expect } from "vitest";
import { computeBiggestOpportunity } from "./biggest-opportunity";
import type { EngineOutput } from "./engine";
import type { SavingsRecommendation } from "@/lib/subscriptions/savings";
import type { InsightResult } from "./types";

// Every candidate computeBiggestOpportunity considers is read straight off
// EngineOutput (see that file's own header comment) — these fixtures build
// only the slices each test actually needs, with the rest at honest,
// inert defaults (0 subscriptions, no findings), so a test failure always
// traces back to the one field it deliberately set.
function baseOutput(): EngineOutput {
  return {
    healthScore: null,
    optimizationScore: null,
    stats: {
      totalMonthlyCents: 0,
      totalYearlyCents: 0,
      currency: null,
      otherCurrencyActiveCount: 0,
      activeCount: 0,
      newSubscriptionsThisMonth: 0,
      longestRunning: null,
      spendBySource: [],
      billingCycles: [],
      topMerchants: [],
    },
    renewalForecast: {
      nextRenewal: null,
      totalDueNext30DaysCents: 0,
      busiestPeriod: null,
      largestUpcomingPayment: null,
      currency: null,
    },
    positive: [],
    warnings: [],
    optimization: [],
    quickWins: [],
    premiumInsights: [],
    savingsForecast: { recommendations: [], monthlySavingsCents: 0, yearlySavingsCents: 0 },
    estimatedYearlySavingsCents: 0,
  };
}

function savingsRec(overrides: Partial<SavingsRecommendation>): SavingsRecommendation {
  return {
    id: "rec-1",
    type: "duplicate",
    title: "Netflix and Netflix Premium look like duplicates",
    description: "These look like the same service.",
    actionLabel: "Review Netflix Premium",
    monthlySavingsCents: 0,
    impactCents: 0,
    evidenceTier: "confirmed",
    urgencyDays: 10,
    targetSubscriptionId: "sub-target",
    involvedSubscriptionIds: ["sub-a", "sub-target"],
    currency: "usd",
    ...overrides,
  };
}

function renewalRiskWarning(): InsightResult {
  return {
    ruleId: "health.renewal_risk",
    title: "More than usual is due in the next 30 days",
    description: "$300.00 is due in the next 30 days, above your typical monthly spend.",
    severity: "warning",
    category: "health",
    premium: false,
    subscriptionIds: [],
    dimension: "renewal",
    scoreImpact: -11,
  };
}

describe("computeBiggestOpportunity", () => {
  it("returns null when there's nothing to show (no savings, no risk, no spend)", () => {
    expect(computeBiggestOpportunity(baseOutput())).toBeNull();
  });

  it("picks a 'high' priority confirmed saving over a renewal-risk spike", () => {
    const output = baseOutput();
    output.savingsForecast.recommendations = [savingsRec({ evidenceTier: "confirmed", impactCents: 2000 })];
    output.warnings = [renewalRiskWarning()];

    const result = computeBiggestOpportunity(output);
    expect(result?.kind).toBe("savings");
    expect(result?.subscriptionId).toBe("sub-target");
    // A confirmed, deterministic saving is the only case styled as a real
    // "money back" figure — see BiggestOpportunity's own amountTone comment.
    expect(result?.amountTone).toBe("positive");
  });

  it("uses generic (not duplicate-specific) wording for a hypothetical non-duplicate confirmed saving", () => {
    // No recommendation type other than "duplicate" sets evidenceTier
    // "confirmed" today (see savings.ts), so this exercises the defensive
    // fallback branch directly rather than relying on that invariant.
    const output = baseOutput();
    output.savingsForecast.recommendations = [
      savingsRec({ type: "functional_overlap", evidenceTier: "confirmed", impactCents: 2000 }),
    ];

    const result = computeBiggestOpportunity(output);
    expect(result?.whyShown).not.toContain("duplicate");
    expect(result?.whyShown).toContain("confirmed");
  });

  it("picks the renewal-risk spike when no 'high' priority saving exists", () => {
    const output = baseOutput();
    output.warnings = [renewalRiskWarning()];
    output.renewalForecast.totalDueNext30DaysCents = 30000;

    const result = computeBiggestOpportunity(output);
    expect(result?.kind).toBe("renewal_risk");
    expect(result?.amountCents).toBe(30000);
    expect(result?.amountLabel).toBe("due in 30 days");
    expect(result?.amountTone).toBe("neutral");
  });

  it("picks a 'medium' priority saving when no spike and no 'high' saving exist, labeled as involved spend, not a saving", () => {
    const output = baseOutput();
    // review-tier, below the $15 high-impact threshold gate on evidenceTier
    // "confirmed" but above it on impact -> medium (see savings.ts's
    // getSavingsPriority for the exact rule this exercises).
    output.savingsForecast.recommendations = [
      savingsRec({ type: "functional_overlap", evidenceTier: "review", impactCents: 2000, monthlySavingsCents: 0 }),
    ];

    const result = computeBiggestOpportunity(output);
    expect(result?.kind).toBe("savings");
    // A review-tier finding's impactCents is real money *involved*, never a
    // proven saving — must not render with the same "confirmed win"
    // treatment as the high-priority branch (CodeRabbit review finding).
    expect(result?.amountLabel).toBe("/mo combined");
    expect(result?.amountTone).toBe("neutral");
  });

  it("falls back to the highest-cost active subscription when no savings or risk exist", () => {
    const output = baseOutput();
    output.stats.topMerchants = [{ id: "sub-adobe", name: "Adobe Creative Cloud", category: "software", annualCents: 71988, currency: "usd" }];
    output.stats.totalYearlyCents = 211729;

    const result = computeBiggestOpportunity(output);
    expect(result).toMatchObject({
      kind: "expensive_subscription",
      title: "Adobe Creative Cloud",
      subscriptionId: "sub-adobe",
      amountCents: 71988,
      amountLabel: "/yr",
      amountTone: "neutral",
      currency: "usd",
    });
    expect(result?.description).toContain("34%");
  });

  // Regression: this card used to render formatCents(opportunity.amountCents)
  // with no currency argument at all, defaulting to USD — so a GBP
  // subscription's "£300.00/yr" showed as "$300.00/yr" on a real dashboard,
  // and (a separate bug, fixed upstream in engine.ts's stats computation —
  // see engine.test.ts) the 44% share was computed by dividing that GBP
  // figure into a total that mixed in USD spend too. This test locks in the
  // contract this function must uphold once its inputs are already
  // currency-safe: the currency it reports is read from the real
  // subscription data, never assumed.
  it("reports the top merchant's own currency, not a hardcoded default", () => {
    const output = baseOutput();
    output.stats.topMerchants = [{ id: "sub-gym", name: "UK Gym", category: "fitness", annualCents: 30000, currency: "gbp" }];
    output.stats.totalYearlyCents = 30000;

    const result = computeBiggestOpportunity(output);
    expect(result?.currency).toBe("gbp");
    expect(result?.amountCents).toBe(30000);
  });

  it("returns null when there's spend data but it sums to zero", () => {
    const output = baseOutput();
    output.stats.topMerchants = [{ id: "sub-free", name: "Free Tier Thing", category: "other", annualCents: 0, currency: "usd" }];
    output.stats.totalYearlyCents = 0;

    expect(computeBiggestOpportunity(output)).toBeNull();
  });
});
