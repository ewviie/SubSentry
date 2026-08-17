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
  // "positive" (styled emerald — "this is money you'd get back") is
  // reserved for a *confirmed* saving (savings.ts's evidenceTier ===
  // "confirmed", i.e. a deterministic duplicate match). Everything else —
  // a review-tier finding's combined cost, a cash-flow-due total, or the
  // fallback's current top expense — is real money but not a proven
  // saving, so it renders "neutral" (plain foreground). Caught in
  // CodeRabbit review: the medium-priority branch used to show
  // impactCents under a bare "/mo" label with the same emerald treatment
  // as a confirmed saving, which reads as "you'll save this" for money
  // that's merely *involved*, not saved — exactly the "current spend" vs.
  // "confirmed savings" vs. "reviewable spend" conflation Part 6 of the
  // product brief exists to prevent.
  amountTone: "positive" | "neutral";
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
      // getSavingsPriority only ever returns "high" for evidenceTier
      // "confirmed" above the impact threshold, and today only the
      // "duplicate" recommendation type ever sets evidenceTier
      // "confirmed" (see savings.ts) — so this branch, in practice, is
      // always a duplicate. Branching on `type` explicitly rather than
      // relying on that invariant staying true forever: a future
      // "confirmed" evidence type added to savings.ts must not silently
      // inherit duplicate-specific wording it hasn't earned (raised in
      // CodeRabbit review).
      whyShown:
        topSavings.type === "duplicate"
          ? "A confirmed duplicate is the most certain saving available right now."
          : "A confirmed, high-impact saving is available right now.",
      amountCents: topSavings.impactCents,
      amountLabel: "/mo",
      amountTone: "positive",
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
      amountTone: "neutral", // real money, but due, not saved
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
      whyShown: "The largest reviewable opportunity among your current subscriptions — not yet a confirmed saving.",
      // impactCents is the real dollar amount *involved* (proven or not —
      // see savings.ts's own field comment), never assumed equal to a
      // proven saving here. A "medium" priority recommendation reaching
      // this branch is either a below-threshold confirmed duplicate (where
      // impactCents does equal a real saving) or a review-tier finding
      // (functional overlap / small subscriptions, where it's the group's
      // combined cost, not a saving) — "/mo combined" and the neutral tone
      // below are accurate for both, whereas a bare "/mo" would overstate
      // certainty for the review-tier case.
      amountCents: topSavings.impactCents,
      amountLabel: "/mo combined",
      amountTone: "neutral",
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
      amountTone: "neutral", // current spend, not a saving of any kind
      subscriptionId: biggest.id,
      actionLabel: "Review",
      actionHref: `/subscriptions/${biggest.id}`,
    };
  }

  return null;
}
