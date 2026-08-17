import type { EngineOutput } from "./engine";
import { getSavingsPriority } from "@/lib/subscriptions/savings";

// Phase 9, Part 9 of the product brief: "choose the single most useful
// action from real evidence." Everywhere else on the dashboard already
// answers "what could I do" with a ranked list (Savings opportunities,
// Quick wins) — this answers the narrower, harder question "if I only look
// at one thing, what should it be," which no existing surface commits to a
// single answer for.
//
// Deliberately NOT a new detector: every candidate below is read from
// output the engine already computed (savingsForecast, warnings,
// renewalForecast, stats.topMerchants) rather than re-running any
// detection logic, so this can never disagree with what Savings
// opportunities/Quick wins/the health score already say about the same
// underlying facts — it only decides which single one of them is most
// worth leading with.
//
// Priority order, each tier strictly stronger evidence than the next:
//   1. A confirmed, "high" priority saving — money a cancellation would
//      deterministically recover, above the priority threshold.
//   2. A genuine renewal cash-flow spike (health.renewal_risk's warning
//      branch — an amount-based signal, not clustering-by-count-alone).
//   3. A "medium" priority saving (a confirmed saving below the high
//      threshold, or a review-tier finding with a large amount involved).
//   4. Fallback: the single highest-cost active subscription and its share
//      of total annual spend — always available once spend exists, and
//      exactly this mission's own worked example (Adobe, 34% of spend).
// Never fabricates a number: every amountCents here is a field the engine
// already computed for a different card, not a new calculation.
export interface BiggestOpportunity {
  kind: "savings" | "renewal_risk" | "expensive_subscription";
  title: string;
  description: string;
  whyShown: string;
  amountCents: number;
  amountLabel: string;
  subscriptionId: string | null;
  actionLabel: string;
  actionHref: string;
}

export function computeBiggestOpportunity(output: EngineOutput): BiggestOpportunity | null {
  const topSavings = output.savingsForecast.recommendations[0];

  if (topSavings && getSavingsPriority(topSavings) === "high") {
    return {
      kind: "savings",
      title: topSavings.title,
      description: topSavings.description,
      whyShown: "A confirmed duplicate is the most certain saving available right now.",
      amountCents: topSavings.impactCents,
      amountLabel: "/mo",
      subscriptionId: topSavings.targetSubscriptionId,
      actionLabel: topSavings.actionLabel,
      actionHref: `/subscriptions/${topSavings.targetSubscriptionId}`,
    };
  }

  const renewalSpike = output.warnings.find((w) => w.ruleId === "health.renewal_risk");
  if (renewalSpike) {
    return {
      kind: "renewal_risk",
      title: renewalSpike.title,
      description: renewalSpike.description,
      whyShown: "An unusually large amount is due soon compared with your typical monthly spend.",
      // Reads the figure renewalForecast already computed for the Renewals
      // card, rather than re-parsing it out of renewalSpike's own
      // description text — one number, one source of truth, shown two ways.
      amountCents: output.renewalForecast.totalDueNext30DaysCents,
      amountLabel: "due in 30 days",
      subscriptionId: null,
      actionLabel: "Review upcoming renewals",
      actionHref: "/subscriptions",
    };
  }

  if (topSavings && getSavingsPriority(topSavings) === "medium") {
    return {
      kind: "savings",
      title: topSavings.title,
      description: topSavings.description,
      whyShown: "The largest reviewable opportunity among your current subscriptions.",
      amountCents: topSavings.impactCents,
      amountLabel: "/mo",
      subscriptionId: topSavings.targetSubscriptionId,
      actionLabel: topSavings.actionLabel,
      actionHref: `/subscriptions/${topSavings.targetSubscriptionId}`,
    };
  }

  const biggest = output.stats.topMerchants[0];
  if (biggest && output.stats.totalYearlyCents > 0) {
    const sharePercent = Math.round((biggest.annualCents / output.stats.totalYearlyCents) * 100);
    return {
      kind: "expensive_subscription",
      title: biggest.name,
      description: `Your largest recurring expense — ${sharePercent}% of your total annual subscription spend.`,
      whyShown: "Reviewing your largest subscription has the greatest potential financial impact.",
      amountCents: biggest.annualCents,
      amountLabel: "/yr",
      subscriptionId: biggest.id,
      actionLabel: "Review",
      actionHref: `/subscriptions/${biggest.id}`,
    };
  }

  return null;
}
