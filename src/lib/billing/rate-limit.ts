import { createRateLimiter } from "@/lib/rate-limit";

// Every other endpoint that makes an outbound-cost API call (AI, Stripe
// webhook signature checks aside) has a limiter — this one didn't, despite
// making a live Stripe API request per call. Generous enough that no real
// user clicking "Manage billing" a few times while sorting out payment
// details would ever notice it.
const PORTAL_LIMIT = 10;
const PORTAL_WINDOW_MS = 60 * 60 * 1000;

export const checkBillingPortalRateLimit = createRateLimiter(PORTAL_LIMIT, PORTAL_WINDOW_MS);

// /api/billing/activate had no limiter despite reading from Postgres and
// writing user.plan on every call — cheap individually, but unbounded
// hammering of a checkoutSessionId (even a failing/foreign one) is still
// free abuse otherwise.
const ACTIVATE_LIMIT = 20;
const ACTIVATE_WINDOW_MS = 60 * 60 * 1000;

export const checkActivateRateLimit = createRateLimiter(ACTIVATE_LIMIT, ACTIVATE_WINDOW_MS);
