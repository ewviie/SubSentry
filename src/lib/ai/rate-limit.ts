import { createRateLimiter } from "@/lib/rate-limit";

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
// subscriptions. Same daily ceiling for each (unchanged from the original
// shared value), just no longer cross-charged against each other.
const DAILY_LIMIT = 20;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export const checkQuickAddRateLimit = createRateLimiter(DAILY_LIMIT, WINDOW_MS);
export const checkNarrateInsightsRateLimit = createRateLimiter(DAILY_LIMIT, WINDOW_MS);
