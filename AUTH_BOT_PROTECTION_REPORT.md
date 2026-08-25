# AUTH_BOT_PROTECTION_REPORT.md

> **⚠️ ARCHIVED — superseded by [SECURITY_STATUS.md](./SECURITY_STATUS.md) (2026-08-22).**
> Retained for historical narrative only. This file predates a full
> independent re-audit and 7-role adversarial council review that found
> several claims below stale or no longer accurate against current code
> (see SECURITY_STATUS.md for specifics and current verified state). Do not
> treat anything in this file as a current claim without re-checking it
> against the actual source first.

Production hardening pass focused on CAPTCHA/bot protection and email verification. Read `PROJECT_SECURITY_MAP.md`, `SECURITY_HARDENING_REPORT.md`, `FINAL_PRODUCTION_AUDIT.md`, `PRODUCTION_READINESS_REPORT.md`, and the actual current auth/email-verification source (not assumed from the reports) before changing anything. Every claim below is either a direct source read from this session or a live-verified result — real signups against the real Cloudflare Turnstile API, not just mocked tests — marked accordingly.

## 1. Audit — existing vulnerabilities found

**Bot protection: zero CAPTCHA anywhere (the one real gap).** Confirmed via grep across the entire codebase and all four security reports — no CAPTCHA/Turnstile/hCaptcha/reCAPTCHA reference existed before this pass. Signup and resend-verification were protected only by IP-based rate limiting (5/hr and 3/15min respectively), which has no defense against a distributed attacker rotating IPs or a slow-and-low script staying under the per-IP threshold. This is the headline finding this pass addresses.

**Everything else in the email-verification lifecycle was already solid**, re-verified against current source rather than trusted from the prior reports (two of the bugs listed below were real findings *fixed in an earlier phase this session* — re-confirmed still correct here, not re-discovered):

| Area | Status | Evidence |
|---|---|---|
| Token randomness | ✅ | `randomBytes(32)`, base64url — `email-verification.ts` |
| Token storage | ✅ | sha256 hash only, same pattern as session tokens — never the raw token at rest |
| Token expiry | ✅ | 24h TTL, checked in `consumeVerificationToken` |
| Single-use / replay prevention | ✅ | Atomic `DELETE ... RETURNING`, not select-then-delete — proven under real concurrency by `email-verification.test.ts`'s 10-concurrent-attempt test (exactly 1 succeeds) |
| Race conditions in issuance | ✅ (fixed earlier this session) | `issueVerificationToken` upserts on a unique `userId` constraint (migration `0006`) — the prior delete-then-insert version had a real window where a double-clicked resend could leave two valid tokens outstanding |
| Login lockout reactivation | ✅ (fixed earlier this session) | `recordFailedLogin` used to treat "has ever been locked" as permanent, silently disabling re-locking after the first lock expired — fixed to check whether `lockedUntil` is still in the future |
| Resend abuse/enumeration | ✅ | Generic response regardless of account state, timing-padded, rate-limited IP+email |
| Login behavior for unverified/verified users | ✅ | Checked only *after* password verification (no account-existence leak), 403 `email_not_verified` |

## 2. CAPTCHA implementation

**Provider: Cloudflare Turnstile**, chosen over hCaptcha and reCAPTCHA Enterprise. Reasoning: privacy-friendly (no cross-site ad-tracking cookie, no personal-data resale — closer to this app's own "we never sell your data" promise on the landing page than Google's reCAPTCHA), free at any volume (reCAPTCHA Enterprise bills per assessment), and its managed widget genuinely shows most real users no interactive challenge at all. The `siteverify` API shape is close enough to reCAPTCHA's that switching later wouldn't be a rewrite.

**Where it's applied**: `POST /api/auth/signup` and `POST /api/auth/resend-verification` only — the two truly public, unauthenticated, abuse-sensitive endpoints. Not added to login (already has DB-backed lockout + three-layer rate limiting from an earlier phase) or anywhere authenticated (session already raises attacker cost). No password-reset flow exists in this app to protect (confirmed, not a regression — never built).

**Backend** (`src/lib/security/captcha.ts`):
- `isCaptchaConfigured()` / `verifyCaptchaToken(token, ip, {expectedAction, expectedHostname})`.
- Never trusts a client-supplied "I passed" claim — every request makes its own server-side call to Cloudflare's real `siteverify` endpoint.
- Validates: token presence (rejected before any network call), Cloudflare's `success` field, a 5-second timeout (`AbortSignal.timeout`), non-OK HTTP status, malformed JSON — all fail **closed** (reject the request), unlike this app's rate-limiter which fails open to a fallback. Reasoning: a CAPTCHA gate's only job is turning away non-humans, so "Cloudflare didn't answer" is treated the same as "Cloudflare said no."
- **Action binding** (`expectedAction: "signup"` / `"resend_verification"`) is wired and enforced — a token solved on one form can't be replayed against the other. Fully within my control on both sides (I set the widget's `data-action` and check it server-side), so implemented with confidence.
- **Hostname binding** is implemented and unit-tested but deliberately **not wired to a live value** — Cloudflare's returned hostname format wasn't verified live in this session, and this app doesn't hard-require `NEXT_PUBLIC_APP_URL` (see `layout.tsx`'s own comment on why no production domain is configured yet). Wiring it with an unverified assumption risked silently breaking every signup; the capability exists for whoever sets a real domain to enable.
- Unconfigured (`TURNSTILE_SECRET_KEY` unset) → verification is **skipped entirely**, same "degrade gracefully" convention as every other optional integration in this app (Stripe/Plaid/TrueLayer/AI). Deliberately *not* given the same "throw in production" treatment as the email-sending fix from an earlier phase — an unconfigured CAPTCHA degrades to "still rate-limited, just not human-verified," a bounded gap, not an active credential leak the way logging a verification link would be. Flagged as a deployment checklist item below, not silently accepted.

**Frontend** (`src/components/auth/turnstile-widget.tsx`):
- Explicit render API (`turnstile.render()`), not implicit auto-render — gives real control over reset/loading/error states.
- Loading state (spinner + "Loading verification…"), error state (visible message, e.g. for a content blocker eating Cloudflare's domain), dark/light via `next-themes`' `resolvedTheme` (not Turnstile's own OS-level `"auto"`, which could disagree with a manual in-app theme override).
- Renders `null` entirely when unconfigured — the signup/login pages always render `<TurnstileWidget>` unconditionally; it's a no-op without env vars set.
- **Token is reset after every submit attempt**, success or failure — Turnstile tokens are single-use, so a retry after an unrelated failure (e.g. "email already taken") needs a fresh one queued up, not a silently-already-spent one.
- **CSP**: Turnstile requires loading a script and rendering a challenge iframe from `challenges.cloudflare.com`, which this app's existing nonce-based, `strict-dynamic` CSP didn't allow. Fixed `proxy.ts`'s `buildCsp()`: the script tag carries the same per-request nonce as every other script (threaded down via a new `NonceProvider` React context read from `headers()` in `(auth)/layout.tsx` — a genuinely new pattern for this codebase, since nothing previously needed the nonce outside Next.js's own framework scripts), and `frame-src`/`connect-src` were widened to that one specific Cloudflare origin only, never a wildcard. This is security-sensitive code; the risk and fix are stated in `proxy.ts`'s own comments, and `proxy.test.ts` (new, 7 tests) proves the CSP still forbids everything else while allowing exactly this one origin.

**Rate limiting integration**: existing `checkSignupRateLimit`/`checkResendVerificationRateLimit` are unchanged and still run *first* (cheap, no network call) — CAPTCHA verification runs after rate-limiting but before any expensive work (the DB lookup, and especially argon2 password hashing on signup), so a bot fails as cheaply as possible.

**Security event logging**: new `captcha_rejected` event type (`logSecurityEvent`), logs the endpoint and the rejection reason (`missing_token`/`invalid_token`/`verify_request_failed`/etc.) — never the token itself or any Cloudflare response body.

**Live-verified, not just unit-tested** (see §4): a real signup was completed end-to-end against Cloudflare's actual `siteverify` API using Cloudflare's own publicly documented test keys, in both directions (accepted and rejected), confirming the CSP, nonce, widget rendering, and server verification all genuinely work together — not just that each piece compiles in isolation.

## 3. Email verification improvements (this pass)

Beyond confirming the lifecycle was already solid (§1), two concrete additions:

- **Bounded retry on the Resend API call** (`src/lib/auth/email.ts`): up to 3 attempts with a short fixed backoff, but *only* for network errors and 5xx responses — a 4xx (bad API key, malformed request, invalid from-address) fails immediately since retrying a non-transient failure just delays the same outcome the caller already handles gracefully (log + let the user request a fresh link).
- **Environment validation** (`src/lib/env.ts`): flags `RESEND_API_KEY` set without `RESEND_FROM_EMAIL` at startup — without a real sending domain, verification emails go out from Resend's shared sandbox address, which has real deliverability implications for actual users, not just this app's own testing. Also added the `NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` half-configured-pair check, matching the existing Plaid/TrueLayer/Upstash pattern.

**Not added, deliberately**: a dedicated "delivery status tracking" table/subsystem. Resend's API call succeeding only means "accepted for delivery," not "delivered" — real delivery-status tracking needs Resend's own webhooks, a materially bigger integration than this pass's scope, and this app has no existing webhook-receiver pattern beyond Stripe's to extend. Retry + structured failure logging (`logServerError`, already wired) covers the actionable part of "delivery flow hardening" without inventing new architecture.

## 4. Tests added

**Unit** (mocked `fetch`, matching this repo's existing `rate-limit-distributed.test.ts` pattern):
- `src/lib/security/captcha.test.ts` (16 tests): `isCaptchaConfigured` true/false, missing/empty token, Cloudflare `success:false`, `success:true`, hostname match/mismatch/unchecked, action match/mismatch/unchecked, network error, timeout/abort, non-OK HTTP status, malformed JSON, and the defense-in-depth "called while unconfigured" case.
- `src/proxy.test.ts` (7 tests, new — `buildCsp` exported specifically to make this possible): nonce present, Turnstile origin present in script-src/frame-src/connect-src, `frame-ancestors`/`object-src`/`default-src` unwidened, dev-vs-prod `unsafe-eval`.
- `src/lib/env.test.ts` (+4 tests): Turnstile pair check, `RESEND_FROM_EMAIL` check.
- `src/lib/auth/email.test.ts` (10 tests, new): unconfigured dev-mode log, unconfigured production throw, first-attempt success, retry-then-succeed on 5xx, retry-then-succeed on network error, fail-fast on 4xx (no retry), exhausted-retries on persistent 5xx and persistent network error.

**E2E** (`e2e/captcha.spec.ts`, new, 3 tests) — direct API calls bypassing the widget entirely, proving server-side enforcement can't be defeated by skipping the frontend: missing `captchaToken` field, empty-string token, and the same for resend-verification. All return `400 captcha_failed`.

**The whole E2E suite now runs with CAPTCHA genuinely active**, not skipped: `playwright.config.ts`'s `webServer.env` sets Cloudflare's own publicly documented "always passes" test key pair (not secrets — safe to commit, published in Cloudflare's own testing docs). This means every pre-existing signup/resend-verification E2E test (in `auth.spec.ts` and `security.spec.ts`'s `createVerifiedUser` helper) now also proves the real integration end-to-end: script loads under the real CSP, widget renders and auto-solves, a real token round-trips to Cloudflare's actual API, signup succeeds. **Verified this doesn't break anything**: full suite re-run, 17/17 pass. Honest cost: the suite got slower (≈30s → ≈72s) because it's now doing real network round-trips instead of skipping captcha — a real, disclosed trade-off, not hidden.

**What was verified live but isn't automated**: rejection of a garbage/invalid token, checked by hand against a *real* (non-mocked) Cloudflare API call using the "always fails" dummy secret key — confirmed a `400 captcha_failed` response. Not automated because doing so would need a second, differently-configured Playwright `webServer`, which would meaningfully complicate the test setup for one already-covered case (the same rejection path is unit-tested with mocked `fetch`). Documented here rather than silently skipped.

## 5. Remaining risks

1. **CAPTCHA is off by default** until `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` are actually set in production — see the deployment checklist below. Signup/resend remain rate-limited either way, but without real bot-verification until configured.
2. **Hostname binding exists but isn't enforced** (see §2) — low urgency (action binding + Cloudflare's own token-origin enforcement already narrow the attack surface a stolen/replayed token would need), but worth wiring once `NEXT_PUBLIC_APP_URL` is set for a real domain and the returned hostname format is verified live against it.
3. **No delivery-status tracking** — a Resend "accepted" response doesn't guarantee inbox delivery; real tracking needs Resend webhooks, out of scope this pass (see §3).
4. **In-memory rate limiters on most other endpoints** — pre-existing, unrelated to this pass, already documented in `SCALING_READINESS_REPORT.md`.
5. Nothing else new — the rest of the auth surface was re-confirmed solid, not re-opened.

## 6. Production setup instructions

1. Create a Turnstile widget at https://dash.cloudflare.com/?to=/:account/turnstile (free, no billing, doesn't require proxying traffic through Cloudflare).
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public) and `TURNSTILE_SECRET_KEY` (server-only, never expose client-side) in production env.
3. Confirm `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (a real, verified sending domain, not the `onboarding@resend.dev` sandbox fallback) are both set — `validateEnv()` now warns at startup if only the API key is set.
4. Once a real production domain is set via `NEXT_PUBLIC_APP_URL`, revisit wiring `expectedHostname` into the two `verifyCaptchaToken` call sites (currently omitted — see §2/§5.2) after confirming Cloudflare's returned `hostname` format matches.
5. No other code changes needed — everything else in this pass degrades gracefully without configuration, matching this app's existing convention.

## Verification

```
npm run lint         ✅ clean
npm run typecheck    ✅ clean (caught and fixed one real type error: a read-only NODE_ENV
                          assignment in a new test that worked at runtime but failed strict typecheck)
npm test              ✅ 425 passed (up from 388 — 37 new: captcha 16, proxy/CSP 7, env +4, email 10)
npm run build         ✅ clean, all 38 routes present
npm run test:e2e      ✅ 17 passed (14 pre-existing + 3 new in captcha.spec.ts), run with CAPTCHA
                          genuinely configured and active — not skipped — verified twice
```
