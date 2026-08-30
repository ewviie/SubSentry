import { createRateLimiter, type RateLimitResult } from "@/lib/rate-limit";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import type { User } from "@/lib/db/schema";

export type { RateLimitResult } from "@/lib/rate-limit";

// Stops a single accidental retry-loop or repeated-submit from running up
// AI API cost — see src/lib/rate-limit.ts for the shared mechanism and its
// documented limitations.
//
// Two separate limiters, not one shared bucket: quick-add (parsing a typed
// subscription) and narrate-insights ("Rewrite with AI" on the dashboard)
// used to both consume from the same 20/day-per-user bucket despite being
// unrelated features from a user's point of view. A user quick-adding
// 15-20 subscriptions in one sitting (very plausible right after reviewing
// a bank import, or entering a backlog by hand) would then find "Rewrite
// with AI" blocked with "You've hit your AI usage limit for now" —
// confusing, since nothing about narrating insights felt related to adding
// subscriptions.
//
// Monetization Council P0: plan-aware ceilings, not one shared number.
// Every call is a real, metered Anthropic API cost (already capped at 512
// output tokens — see anthropic-provider.ts), so a Free ceiling exists to
// keep per-free-user cost bounded and predictable, and a materially higher
// Premium ceiling is one of the few genuinely new-cost features Premium
// unlocks. Both numbers came from the council's own explicit pricing
// recommendation, not invented here. Routed through hasPaidAccess (the
// same single choke point every other plan check in this app already
// uses — see billing/plan.ts) rather than a raw `plan === "pro"` check, so
// this automatically inherits the beta's "everyone gets full access" rule:
// every current user keeps getting the Premium ceiling below for as long
// as BETA_ALL_ACCESS stays on, and nothing here needs to change the day
// that flag is eventually turned off — the plan-aware split just starts
// actually differentiating at that point, a separate, deliberately
// deferred decision.
const WINDOW_MS = 24 * 60 * 60 * 1000;

// Exported (not just used internally below) so a route that hits the
// free ceiling can tell the caller the real Pro number in its own error
// response — quick-add/route.ts does this for the monetization pass's
// "You've used today's N free AI additions. Pro includes M/day." messaging,
// rather than that copy hardcoding a second copy of these same numbers.
export const FREE_QUICK_ADD_DAILY_LIMIT = 5;
export const PREMIUM_QUICK_ADD_DAILY_LIMIT = 40;
const FREE_NARRATE_DAILY_LIMIT = 3;
const PREMIUM_NARRATE_DAILY_LIMIT = 20;

// Same calling convention every existing limiter already has (`checkX(key)`
// plus a non-consuming `.peek(key)`), with a `plan` parameter added to both
// so a call site can't accidentally check the wrong tier's bucket for a
// given user. Two real, independent buckets per feature (Free's own,
// Premium's own) rather than one bucket whose ceiling changes — a user
// who's downgraded mid-window doesn't retroactively inherit whatever count
// they'd already run up against the other tier's bucket.
// Async — resolveHasPaidAccess() itself is (see lib/dev/plan-preview.ts's
// own comment on why: a dev-only preview override, inert outside
// development). Every call site already awaits this; the two below are the
// ones that matter. Routed through that resolver rather than calling
// hasPaidAccess (billing/plan.ts) directly for the same reason every other
// server-only entitlement check now is — see that file's own comment.
export interface PlanAwareRateLimiter {
  (userId: string, plan: User["plan"]): Promise<RateLimitResult>;
  peek(userId: string, plan: User["plan"]): Promise<RateLimitResult>;
}

function createPlanAwareRateLimiter(freeLimit: number, premiumLimit: number, windowMs: number): PlanAwareRateLimiter {
  const free = createRateLimiter(freeLimit, windowMs);
  const premium = createRateLimiter(premiumLimit, windowMs);
  const limiterFor = async (plan: User["plan"]) => ((await resolveHasPaidAccess(plan)) ? premium : free);

  const check = (async (userId: string, plan: User["plan"]) => (await limiterFor(plan))(userId)) as PlanAwareRateLimiter;
  check.peek = async (userId: string, plan: User["plan"]) => (await limiterFor(plan)).peek(userId);
  return check;
}

export const checkQuickAddRateLimit = createPlanAwareRateLimiter(
  FREE_QUICK_ADD_DAILY_LIMIT,
  PREMIUM_QUICK_ADD_DAILY_LIMIT,
  WINDOW_MS,
);
export const checkNarrateInsightsRateLimit = createPlanAwareRateLimiter(
  FREE_NARRATE_DAILY_LIMIT,
  PREMIUM_NARRATE_DAILY_LIMIT,
  WINDOW_MS,
);

// Pulled out as its own pure function, not left inline in
// quick-add/route.ts, specifically so this can be unit tested directly:
// every E2E test in this suite runs against a real `next build && next
// start` server with BETA_ALL_ACCESS on and no dev-preview available (see
// dev-plan-preview.spec.ts's own comment on why), so a real HTTP call
// against the route can only ever exercise the isPremium=true branch —
// there is no way to reach the free-tier message through a genuine request
// in this test environment. This function has no such dependency; it's
// given the plan-tier fact directly and just formats the string.
export function quickAddRateLimitMessage(isPremium: boolean): string {
  return isPremium
    ? `You've used today's ${PREMIUM_QUICK_ADD_DAILY_LIMIT} AI additions. Try again tomorrow, or enter it manually.`
    : `You've used today's ${FREE_QUICK_ADD_DAILY_LIMIT} free AI additions. Pro includes ${PREMIUM_QUICK_ADD_DAILY_LIMIT}/day.`;
}
