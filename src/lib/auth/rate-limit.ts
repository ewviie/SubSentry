import { createRateLimiter } from "@/lib/rate-limit";

// Keyed by IP+email so a credential-stuffing script grinding through many
// accounts from one IP gets bounded per account, without one attacker's
// traffic locking out other accounts sharing that IP.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const checkLoginRateLimit = createRateLimiter(LOGIN_LIMIT, LOGIN_WINDOW_MS);

// Secondary bucket keyed by email alone, independent of client IP. The
// bucket above trusts X-Forwarded-For (see lib/http/client-ip.ts) — this
// repo has no reverse-proxy config in front of the app that's guaranteed to
// strip a client-supplied copy of that header, so an attacker can spoof a
// fresh IP per request and never accumulate in the IP+email bucket. This
// one can't be defeated that way: it bounds attempts against one victim's
// account regardless of what IP each request claims. Same in-memory,
// per-process design as every other limiter here — still not a defense
// against a truly distributed attacker, just against IP spoofing.
const LOGIN_PER_EMAIL_LIMIT = 20;
const LOGIN_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const checkLoginPerEmailRateLimit = createRateLimiter(
  LOGIN_PER_EMAIL_LIMIT,
  LOGIN_PER_EMAIL_WINDOW_MS,
);

// Keyed by IP alone — signup spam/enumeration is a per-source problem,
// not a per-account one (there's no account yet).
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
export const checkSignupRateLimit = createRateLimiter(SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
