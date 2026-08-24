import { formatCents } from "@/lib/subscriptions/money";
import { monthlyCents } from "@/lib/subscriptions/money";
import type { EngineContext, InsightRule } from "../types";

const biggestSubscription: InsightRule = {
  id: "free.biggest_subscription",
  name: "Biggest subscription",
  description: "The single most expensive active subscription by monthly-equivalent cost.",
  severity: "info",
  category: "cost",
  premium: false,
  evaluate(ctx: EngineContext) {
    if (ctx.active.length === 0) return null;
    const biggest = [...ctx.active].sort(
      (a, b) => monthlyCents(b.amountCents, b.billingCycle) - monthlyCents(a.amountCents, a.billingCycle),
    )[0];
    return {
      ruleId: this.id,
      title: `${biggest.name} is your biggest subscription`,
      description: `${formatCents(monthlyCents(biggest.amountCents, biggest.billingCycle), biggest.currency)}/mo.`,
      severity: "info",
      category: "cost",
      premium: false,
      subscriptionIds: [biggest.id],
    };
  },
};

const cheapestSubscription: InsightRule = {
  id: "free.cheapest_subscription",
  name: "Cheapest subscription",
  description: "The single least expensive active subscription by monthly-equivalent cost.",
  severity: "info",
  category: "cost",
  premium: false,
  evaluate(ctx: EngineContext) {
    if (ctx.active.length < 2) return null;
    const cheapest = [...ctx.active].sort(
      (a, b) => monthlyCents(a.amountCents, a.billingCycle) - monthlyCents(b.amountCents, b.billingCycle),
    )[0];
    return {
      ruleId: this.id,
      title: `${cheapest.name} is your cheapest subscription`,
      description: `${formatCents(monthlyCents(cheapest.amountCents, cheapest.billingCycle), cheapest.currency)}/mo.`,
      severity: "info",
      category: "cost",
      premium: false,
      subscriptionIds: [cheapest.id],
    };
  },
};

export const FREE_RULES: InsightRule[] = [biggestSubscription, cheapestSubscription];
