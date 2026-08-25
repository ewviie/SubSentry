# SECURITY_HARDENING_REPORT.md

> **⚠️ ARCHIVED — superseded by [SECURITY_STATUS.md](./SECURITY_STATUS.md) (2026-08-22).**
> Retained for historical narrative only. This file predates a full
> independent re-audit and 7-role adversarial council review that found
> several claims below stale or no longer accurate against current code
> (see SECURITY_STATUS.md for specifics and current verified state). Do not
> treat anything in this file as a current claim without re-checking it
> against the actual source first.

Phase 2 of the security hardening mission. Continues from `PROJECT_SECURITY_MAP.md` and `.claude/rules/security.md`. Every item below was verified against actual code (grep/read across all 20 API routes, all Drizzle query modules, all Zod schemas), not assumed.

## Areas audited

1. API route security (all 20 route.ts files)
2. Input validation (all Zod schemas / boundary inputs)
3. Database security (all Drizzle query modules)
4. Error handling & logging
5. Security regression tests
6. Email verification (Phase 3 — see its own section below)

---

## Findings & fixes

### 1. API route security

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | `PATCH`/`DELETE /api/subscriptions/[id]` had no rate limit at all — a leaked session could hammer either with no throttle | Medium | Added `checkSubscriptionMutateRateLimit` (60/hr), applied to both handlers |
| 2 | `POST /api/billing/activate` had no rate limit despite a DB round trip + user.plan write per call | Low | Added `checkActivateRateLimit` (20/hr) |
| 3 | `PATCH /api/me` (display name) had no rate limit | Low | Added `checkProfileUpdateRateLimit` (30/hr) |
| 4 | `request.json()`/`request.formData()` fully buffer the body into memory *before* any size check runs (a provider's own `maxFileSizeBytes` check on `imports/analyze` only fires after the whole multipart body is already parsed) | Medium | Added `Content-Length` precheck (`src/lib/http/request-size.ts`) to the two pre-auth public routes (`login`, `signup`), the file-upload route (`imports/analyze`, 10MB ceiling above every provider's own 5MB limit), and the public webhook (`stripe/webhook`, 256KB ceiling) |
| — | HTTP method validation | N/A | Next.js App Router auto-405s any method a route.ts doesn't export — verified, no per-route work needed |
| — | Missing auth/authz checks | None found | All 20 routes call `getSession()`/check ownership; see IDOR section below |
| — | Error responses leaking internals | None found | Every catch block returns a fixed, generic message; zero routes interpolate `error.message`/stack into a response |

**Not changed, with reasoning:**
- `truelayer/callback` — no rate limiter added. It requires a real, single-use TrueLayer-issued `code` plus a CSRF state cookie minted by the already-rate-limited `/authorize` route; an attacker can't reach it repeatedly without first burning through that upstream limiter.
- `imports/confirm`, `imports/plaid/exchange`, `subscriptions` POST, `quick-add` — no Content-Length precheck added. All are authenticated + already rate-limited + small bounded JSON (confirm caps at 200 rows); the marginal value didn't justify the churn per "avoid unnecessary rewrites."

### 2. Input validation

Audited every Zod schema (`subscriptions/validation.ts`, `imports/validation.ts`, and every route's inline schema). **No gaps found**: every string field has a length cap, every numeric field has a range check, every closed set uses `z.enum`, dates are calendar-validated (not just regex-shaped), and no schema uses `.passthrough()` — Zod's default strip behavior means unexpected fields (e.g. a client trying to smuggle `isAdmin` or `userId`) are silently dropped, never stored, never erroring in a way that leaks schema shape. Added adversarial regression tests to prove this (see Testing section) rather than just re-reading the schema.

### 3. Database security

- **No raw SQL string interpolation anywhere** — the only `sql\`...\`` usage (`lockout.ts`'s atomic increment) uses Drizzle's parameterized template, not string concatenation.
- **No `.execute()` raw-query usage** — 100% of DB access goes through the Drizzle query builder.
- **No mass-assignment** — every mutation builds an explicit field list (`if (input.x !== undefined) values.x = ...`); nothing spreads a request body directly into `.set()`/`.values()`.
- **Ownership scoping verified for every user resource**: `getSubscription`/`updateSubscription`/`deleteSubscription` all require `AND userId = :userId AND id = :id`; a client-supplied `id` alone is never sufficient. **Proven with a real IDOR test against the DB** (see below), not just re-reading the WHERE clause.
- **Sensitive fields never over-exposed**: `getSession()` explicitly column-lists (excludes `passwordHash`); `/api/me` and `/api/auth/login` never return more than `{id, email, name, plan}` or `{ok:true}`.
- **Transactions used where required**: `billing/activate` and `stripe/webhook` both wrap their multi-statement writes (user.plan + checkoutSessions.status) in `db.transaction`.

No fixes needed in this area — verified clean.

### 4. Error handling & logging

- Confirmed **zero** routes leak `error.message`, stack traces, or raw DB errors to the client — every catch returns a fixed message (pre-existing, verified not assumed).
- Confirmed **zero** secrets/tokens/passwords ever appear in a `console.*` call anywhere in the codebase (only 3 client-side React error-boundary `console.error(error)` calls, which log to the browser console, not a server log, and Next.js already redacts server error details from that object in production).
- **Gap found and fixed**: the app had **no server-side error logging at all** — every unexpected-failure catch block returned a safe client message but recorded nothing server-side, so a real production incident would be invisible. Added `src/lib/observability/log-error.ts` (`logServerError`), a minimal structured `console.error` wrapper that only ever logs a fixed set of safe fields (context tag, `error.message`, userId, a few named identifiers) — never a request body, token, or password. Wired into 7 genuine 5xx-class catches: `imports/confirm`, `ai/narrate-insights`, `imports/plaid/{link-token,exchange,sync}` (both decrypt and fetch failures), `imports/truelayer/{sync,callback}`.

### 5. Security regression tests (added)

| File | Covers |
|---|---|
| `src/lib/auth/lockout.test.ts` | Progressive-delay tiering (pure function) |
| `src/lib/http/request-size.test.ts` | Oversized-input rejection, missing/malformed Content-Length (fails open, documented why) |
| `src/lib/subscriptions/validation.test.ts` (extended) | Oversized name/notes, empty name, out-of-range/malformed amount (incl. formula/SQL-injection-shaped strings), invalid category enum, calendar-invalid date, **unexpected-field stripping** (mass-assignment attempt) |
| `src/lib/subscriptions/queries.idor.test.ts` (new) | **Real IDOR proof against a live Postgres instance**: user B cannot read, update, or delete user A's subscription via its real UUID; user A's data is provably unmutated after B's attempted update. Skips cleanly via `describe.skipIf` when `DATABASE_URL` is unset (this is the one DB-integration test in an otherwise pure-unit suite — justified because ownership scoping can't be proven by reading a query builder call, only by executing it) |
| `src/lib/billing/plan.test.ts` (prior session) | Beta entitlement bypass behavior |

**Not added**: true HTTP-level route-handler tests (constructing a `Request`, mocking `getSession()`/cookies, asserting a 401/429/413 status). The existing test suite has zero precedent for this — every other test is a pure function or, now, one DB-integration file — and building that harness from scratch was judged lower value than the DB-level IDOR proof above, which verifies the actual security-relevant boundary (the WHERE clause) rather than the HTTP plumbing around it.

---

## Phase 3: Email verification

Implements the flow specified in the mission: signup creates a pending (unverified) account, issues a single-use hashed token, emails a verification link; verifying activates the account and logs the user in; login is blocked until verified.

### Schema (migration `0005_giant_lionheart.sql`)

- `users.emailVerified` (boolean, **default `true`**) + `users.emailVerifiedAt` (nullable timestamp). The `true` default backfills every pre-existing row as already verified — this migration cannot lock out a current user. New signups explicitly override this to `false` in their own insert.
- `email_verification_tokens` (new table): `id`, `userId` (FK cascade), `tokenHash` (unique), `expiresAt`, `createdAt`. Only the sha256 hash is ever stored — same pattern as `sessions.tokenHash`.

### Token lifecycle (`src/lib/auth/email-verification.ts`)

- **Random**: `crypto.randomBytes(32)`, base64url-encoded (same primitive as session tokens).
- **Single-use**: consuming a token **deletes its row** inside a transaction — there is no "used" flag that a bug could mistake for still-valid; a second attempt with the same raw token always finds no row and returns `invalid`.
- **Expiring**: 24h TTL, checked against `expiresAt`; an expired token is deleted on the same request that discovers it, so a retry with the same token also gets `invalid`, never a second `expired`.
- **Invalidated on reissue**: `issueVerificationToken` deletes any prior outstanding token for that user first — requesting a new link kills every previously-mailed link for the same account.
- **Comparison**: lookup is `WHERE tokenHash = sha256(suppliedToken)` on a unique-indexed column — the same "constant-time enough" reasoning already used for session tokens (an indexed b-tree equality lookup doesn't leak a byte-by-byte timing signal the way a naive loop-compare would); no raw token is ever compared byte-by-byte in application code.

### Enumeration prevention

- **Login**: the `email_not_verified` check runs **only after** password verification succeeds — a wrong-password attempt against an unverified account still gets the generic `invalid_credentials`, so this new check adds no new way to distinguish "wrong password" from "no such account" for an attacker who doesn't already know the correct password.
- **Resend-verification**: always returns the identical generic response (`{ok:true, message:"If that email needs verification..."}`) whether the email doesn't exist, is already verified, or genuinely gets a new link — plus a matching artificial delay on the no-op path so response timing isn't a cheap tell either.
- **Verify-email**: `invalid_token` vs `expired_token` responses are distinguished (this is about the *token's* state, not account existence — the requester already possesses the link, so this isn't an enumeration vector).

### Email sending (`src/lib/auth/email.ts`)

No email provider was configured in this app (confirmed in Phase 1 discovery — no SMTP/Resend/SendGrid key existed anywhere). Rather than force a vendor choice or block the whole feature, this follows the same "leave the key unset, degrade gracefully" convention already used for `ANTHROPIC_API_KEY` (AI demo mode) and `STRIPE_SECRET_KEY` (billing portal hidden): `RESEND_API_KEY` unset logs the verification link server-side instead of emailing it, so signup → verify → login works end-to-end today. Set `RESEND_API_KEY`/`RESEND_FROM_EMAIL` to switch to real delivery with no other code change.

### New endpoints

- `POST /api/auth/verify-email` — `{token}`, rate-limited by IP (20/15min), creates a session on success (verifying and logging in are the same moment for the user).
- `POST /api/auth/resend-verification` — `{email}`, rate-limited by IP+email (3/15min), always generic response.

### Tests added

| File | Covers |
|---|---|
| `src/lib/auth/email-verification.test.ts` (new, DB-integration, skips without `DATABASE_URL`) | **Valid** token verifies + deletes row; **reused** token (second consume) fails; **invalid** (never-issued) token fails; **expired** token fails and stays failed on retry; reissuing invalidates the prior token |
| `src/lib/auth/rate-limit.test.ts` (new) | `checkVerifyEmailRateLimit`/`checkResendVerificationRateLimit` actually enforce a finite limit; per-key isolation |

### Infra fix required to run both DB tests together

Running `queries.idor.test.ts` and the new `email-verification.test.ts` concurrently (vitest's default file-parallelism) triggered the exact PGlite wire-protocol interleaving bug already documented and fixed once in `src/lib/db/index.ts` — two separate test-file connections to the local dev DB outside a transaction can corrupt the shared unnamed prepared statement. Fixed by setting `fileParallelism: false` in `vitest.config.ts` (negligible cost given the suite's sub-4s runtime).

---

## Verification

```
npm run typecheck   ✅ clean
npm run lint        ✅ clean
npm test            ✅ 337 passed (327 without DATABASE_URL; 10 DB tests skip cleanly)
npm run build        ✅ clean, all 38 routes present
```

## Files changed

**New (Phase 2 — API/DB/error hardening):**
- `src/lib/http/request-size.ts`, `.test.ts`
- `src/lib/observability/log-error.ts`
- `src/lib/subscriptions/queries.idor.test.ts`

**New (Phase 3 — email verification):**
- `src/lib/auth/email-verification.ts`, `.test.ts`
- `src/lib/auth/email.ts`
- `src/lib/auth/rate-limit.test.ts`
- `src/app/api/auth/verify-email/route.ts`
- `src/app/api/auth/resend-verification/route.ts`
- `src/app/(auth)/verify-email/page.tsx`

**Modified (Phase 2):**
- `src/app/api/subscriptions/[id]/route.ts` — rate limit on PATCH/DELETE
- `src/app/api/billing/activate/route.ts` — rate limit
- `src/app/api/me/route.ts` — rate limit on PATCH
- `src/app/api/auth/login/route.ts`, `signup/route.ts` — Content-Length precheck
- `src/app/api/imports/analyze/route.ts` — Content-Length precheck (10MB)
- `src/app/api/stripe/webhook/route.ts` — Content-Length precheck (256KB)
- `src/app/api/ai/narrate-insights/route.ts`, `src/app/api/imports/{confirm,plaid/link-token,plaid/exchange,plaid/sync,truelayer/sync,truelayer/callback}/route.ts` — added `logServerError` to genuine 5xx catches
- `src/lib/subscriptions/rate-limit.ts` — new `checkSubscriptionMutateRateLimit`
- `src/lib/billing/rate-limit.ts` — new `checkActivateRateLimit`
- `src/lib/auth/rate-limit.ts` — new `checkProfileUpdateRateLimit`, `checkVerifyEmailRateLimit`, `checkResendVerificationRateLimit`
- `src/lib/subscriptions/validation.test.ts` — adversarial test cases added

**Modified (Phase 3):**
- `src/lib/db/schema.ts` — `users.emailVerified`/`emailVerifiedAt`, new `emailVerificationTokens` table; migration `drizzle/0005_giant_lionheart.sql`
- `src/lib/auth/session.ts` — `getSession()`'s column list now includes the two new fields
- `src/app/api/auth/signup/route.ts` — no longer auto-creates a session; issues + sends a verification token instead
- `src/app/api/auth/login/route.ts` — blocks unverified accounts (after password check)
- `src/app/(auth)/signup/page.tsx` — shows a "check your email" state instead of redirecting to the dashboard
- `src/app/(auth)/login/page.tsx` — surfaces a "resend verification email" action on `email_not_verified`
- `vitest.config.ts` — `fileParallelism: false` (see infra fix above)
- `.env.example` — documented `RESEND_API_KEY`/`RESEND_FROM_EMAIL`

## Remaining risks

1. ~~No email verification~~ — **implemented this phase.**
2. **In-memory rate limiters** (everything except the DB-backed login lockout and this phase's token/email limiters, which are all DB- or in-memory-consistent-with-the-rest) still reset on restart and don't share state across horizontally-scaled instances — acceptable for single-process deployment, a real gap at scale-out.
3. **No CI/CD** — still no automated gate or secret scanning in a pipeline; all tests here only run locally.
4. ~~No CSP~~ — **correction**: a nonce-based `Content-Security-Policy` with `strict-dynamic` script-src already exists in `src/proxy.ts` (missed in this report's original pass — see `PROJECT_SECURITY_MAP.md`'s correction note). `next.config.ts`'s baseline headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, now also `Strict-Transport-Security`) are a separate, additional layer, not the whole story.
5. **Content-Length precheck can be bypassed** by a client that omits the header or lies about it — documented as a known, accepted limitation; the authoritative defense remains each route's own per-field Zod validation and (for uploads) the provider's `maxFileSizeBytes` check after parsing.
6. **No real email provider configured** — verification links are logged server-side, not delivered, until `RESEND_API_KEY` is set (a deployment/business decision, not a code gap — see Phase 3's email-sending section above).
7. **Signup's `email_taken` 409** still confirms account existence for a *taken* email (pre-existing, documented in `PROJECT_SECURITY_MAP.md`) — this phase's resend/verify endpoints deliberately don't add a second enumeration vector on top of it, but didn't remove the original one either, since doing so changes existing signup UX and wasn't in scope here.
