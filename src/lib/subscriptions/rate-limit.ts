import { createRateLimiter } from "@/lib/rate-limit";

// Bounds how fast one account can create rows, independent of the
// MAX_ACTIVE_SUBSCRIPTIONS ceiling (lib/billing/plan.ts) — that ceiling stops
// the total from growing unbounded, this stops a scripted loop from reaching
// it in seconds. Generous enough that no real user editing subscriptions by
// hand would ever notice it.
const CREATE_LIMIT = 60;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

export const checkSubscriptionCreateRateLimit = createRateLimiter(CREATE_LIMIT, CREATE_WINDOW_MS);

// PATCH/DELETE on a single subscription had no limiter at all — a leaked
// session (XSS, stolen cookie) could otherwise hammer either endpoint with
// no throttle. Same generous ceiling as create, since edits are no more
// expensive per-request and a real user editing several subscriptions by
// hand should never hit it.
const MUTATE_LIMIT = 60;
const MUTATE_WINDOW_MS = 60 * 60 * 1000;

export const checkSubscriptionMutateRateLimit = createRateLimiter(MUTATE_LIMIT, MUTATE_WINDOW_MS);

// Bulk quick-add (User Value Journey Audit, opportunity #1) — same split as
// imports/rate-limit.ts's checkImportAnalyzeRateLimit/checkImportConfirmRateLimit,
// for the same reason: parsing is the expensive step (real CPU plus up to
// MAX_BULK_QUICK_ADD_LINES AI calls per request — see lib/ai/bulk-quick-add.ts),
// while confirming is one insert-batch request that can create many rows at
// once, a different abuse shape than checkSubscriptionCreateRateLimit's
// per-row-request ceiling above was built for. The real per-call AI cost
// during parsing is separately bounded by lib/ai/rate-limit.ts's own
// checkQuickAddRateLimit, consumed once per line inside that request — this
// limiter exists on top of that to bound how often the (CPU- and
// AI-call-heavy) request itself can be initiated, independent of whether
// every line inside it happens to be rate-limited away.
const BULK_QUICK_ADD_PARSE_LIMIT = 10;
const BULK_QUICK_ADD_PARSE_WINDOW_MS = 60 * 60 * 1000;

export const checkBulkQuickAddParseRateLimit = createRateLimiter(BULK_QUICK_ADD_PARSE_LIMIT, BULK_QUICK_ADD_PARSE_WINDOW_MS);

const BULK_QUICK_ADD_CONFIRM_LIMIT = 5;
const BULK_QUICK_ADD_CONFIRM_WINDOW_MS = 60 * 60 * 1000;

export const checkBulkQuickAddConfirmRateLimit = createRateLimiter(BULK_QUICK_ADD_CONFIRM_LIMIT, BULK_QUICK_ADD_CONFIRM_WINDOW_MS);
