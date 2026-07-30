import { createRateLimiter } from "@/lib/rate-limit";

export type { RateLimitResult } from "@/lib/rate-limit";

// Stops a single accidental retry-loop or repeated-submit from running up
// AI API cost — see src/lib/rate-limit.ts for the shared mechanism and its
// documented limitations.
const DAILY_LIMIT = 20;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export const checkAndConsumeRateLimit = createRateLimiter(DAILY_LIMIT, WINDOW_MS);
