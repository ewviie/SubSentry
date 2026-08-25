# FINAL_PRODUCTION_AUDIT.md

> **⚠️ ARCHIVED — superseded by [SECURITY_STATUS.md](./SECURITY_STATUS.md) (2026-08-22).**
> Retained for historical narrative only. This file predates a full
> independent re-audit and 7-role adversarial council review that found
> several claims below stale or no longer accurate against current code
> (see SECURITY_STATUS.md for specifics and current verified state). Do not
> treat anything in this file as a current claim without re-checking it
> against the actual source first.

Two-part audit: (1) every finding from a CodeRabbit CLI review (`coderabbit review --uncommitted --include-untracked --agent`) against the current uncommitted working tree, triaged and fixed or explicitly rejected; (2) an independent senior-engineer pass across security, auth, permissions, API routes, database, performance, scalability, frontend, accessibility, testing, and production readiness, not limited to what CodeRabbit flagged. Builds on, and does not repeat, `PROJECT_SECURITY_MAP.md`, `SECURITY_HARDENING_REPORT.md`, `DATABASE_QUERY_AUDIT.md`, `SCALING_READINESS_REPORT.md`, `PRODUCTION_READINESS_REPORT.md`.

**Note on tooling**: there was no GitHub PR to pull "CodeRabbit comments" from — this repo has no `gh` CLI and no open PR (all work is uncommitted on `main`). What was actually available and used is CodeRabbit's local CLI (`coderabbit`/`cr`, already authenticated), run via `coderabbit review --uncommitted --include-untracked --agent` against the full uncommitted+untracked diff.

---

## Part 1 — CodeRabbit findings (19 total)

Every finding was read in full, verified against the actual current source (not assumed correct), and either fixed with a proof (test, or a real DB-integration run) or rejected with reasoning below.

| # | File | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | `src/app/api/auth/login/route.ts` | No aggregate IP-only rate limit; only IP+email and per-email buckets exist, so a password-spray attack (many accounts, one IP) isn't bounded | **Confirmed** | Added `checkLoginIpRateLimit` (30/15min, `src/lib/auth/rate-limit.ts`), applied before password verification |
| 2 | `.env.example` | Production shouldn't silently fall back to logging verification links | **Confirmed** | Documentation updated to match fix #7 |
| 3 | `drizzle/0004_small_blink.sql` | `login_attempts` has no expiry/index for cleanup | **Confirmed, alternate fix** | Did **not** edit the migration (already-applied files are never edited) or add a new column/index (this table has low cardinality — one row per email that's ever failed a login — so a sequential scan for a periodic sweep is cheap; DATABASE_QUERY_AUDIT.md's own stated philosophy is not to pre-index a pattern that doesn't need it). Instead added `deleteStaleLoginAttempts()` using the existing `updatedAt` column, plus `scripts/cleanup-stale-login-attempts.ts` (mirrors `cleanup-expired-sessions.ts`) and a `db:cleanup-login-attempts` npm script |
| 4 | `.github/workflows/ci.yml` | `--audit-level=critical` silences a genuinely *new* high-severity finding | **Confirmed** | Added `npm-audit-baseline.json` + `scripts/check-npm-audit.mjs`: runs the real audit, fails only for a high/critical finding in a package not already in the baseline. Verified it actually fails on an unbaselined package (manual test, see below) and passes on the current, unmodified state |
| 5 | `src/app/(auth)/verify-email/page.tsx` | Success-path `setTimeout` never cleared; fires `router.push`/`refresh` after unmount | **Confirmed** | Tracked the timer and cleared it in the effect's cleanup |
| 6 | `src/lib/auth/lockout.ts` | Stale comment claiming test coverage is "manual only"; no DB-integration test | **Confirmed** | Comment corrected; added `lockout.db.test.ts` (5 tests, DB-integration, same pattern as `queries.idor.test.ts`) |
| 7 | `src/lib/auth/email.ts` | Unconfigured `RESEND_API_KEY` logs a live single-use auth token to logs even in production | **Confirmed** | Now throws in production (caught by existing signup/resend-verification try/catch → generic client response, `logServerError`); still logs in dev/test as before |
| 8 | `src/lib/auth/lockout.ts` | `recordFailedLogin`'s `!row.lockedUntil` check never re-fires once a lock has ever been set — **brute-force protection permanently disabled after the first lock cycle expires** | **Confirmed — highest-severity finding, real bug** | Changed the guard to check whether `lockedUntil` is in the *future* (an active lock), not merely non-null (has-ever-been-locked). Proven with a DB-integration regression test that simulates an expired lock and confirms re-locking |
| 9 | `src/lib/auth/email-verification.ts` | `issueVerificationToken`'s delete-then-insert isn't atomic; concurrent calls (double-clicked resend) can leave two valid tokens for one user | **Confirmed** | Added a unique constraint on `email_verification_tokens.userId` (migration `0006_married_sinister_six.sql`, additive) and changed `issueVerificationToken` to a single upsert. Proven with a new concurrent-issuance regression test (asserts exactly one row, exactly one valid token) |
| 10 | `PROJECT_SECURITY_MAP.md` | Known-gaps section stale (says "no email verification", "no CI/CD", etc. — all now implemented) | **Confirmed** | Rewrote the section to reflect actual current state, struck through resolved items, kept real remaining gaps |
| 11 | `PROJECT_SECURITY_MAP.md` | "`/api/* EACH calls getSession()`" doesn't call out the public exceptions (webhook, pre-auth routes) | **Confirmed** | Clarified with the two exception classes named explicitly |
| 12 | `src/app/(auth)/signup/page.tsx` | `CheckEmailCard` swaps in with no focus move or live-region announcement — screen reader users get no cue | **Confirmed** | Added a focusable, auto-focused heading (`tabIndex={-1}` + `useEffect`) and `role="status" aria-live="polite"` on the description |
| 13 | `scripts/install-git-hooks.sh` | Hardcodes `$GIT_DIR/hooks`, ignoring `core.hooksPath`; silently overwrites any existing hook | **Confirmed** | Resolves the real hooks directory via `git rev-parse --git-path hooks`; refuses to overwrite a pre-commit hook that doesn't already look like this script's own (idempotent re-install still works) |
| 14 | `src/lib/observability/log-security-event.test.ts` | Asserts raw email/IP pass through — CodeRabbit wants them redacted/fingerprinted | **Rejected (redaction), partially confirmed (ordering)** | See reasoning below — kept raw values (redacting would defeat the log's purpose), but fixed the real gap: added a regression test proving reserved fields (`level`/`event`/`timestamp`) can't be overridden by caller-supplied `meta` |
| 15 | `src/lib/observability/log-error.ts` | Unrestricted `meta` type; wants `error.message` replaced with a controlled code | **Partially confirmed** | Fixed the one real, low-cost gap: reserved fields (`level`/`context`/`message`/`timestamp`) now always win over same-named `meta` keys (spread-then-override, reordered). Rejected stripping `error.message` — see reasoning below. Rejected the full allowlisted-type-per-callsite refactor as disproportionate churn for no call site that currently misuses it |
| 16 | `src/lib/subscriptions/queries.idor.test.ts` | `afterAll` references `userA`/`userB` directly; a mid-setup failure could throw again in cleanup and mask the real error | **Confirmed** | Track created ids incrementally in an array; clean up only what was actually created |
| 17 | `src/lib/observability/log-security-event.ts` | Same redact-and-restrict ask as #14, plus reserved-field spread order | **Rejected (redaction), confirmed (ordering)** | Same as #14 |
| 18 | `src/lib/rate-limit-distributed.ts` | No fetch timeout; a malformed-but-200 Upstash pipeline response isn't validated, silently denying every request | **Confirmed — real availability bug** | Added `AbortSignal.timeout(2000)` to the Upstash fetch; validate the pipeline result is a finite number before using it (throws → existing catch → in-memory fallback, otherwise). 3 new tests covering malformed response, abort/timeout, and the signal actually being passed to `fetch` |
| 19 | `src/lib/env.ts` | Missing half-configured-pair check for `UPSTASH_REDIS_REST_URL`/`TOKEN` | **Confirmed** | Added to the pairs list (with a fixed, non-generic "import" wording bug in the shared message noticed and fixed along the way) |

### Rejected findings — reasoning

**#14/#17 — redacting/fingerprinting email and IP in security-event logs.** Rejected. `logSecurityEvent` exists so a human reviewing production logs can see *which* IP/email a brute-force or lockout spike is coming from — that is the entire value of the log line. Redacting or hashing those fields would make the log line unable to answer "is this one attacker or many," "which account is under attack," which is the log's only job. This app already treats email/IP as ordinary application data elsewhere (stored in plaintext in `users`/`sessions`, sent in normal request bodies) — there's no confidentiality boundary being crossed by also putting them in a security log intended for the same operators who already have DB access. What *was* a real, if narrow, gap — a future call site (or a key that happened to collide) overwriting the log's own `level`/`event` — is fixed.

**#15 — replacing `error.message` with a controlled error code.** Rejected. This was a deliberate, already-audited decision from `SECURITY_HARDENING_REPORT.md` §4: every `Error` thrown in this codebase describes *what* failed (a status code, an operation name), never interpolates a secret/token/request body — confirmed again in this pass by grep, zero exceptions found. Stripping `error.message` to a static code would remove the one piece of information that makes `logServerError` useful for debugging a real incident, to guard against a class of leak that was already checked and ruled out.

---

## Part 2 — Independent audit

Went beyond CodeRabbit's diff-scoped review: read all 22 API routes in full (not just the ones CodeRabbit flagged), `src/proxy.ts`, session/password/token-encryption/client-ip modules, the Stripe webhook, and did targeted sweeps for `dangerouslySetInnerHTML`, open redirects, `localStorage`/`sessionStorage`/`document.cookie` usage, missing `alt`, and unused indexes.

### Findings

1. **`billing/portal` route didn't log failures server-side** (performance/production-readiness). Every other genuine-failure path in this codebase calls `logServerError` on a 5xx (audited and confirmed in `SECURITY_HARDENING_REPORT.md` §4); this one route — a Stripe REST call that can fail from a network error, a non-OK response, or a malformed body — swallowed all three silently. **Fixed**: wrapped the `fetch` in try/catch and added `logServerError` on all three failure paths, consistent with the established pattern.

2. **`subscriptions_user_status_idx (userId, status)` appears to be a dead index.** Grepped every call site of `listSubscriptions`/`getDashboardData` and every other subscriptions query: nothing anywhere in the codebase issues a query filtered by `status` at the SQL level — every caller fetches all of a user's rows (`WHERE userId = ?` only) and filters `status` in application code (dashboard, analytics, insights, savings, the `/api/subscriptions` POST limit check, `/api/imports/confirm`'s limit check — all the same pattern). This index costs write overhead on every subscription insert/update/delete for zero read benefit today. **Not fixed** — flagged only. Dropping it would require a new migration for uncertain benefit (the write cost of one small extra index on a low-write-volume table is negligible in practice), and it may have been added ahead of a not-yet-built status-filtered query. Worth revisiting if a genuinely status-filtered query pattern gets added, or dropping outright if one doesn't materialize.

3. **`CardTitle` renders a `<div>`, not a heading element**, across every usage in the app (`src/components/ui/card.tsx`). `PRODUCTION_READINESS_REPORT.md`'s accessibility pass confirmed "one `<h1>` per page, correct heading hierarchy" for page-level structure, but every `CardTitle` — used pervasively across dashboard/settings/subscriptions/auth cards — sits outside that hierarchy entirely rather than participating in it as an `<h2>`/`<h3>`. **Not fixed** — this is a shared primitive used in dozens of places; changing its rendered tag needs a review of every call site's surrounding heading level to avoid skipping levels (e.g., a card inside a section that already has its own `<h2>`), which is a proportionate follow-up task on its own, not a one-line fix bundled into this pass.

4. **No new authz/IDOR issues found.** Every mutating route re-verified in this pass (`subscriptions/[id]`, `billing/activate`, `imports/confirm`) either checks `userId` in the query's `WHERE` clause or explicitly checks resource ownership before acting (`billing/activate`'s `checkout.userId !== session.user.id` check, confirmed to run *before* the already-activated shortcut, so a stolen `checkoutSessionId` can't be used to read another user's activation state either).

5. **No XSS/open-redirect/client-side-storage issues found.** Zero `dangerouslySetInnerHTML` in the codebase. Every `NextResponse.redirect` target is either a hardcoded path or built from `request.url`'s own origin, never an attacker-controlled destination. No `localStorage`/`sessionStorage`/`document.cookie` usage anywhere — session state lives exclusively in the httpOnly cookie, consistent with what the existing reports claim.

6. **Rate limiter memory bounds confirmed correct.** `src/lib/rate-limit.ts`'s in-memory limiter already sweeps expired buckets (at most once per window) — not a leak, contrary to what might be assumed from "in-memory, never explicitly documented as bounded" in the existing reports.

---

## Verification

Run twice: once without `DATABASE_URL` (CI-like, DB-integration tests skip cleanly) and once against the local dev DB with the new migration applied (proves the actual fixes, not just that the suite skips them).

```
npm run lint         ✅ clean
npm run typecheck    ✅ clean
npm run db:migrate   ✅ applied 0006_married_sinister_six.sql (new unique constraint) cleanly
npm test              ✅ 385 passed, 0 failed (with DATABASE_URL — every DB-integration test, including
                          the new lockout-reactivation and token-upsert-race regression tests, ran for real)
npm run build         ✅ clean, all 38 routes present
npm run test:e2e      ✅ 11 passed (Playwright, chromium) — including full signup→verify→login, IDOR,
                          XSS-inert, oversized-payload flows, all still green after the email.ts
                          production-throw change (verified the E2E harness mints its own token via
                          direct DB access, not by reading the now-removed prod console.log)
```

`scripts/check-npm-audit.mjs` (new CI gate) manually verified both ways: passes cleanly against the current repo state (5 known packages, all pre-existing and baselined), and was confirmed to actually fail (exit 1) when a baseline entry was removed to simulate a genuinely new finding — then restored.

## Remaining risks (unchanged from prior reports unless noted)

Carried forward from `PRODUCTION_READINESS_REPORT.md`'s deployment checklist — nothing in this pass closes these, they're deployment/ops decisions, not code gaps:

- Branch protection on `main` requiring CI checks still needs to be enabled manually in GitHub Settings.
- `RESEND_API_KEY`/`RESEND_FROM_EMAIL` still need a real value before production signup can complete — **now enforced at runtime**: production without it throws instead of silently degrading (this pass's fix #7), so a misconfigured production deploy fails loudly on first signup attempt instead of quietly leaking tokens to logs.
- `UPSTASH_REDIS_REST_URL`/`TOKEN` still optional; distributed rate limiting recommended before multi-instance deployment.
- The 5 pre-existing high-severity `npm audit` findings (`brace-expansion`, `fast-uri`, `next`, `postcss`, `sharp`) are unchanged — no fix is available without a breaking-change dependency bump (`npm audit fix --force`), which was not attempted given the risk of destabilizing Next.js itself for an unreviewed major-version jump. They're now explicitly tracked in `npm-audit-baseline.json` rather than implicitly hidden behind `--audit-level=critical`.
- Signup's `email_taken` 409 still confirms account existence for a taken email — pre-existing, deliberately unchanged (documented enumeration tradeoff, out of scope for this pass).
- `CardTitle`/dead-index findings above (#3, #2 in Part 2) — flagged, not fixed, follow-up work.

## Files changed this pass

**New**: `src/lib/auth/lockout.db.test.ts`, `scripts/cleanup-stale-login-attempts.ts`, `drizzle/0006_married_sinister_six.sql` (+ meta snapshot), `npm-audit-baseline.json`, `scripts/check-npm-audit.mjs`, `src/lib/observability/log-error.test.ts`, `FINAL_PRODUCTION_AUDIT.md`.

**Modified**: `src/lib/auth/rate-limit.ts`, `src/app/api/auth/login/route.ts`, `src/lib/auth/lockout.ts`, `src/lib/auth/email.ts`, `.env.example`, `src/lib/auth/email-verification.ts` (+`.test.ts`), `src/lib/db/schema.ts`, `PROJECT_SECURITY_MAP.md`, `src/app/(auth)/verify-email/page.tsx`, `src/app/(auth)/signup/page.tsx`, `scripts/install-git-hooks.sh`, `src/lib/subscriptions/queries.idor.test.ts`, `src/lib/observability/log-security-event.ts` (+`.test.ts`), `src/lib/observability/log-error.ts`, `src/lib/rate-limit-distributed.ts` (+`.test.ts`), `src/lib/env.ts` (+`.test.ts`), `.github/workflows/ci.yml`, `src/app/api/billing/portal/route.ts`, `package.json`.

---

## Addendum — independent human-style security review (source-only, no report trusted)

A separate pass, explicitly re-reading source rather than any of the above reports, focused on authn/authz/IDOR/privilege-escalation/data-leakage/secrets/billing/races/concurrency/transactions/API-abuse/rate-limiting/frontend/XSS/CSRF/CSP/privacy/deployment risk.

### Real issue found and fixed

**TOCTOU race in the subscription-count limit check — `POST /api/subscriptions` and `POST /api/imports/confirm`.**

- **Exploit scenario**: both routes read "how many subscriptions does this account already have" with a plain `SELECT`, compared it against `MAX_ACTIVE_SUBSCRIPTIONS` (2000) and, for a free-plan user, `FREE_PLAN_SUBSCRIPTION_LIMIT` (5), then did a separate `INSERT` if under the limit. Nothing serialized two concurrent requests for the same account: both could read the same "under the limit" count before either's insert committed, and both would proceed. A user firing a burst of concurrent requests (trivial from a browser devtools console or a two-line script) could land more rows than either limit allows.
- **Severity**: **Low today, Medium once monetization resumes.** `MAX_ACTIVE_SUBSCRIPTIONS` is a defensive ceiling only reachable after sustained hours of rate-limited creation (60/hr), so the practical overshoot today is small. `FREE_PLAN_SUBSCRIPTION_LIMIT` (5) is currently unenforceable regardless of this race — `BETA_ALL_ACCESS = true` in `lib/billing/plan.ts` makes `hasReachedSubscriptionLimit` always return `false` — but the race is live in the code path today and will let a free-tier user bypass the paywall by racing a burst of concurrent requests the moment `BETA_ALL_ACCESS` is turned off, with no code change needed to trigger it.
- **Fix**: extracted the check-then-insert into `createSubscriptionWithLimitCheck`/`createSubscriptionsBulkWithLimitCheck` (`src/lib/subscriptions/queries.ts`), each wrapped in a `db.transaction` holding a Postgres advisory lock (`pg_advisory_xact_lock(hashtext(userId))`) scoped to the calling user for the transaction's duration — a second concurrent request for the same account blocks until the first commits or rolls back. Removed the now-dead, now-unsafe-if-reused `bulkCreateSubscriptionsFromImport` helper it replaced.
- **Tests**: `src/lib/subscriptions/queries.concurrency.test.ts` (new, DB-integration) — fires 15 concurrent single creates and asserts exactly 15 rows land with no duplicate/lost ids; fires 2 concurrent bulk-confirm batches and asserts exactly 5 rows land; confirms a lock held for one user never blocks or corrupts a concurrent create for a different user.
- **Verification honesty**: this environment has no Docker and the local dev DB (PGlite) runs with a single (`max: 1`) connection pool — concurrent requests against it serialize by pool-queuing alone, so the new test passes locally regardless of whether the advisory lock is present or correct. It proves the function's row-count/type correctness, not that the lock itself prevents the race under true multi-connection concurrency. CI's Postgres 16 service container (`max: 5`, real parallel connections) is where this test actually exercises the race; a real production deployment (Neon/Supabase/Docker, also `max: 5`) is in the same position. Not claiming more than that.

### Areas reviewed with no new issue found

- **Auth bypass**: `getSession()`/`requireUser()`, `verify-email`/POST route (atomic single-use token consumption, session only created after success), login's dummy-hash timing-equalization, lockout — all re-read fresh, no bypass found beyond the lockout-reactivation bug already fixed in the CodeRabbit pass above.
- **IDOR/BOLA**: every mutating route re-checked (`subscriptions/[id]`, `billing/activate`'s ownership check runs *before* its already-activated shortcut) — all scope by `userId` in the query or an explicit ownership comparison.
- **Payment/billing**: Stripe webhook re-read in full — HMAC verification with 5-minute replay-tolerance window, timing-safe comparison, multi-signature support for secret rotation, idempotency via a `stripeEvents` unique-id table wrapping the whole handler in one transaction. No issue found.
- **Secrets**: no `NEXT_PUBLIC_*` var carries anything beyond a public URL; grepped for `document.cookie`/`localStorage`/`sessionStorage` — none exist, session state lives only in the httpOnly cookie.
- **Frontend/XSS/CSRF**: zero `dangerouslySetInnerHTML` in the codebase; zero `target="_blank"` without `rel="noopener noreferrer"`; every `NextResponse.redirect` target is a hardcoded path or built from the request's own origin, never attacker-supplied.
- **GDPR/privacy — gap noted, not fixed**: no self-service account-deletion flow exists anywhere in the app. This is a real gap for GDPR's right-to-erasure, but it's a missing *feature*, not a bug in existing code, and building one is a product/legal scope decision (same category as `PRIVACY.md`'s already-documented draft-not-reviewed status) — flagged here rather than built without being asked.

### Verification (this addendum's changes)

```
npm run lint         ✅ clean
npm run typecheck    ✅ clean
npm test              ✅ 388 passed (up from 385; +3 new concurrency tests), DB-integration tests ran for real
npm run build         ✅ clean, all 38 routes present
npm run test:e2e      ✅ 11 passed — including the two tests that POST through the rewritten
                          /api/subscriptions route directly in a real browser
```
