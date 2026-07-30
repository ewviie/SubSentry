import { createRateLimiter } from "@/lib/rate-limit";

// Bounds how fast one account can create rows, independent of the
// MAX_ACTIVE_SUBSCRIPTIONS ceiling (lib/billing/plan.ts) — that ceiling stops
// the total from growing unbounded, this stops a scripted loop from reaching
// it in seconds. Generous enough that no real user editing subscriptions by
// hand would ever notice it.
const CREATE_LIMIT = 60;
const CREATE_WINDOW_MS = 60 * 60 * 1000;

export const checkSubscriptionCreateRateLimit = createRateLimiter(CREATE_LIMIT, CREATE_WINDOW_MS);
