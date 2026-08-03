import { createRateLimiter } from "@/lib/rate-limit";

// Parsing + merchant normalization + recurring-detection is real CPU work
// (an O(n) parse plus per-cluster date/amount statistics), so this is
// throttled more conservatively than a single cheap subscription create —
// closer to checkBillingPortalRateLimit's conservative-ceiling style for an
// expensive operation than checkSubscriptionCreateRateLimit's generous one.
const ANALYZE_LIMIT = 10;
const ANALYZE_WINDOW_MS = 60 * 60 * 1000;

export const checkImportAnalyzeRateLimit = createRateLimiter(ANALYZE_LIMIT, ANALYZE_WINDOW_MS);

// A separate limiter from checkSubscriptionCreateRateLimit (60/hr, in
// src/lib/subscriptions/rate-limit.ts) deliberately left untouched by bulk
// import — one import-confirm call can legitimately create 10-30 rows at
// once in a single request, a different abuse shape than that per-row
// limiter was built for.
const CONFIRM_LIMIT = 5;
const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

export const checkImportConfirmRateLimit = createRateLimiter(CONFIRM_LIMIT, CONFIRM_WINDOW_MS);
