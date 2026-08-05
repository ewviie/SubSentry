import { createRateLimiterAsync } from "@/lib/rate-limit-distributed";
import { createRateLimiter } from "@/lib/rate-limit";

// Every limiter in this file is async and Redis-backed when
// UPSTASH_REDIS_REST_URL/TOKEN are configured (falls back to this
// process's own memory otherwise — see rate-limit-distributed.ts). These
// five are specifically the authentication surfaces named in the
// production-readiness mission as needing distributed protection; every
// other limiter in the app (billing, imports, AI, subscriptions) stays on
// the simpler synchronous in-memory limiter — smaller blast radius, all
// already behind an authenticated session, and migrating all ~15 call
// sites in one pass was judged lower value than doing these 5 correctly.

// Keyed by IP+email so a credential-stuffing script grinding through many
// accounts from one IP gets bounded per account, without one attacker's
// traffic locking out other accounts sharing that IP.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const checkLoginRateLimit = createRateLimiterAsync(LOGIN_LIMIT, LOGIN_WINDOW_MS);

// Secondary bucket keyed by email alone, independent of client IP. The
// bucket above trusts X-Forwarded-For (see lib/http/client-ip.ts) — this
// repo has no reverse-proxy config in front of the app that's guaranteed to
// strip a client-supplied copy of that header, so an attacker can spoof a
// fresh IP per request and never accumulate in the IP+email bucket. This
// one can't be defeated that way: it bounds attempts against one victim's
// account regardless of what IP each request claims.
const LOGIN_PER_EMAIL_LIMIT = 20;
const LOGIN_PER_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const checkLoginPerEmailRateLimit = createRateLimiterAsync(
  LOGIN_PER_EMAIL_LIMIT,
  LOGIN_PER_EMAIL_WINDOW_MS,
);

// Aggregate bucket keyed by IP alone, independent of email — bounds a
// password-spray attack (many different accounts, one source IP) that
// neither bucket above catches: the IP+email bucket partitions by email so
// spraying a fresh target resets the count, and the per-email bucket never
// looks at IP at all. Limit is generous (well above the IP+email one) so a
// shared office/NAT/VPN egress IP with several genuine users typing wrong
// passwords doesn't get collectively rate-limited. Same X-Forwarded-For
// spoofing caveat as the IP+email bucket above — still a real deterrent
// against unsophisticated spray tooling that doesn't rotate headers.
const LOGIN_IP_LIMIT = 30;
const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;
export const checkLoginIpRateLimit = createRateLimiterAsync(LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS);

// Keyed by IP alone — signup spam/enumeration is a per-source problem,
// not a per-account one (there's no account yet).
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
export const checkSignupRateLimit = createRateLimiterAsync(SIGNUP_LIMIT, SIGNUP_WINDOW_MS);

// /api/me PATCH (display name) — lower-value target than the other four
// (authenticated, not brute-forceable), kept on the plain in-memory limiter.
const PROFILE_UPDATE_LIMIT = 30;
const PROFILE_UPDATE_WINDOW_MS = 60 * 60 * 1000;
export const checkProfileUpdateRateLimit = createRateLimiter(PROFILE_UPDATE_LIMIT, PROFILE_UPDATE_WINDOW_MS);

// Keyed by IP — a verification token is already unguessable (32 random
// bytes), so this bounds brute-force *guessing* attempts against the token
// space, not a per-account concern the way login's limiter is.
const VERIFY_EMAIL_LIMIT = 20;
const VERIFY_EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const checkVerifyEmailRateLimit = createRateLimiterAsync(VERIFY_EMAIL_LIMIT, VERIFY_EMAIL_WINDOW_MS);

// Keyed by IP+email, same shape as login's dual limiter — bounds how fast
// one address can be spammed with fresh verification emails.
const RESEND_VERIFICATION_LIMIT = 3;
const RESEND_VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
export const checkResendVerificationRateLimit = createRateLimiterAsync(
  RESEND_VERIFICATION_LIMIT,
  RESEND_VERIFICATION_WINDOW_MS,
);
