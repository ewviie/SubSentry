import { createRateLimiterAsync } from "@/lib/rate-limit-distributed";
import { createRateLimiter } from "@/lib/rate-limit";

// Every limiter in this file is async and Redis-backed when
// UPSTASH_REDIS_REST_URL/TOKEN are configured (falls back to this
// process's own memory otherwise — see rate-limit-distributed.ts). These
// are specifically the authentication surfaces named in the
// production-readiness mission as needing distributed protection (login,
// signup, verify/resend, and forgot/reset-password — an account-takeover
// path as sensitive as login itself); every other limiter in the app
// (billing, imports, AI, subscriptions) stays on the simpler synchronous
// in-memory limiter — smaller blast radius, all already behind an
// authenticated session, and migrating every call site in one pass was
// judged lower value than doing these correctly.

// Keyed by IP+email so a credential-stuffing script grinding through many
// accounts from one IP gets bounded per account, without one attacker's
// traffic locking out other accounts sharing that IP.
const LOGIN_LIMIT = 5;
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

// Aggregate bucket keyed by IP alone, same reasoning as checkLoginIpRateLimit
// above: the IP+email bucket partitions by email, so a script sweeping many
// different target addresses from one IP never accumulates in it, each
// combo staying under its own fresh 3-per-15-minutes allowance. That's a
// real cost here (each request past the CAPTCHA/lookup stage triggers a
// genuine token issuance + outbound email send for whatever address is
// real), not just an enumeration concern. Generous limit for the same
// shared-IP reason as login's.
const RESEND_VERIFICATION_IP_LIMIT = 20;
const RESEND_VERIFICATION_IP_WINDOW_MS = 15 * 60 * 1000;
export const checkResendVerificationIpRateLimit = createRateLimiterAsync(
  RESEND_VERIFICATION_IP_LIMIT,
  RESEND_VERIFICATION_IP_WINDOW_MS,
);

// Keyed by IP+email, same shape and reasoning as
// checkResendVerificationRateLimit — bounds how fast one address can be
// spammed with fresh password-reset emails (each one invalidates the
// previous outstanding link, so this also bounds how often a legitimate
// user's own in-flight reset link gets yanked out from under them by repeat
// submits).
const FORGOT_PASSWORD_LIMIT = 3;
const FORGOT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
export const checkForgotPasswordRateLimit = createRateLimiterAsync(
  FORGOT_PASSWORD_LIMIT,
  FORGOT_PASSWORD_WINDOW_MS,
);

// Aggregate bucket keyed by IP alone, same reasoning as
// checkResendVerificationIpRateLimit — bounds a script sweeping many
// different target addresses from one IP, each of which would otherwise
// stay under its own fresh per-email allowance.
const FORGOT_PASSWORD_IP_LIMIT = 20;
const FORGOT_PASSWORD_IP_WINDOW_MS = 15 * 60 * 1000;
export const checkForgotPasswordIpRateLimit = createRateLimiterAsync(
  FORGOT_PASSWORD_IP_LIMIT,
  FORGOT_PASSWORD_IP_WINDOW_MS,
);

// Keyed by IP — a reset token is already unguessable (32 random bytes), so
// this bounds brute-force *guessing* attempts against the token space, not
// a per-account concern. Same shape as checkVerifyEmailRateLimit.
const RESET_PASSWORD_LIMIT = 20;
const RESET_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
export const checkResetPasswordRateLimit = createRateLimiterAsync(RESET_PASSWORD_LIMIT, RESET_PASSWORD_WINDOW_MS);

// Authenticated and low-frequency by nature (nobody deletes their account
// twice), but unlike checkProfileUpdateRateLimit/checkDisconnectRateLimit
// this route re-verifies a *password* (see api/account/route.ts) — the
// same "password-guessing oracle against an already-stolen session cookie"
// shape as login, not just a lower-value authenticated action. A
// process-local in-memory counter bounds that per-instance only: on a
// horizontally-scaled/serverless deployment (this app's target — see
// forgot-password/route.ts's after() comment), an attacker's requests can
// land on multiple warm instances, each with its own fresh 5-per-15-minute
// counter, so the *effective* ceiling scales with instance count instead of
// staying at 5. Distributed (keyed by user id alone — no IP-based
// second bucket the way login's dual limiter has, since the attacker here
// already holds one specific victim's session and there's no
// spray-many-accounts-from-one-IP scenario to separately bound).
const DELETE_ACCOUNT_LIMIT = 5;
const DELETE_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
export const checkDeleteAccountRateLimit = createRateLimiterAsync(DELETE_ACCOUNT_LIMIT, DELETE_ACCOUNT_WINDOW_MS);
