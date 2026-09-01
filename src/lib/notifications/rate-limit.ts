import { createRateLimiter } from "@/lib/rate-limit";

// Marking notifications read is a frequent, low-stakes, per-user write —
// same class of action subscriptions/rate-limit.ts's own mutate limiter
// documents, and a generous ceiling for the same reason: a real user
// clicking through their own notification feed by hand should never come
// close to this, it only exists to stop a leaked session from hammering
// the endpoint.
const MARK_READ_LIMIT = 120;
const MARK_READ_WINDOW_MS = 60 * 60 * 1000;

export const checkNotificationMarkReadRateLimit = createRateLimiter(MARK_READ_LIMIT, MARK_READ_WINDOW_MS);
