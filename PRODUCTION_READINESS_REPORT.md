# PRODUCTION_READINESS_REPORT.md

Final phase of the production-hardening mission. Builds on `PROJECT_SECURITY_MAP.md`, `SECURITY_HARDENING_REPORT.md`, `DATABASE_QUERY_AUDIT.md`, and `SCALING_READINESS_REPORT.md` — this report indexes all of them plus the new work from this phase (accessibility, E2E testing, CI/CD, distributed rate limiting, caching, observability).

**Headline finding of this phase**: building the E2E test suite (task-required, not optional) surfaced a real, previously-unknown production bug — `src/proxy.ts`'s CSRF Origin-check compared against `request.nextUrl.origin`, which does not reliably reflect the true `Host` header (verified empirically: resolved to `"localhost"` while the real Host/Origin was `"127.0.0.1"`). This silently 403'd every legitimate same-origin state-changing request — including logout — the moment the app was reached by anything other than literally `localhost`. Fixed to compare against the raw `Host` header instead. This also corrected two factual errors in the Phase-1/2 reports, which had missed `src/proxy.ts` entirely (searched for the old Next.js "middleware.ts" filename; Next.js 16 renamed the convention to "proxy.ts") and so incorrectly reported "no middleware" and "no CSP" when both already existed.

---

## 1. Semantic markup — audited, largely already correct

Landing page and app shell already use `<header>`, `<nav aria-label>`, `<main id="main-content">`, `<footer>`, `<section>` per page section, one `<h1>` per page, correct heading hierarchy. Skip-to-content link and `lang="en"` already present at the root layout. No `<div onClick>` button-shaped-as-div anywhere in the codebase (checked via grep — zero matches).

**Fixed**: `trust-section.tsx` had no heading at all (3 trust-signal cards with no landmark label) — added a visually-hidden `<h2>` + `aria-labelledby` on the section, no visual change.

## 2. Accessibility (WCAG 2.2 AA) — audited, one real gap fixed

`focus-visible` already present on every interactive primitive (button, input, checkbox, select, textarea, accordion). Zero images without `alt`. Modals use Base UI (Radix-equivalent), which handles focus trap/ESC/`aria-modal` correctly out of the box. Reduced-motion respected globally via `MotionConfig reducedMotion="user"` plus per-component `motion-reduce:` classes already in place from prior polish rounds.

**Fixed**: the Import Center wizard's numbered stepper had no `aria-current="step"` — a screen reader had no way to tell which step was active. Added `aria-current`, `aria-hidden` on the decorative number/check icon, and an sr-only "(completed)" suffix per step.

## 3. Responsive / cross-browser — audited, honest limitation noted

Verified via code review (Tailwind responsive classes, `overflow-x-auto` wrappers on wide content, no fixed-pixel-width layout containers found). **Could not verify actual rendering in Safari, Firefox, or Edge** — this environment's browser automation is Chromium-only; claiming cross-browser verification without a real Safari/Firefox render would violate this mission's own "never claim something works without evidence" rule. Recommend a manual QA pass in real Safari/Firefox before a production launch, or extending the Playwright config with `webkit`/`firefox` projects (already trivial given the E2E suite that now exists — see below).

## 4. Frontend engineering quality — audited, no changes needed

No `setInterval`/`addEventListener` usage anywhere in the component tree (zero cleanup-leak risk from that pattern). No duplicated logic found beyond what earlier sessions already consolidated. Loading/empty/error states already present and consistent (shared `EmptyState` component used everywhere; every async action has a loading state). No changes made — this area was already solid from prior polish rounds documented in this repo's own history.

## 5. E2E testing — new (Playwright installed, 11 tests, all passing)

No browser-level tests existed before this phase. Added `@playwright/test` + `e2e/auth.spec.ts` + `e2e/security.spec.ts`, scoped to the highest-value journeys (per the mission's own priority ordering):

- Signup → check-email screen (not auto-login)
- Full signup → verify-email → login cycle, plus logout → re-login
- Login blocked pre-verification; wrong password generic error; invalid/expired token handling
- Unauthenticated access to `/dashboard` and `/settings` redirects to `/login`
- **IDOR**: a second authenticated user cannot GET/PATCH/DELETE the first user's subscription by id (404, not 403 — doesn't even confirm the resource exists), and cannot see its data by navigating to its URL directly
- **XSS**: an `<img onerror>`-shaped subscription name renders as inert text (no `alert()`, no script execution), confirmed via a `window` flag that never gets set
- **Oversized payload**: a 121-character name (over the 120 limit) is rejected with a real 400 from a direct API call, not just hidden by client-side truncation

**Deferred, explicitly**: the full journey list in the original mission spec (billing flows, settings edits, every CRUD path) — scoped down to auth + security-critical paths given this was a from-zero build in one phase. `npm run test:e2e` is the entry point for extending it.

**Real bugs found and fixed while building this suite** (this is the point of E2E testing — it exercises the real stack, not mocks):
1. The CSRF Origin-check bug described above (real, production-impacting, now fixed).
2. Two test-infrastructure discoveries, documented in code comments where relevant: Playwright's `page.request` API client doesn't apply Chromium's "localhost counts as a secure context" exception the way a real browser tab does, so a `Secure` session cookie (set because these tests build and run a real `next start` production server) was silently dropped on `page.request` calls — fixed by routing those calls through `page.evaluate(() => fetch(...))` instead, which runs in the real page context.

## 6. Database query audit — see `DATABASE_QUERY_AUDIT.md`

**No N+1 patterns, no missing indexes, no redundant fetches found.** Full audit trail in the dedicated file; one non-urgent index-shape observation noted (not acted on — premature for the current per-user cardinality).

## 7. Hosting / environment hardening

- **New**: `src/lib/env.ts` + `instrumentation.ts` — validates `DATABASE_URL` shape, `TOKEN_ENCRYPTION_KEY` byte length, and Plaid/TrueLayer/Stripe "half-configured" pairs once per server start (Next.js's `NEXT_RUNTIME === "nodejs"`-gated hook, never fires during `next build`'s static analysis). Logs clearly, doesn't throw — every feature already degrades gracefully per its own `isXConfigured()` check; this just makes a misconfiguration visible at startup instead of on the first request that needed it.
- **New**: `Strict-Transport-Security` header added (180 days, no `preload` — see `next.config.ts`'s comment on why preload is deliberately not enabled yet).
- **Corrected finding**: CSP already existed (`src/proxy.ts`, nonce-based, `strict-dynamic`) — see the headline finding above.
- **Cookies**: already `httpOnly`, `secure` in production, `sameSite: "lax"` (verified, unchanged).
- **CORS**: no explicit CORS headers exist anywhere — verified this is the correct, safe default (no cross-origin fetch reads this app's responses; combined with the CSRF Origin-check, cross-origin mutation is independently blocked too).
- **Migrations**: additive-only convention already followed throughout this project's history (every schema change this session generated a new migration file, never edited an applied one).

## 8. CI/CD — new

Added `.github/workflows/ci.yml` (lint, typecheck, unit/integration tests against a real Postgres 16 service container — not PGlite, sidestepping its documented local-dev fragility entirely — then production build; a second job runs the Playwright E2E suite against the built app) and `.github/workflows/codeql.yml` (JavaScript/TypeScript analysis, on PR/push/weekly schedule). Added `gitleaks/gitleaks-action` as a secret-scanning job with a `.gitleaks.toml` allowlisting the one known-fake local-dev credential in `.env.example`. Added an `npm audit --audit-level=critical` job (see note below on why not `high`).

**What this does NOT do, and why**: a workflow file cannot itself set a GitHub repo's "require status checks to pass before merging" branch protection rule — that's a repo Settings change requiring admin access, not something committable. **Action required from you**: enable branch protection on `main` requiring the `lint-typecheck-test-build`, `e2e`, and `secret-scan` checks, in GitHub's repo Settings → Branches.

**`npm audit` is gated at `--audit-level=critical`, not `high`**: this repo's current dependency tree already has 10 pre-existing findings (5 moderate, 5 high) in transitive devDependencies, unrelated to any code written in this session. Gating at `high` would fail this exact repo state on day one of enabling CI. Recommend triaging those existing findings separately, then ratcheting the CI gate down to `high` once clean.

Added a dependency-free pre-commit secret scan (`scripts/git-hooks/pre-commit` + `scripts/install-git-hooks.sh`) rather than introducing husky as a new dependency for one hook — requires `gitleaks` installed locally (skips with a warning, doesn't block, if absent) and one manual `sh scripts/install-git-hooks.sh` run per clone (documented in the script itself; `.git/hooks/` isn't version-controlled, so this can't be fully automatic without a package-manager-level hook tool).

## 9. Rate limiting — distributed backend added for the 4 auth-critical endpoints

New `src/lib/rate-limit-distributed.ts`: an Upstash Redis REST-backed limiter (plain `fetch()`, no new SDK dependency — same pattern as this app's existing Resend/TrueLayer integrations) with automatic in-memory fallback when `UPSTASH_REDIS_REST_URL`/`TOKEN` aren't set, and automatic fallback on any Redis-call failure (fails toward "still rate-limited by this instance," never toward "no limiting at all"). Migrated `login`, `signup`, `verify-email`, `resend-verification` to it — the four endpoints an actual distributed brute-force attempt would target.

**Scoped decision, documented**: the other ~11 rate-limited endpoints (billing, imports, AI, subscriptions, profile update) stay on the existing synchronous in-memory limiter. All are already behind an authenticated session (raising attacker cost substantially vs. the anonymous auth endpoints), and migrating all of them was judged lower-value than doing the 4 highest-value ones correctly within this phase's time budget. Noted as the natural next increment in `SCALING_READINESS_REPORT.md`.

## 10. Caching + CDN

- Added explicit `Cache-Control: no-store` on every `/api/*` response (`next.config.ts`) — defense-in-depth; every route was already dynamically rendered (cookie access disqualifies Next.js's automatic static optimization, confirmed in every build's route listing — all `ƒ Dynamic`, never `○ Static`), so this doesn't change behavior, it protects against a misconfigured CDN/reverse-proxy layer or browser back/forward cache.
- Static assets (`/_next/static/*`) already get Next.js's built-in long-lived immutable caching — no config needed, verified default.
- Images already go through `next/image` throughout the app (automatic optimization/responsive sizing) — no gap found.
- **Never cached**: confirmed no API response anywhere sets a cache-friendly header; the new blanket no-store header makes this explicit rather than implicit.

## 11. Error tracking / observability

- **New**: `src/lib/observability/log-error.ts` (from Phase 2, unexpected-failure logging, wired into 7 real 5xx catches) plus **new this phase**: `src/lib/observability/log-security-event.ts` — structured `security`-level logs for `login_failed`, `login_locked_out`, `login_rate_limited`, `csrf_rejected` (wired into `login/route.ts` and `proxy.ts`; `signup_rate_limited`/`verification_rate_limited` event types defined, not yet wired into every call site — noted as a follow-up, not overclaimed as done).
- **New**: `x-request-id` generated (or forwarded, if an upstream proxy already set one) in `proxy.ts`, present on every response header and forwarded to route handlers via the request — correlates a single request's logs. **Not yet threaded through every individual `logServerError`/`logSecurityEvent` call site** (would need the request/header object passed to each, a broader refactor) — the header exists and is real, but full per-log correlation is a scoped-out next step, stated plainly rather than implied as complete.
- Confirmed (again, in this phase) zero secrets/tokens/passwords ever appear in any log call anywhere in the codebase.
- **No external error-tracking service (Sentry, etc.) integrated** — this would require choosing and provisioning a real third-party service and API key, a product/cost decision for you to make, not something to fabricate a non-functional integration for.

## 12. Monitoring + alerts — plan, not implementation

No monitoring/alerting service is provisioned (would require a real account — Grafana Cloud, Datadog, Better Stack, or your hosting platform's built-in monitoring). Recommended plan:

| Signal | Where it already exists | What to wire up |
|---|---|---|
| Failed logins / lockouts / CSRF rejections | `logSecurityEvent` (this phase) | Ship stdout logs to your platform's log aggregation (Vercel Logs, or a log drain to Datadog/Better Stack); alert on a rate spike per IP/email |
| Unexpected 5xx errors | `logServerError` (Phase 2) | Same log shipping; alert on error-rate spike |
| Uptime | — | A pinger (UptimeRobot, Better Stack, or your platform's built-in health check) against `/` or a dedicated `/api/health` route (doesn't exist yet — trivial to add: a route that runs one cheap `db.select()` and returns 200/503) |
| API latency / DB performance | — | Your hosting platform's built-in metrics (Vercel Analytics, or APM if self-hosting) |
| Rate limit violations | Every `rate_limited` JSON response already has a distinct `error` field | Log-based alert once shipped |

## 13. Scaling readiness — see `SCALING_READINESS_REPORT.md`

Summary: stateless backend, DB-backed sessions, no background job infra (none needed yet), no file storage (none exists), rate limiting now partially distributed. Nothing blocks a modest multi-instance deployment.

## 14. Advanced security tests — new

- `src/lib/subscriptions/adversarial-input.test.ts`: SQL-injection-shaped and XSS-shaped payloads through the real `subscriptionInputSchema` (accepted as inert strings — proving they're bound as parameters, never concatenated, per the DB audit), oversized/null/array/wrong-typed rejection, a prototype-pollution-shaped key confirmed inert.
- `src/lib/rate-limit-distributed.test.ts`: Upstash-path and fallback-path both covered, including a simulated Redis outage falling back correctly.
- `src/lib/subscriptions/queries.idor.test.ts` (Phase 2) + `e2e/security.spec.ts` (this phase): IDOR proven at both the query layer and the full HTTP+browser layer.
- `src/lib/auth/lockout.test.ts` + `e2e/auth.spec.ts`: brute-force/lockout proven at both layers.
- Invalid HTTP methods: not separately tested — Next.js's App Router auto-405s any method a `route.ts` doesn't export; this is a framework guarantee, not app logic, so it wasn't re-tested.

---

## Verification (this phase, final run)

```
npm run lint        ✅ clean
npm run typecheck   ✅ clean
npm test            ✅ 370 passed (vitest; up from 337 last phase)
npm run test:e2e    ✅ 11 passed (Playwright, new this phase)
npm run build       ✅ clean, all 38 routes present
```

## Deployment checklist

- [ ] Enable GitHub branch protection on `main` requiring CI checks (see §8 — cannot be done from a workflow file)
- [ ] Set `TOKEN_ENCRYPTION_KEY` (32-byte base64) in production — required before any bank connection can be linked
- [ ] Decide on `RESEND_API_KEY`/`RESEND_FROM_EMAIL` — without it, verification emails only log server-side and no real user can complete signup
- [ ] Decide on `UPSTASH_REDIS_REST_URL`/`TOKEN` for distributed rate limiting on auth endpoints (recommended before any multi-instance deployment)
- [ ] Set `NEXT_PUBLIC_APP_URL` to the real production domain (currently unset — see `layout.tsx`'s own comment on the OG-image fallback)
- [ ] Triage the 10 pre-existing `npm audit` findings, then tighten CI's audit gate from `critical` to `high`
- [ ] Manually verify rendering in real Safari and Firefox (not verified in this environment — see §3)
- [ ] Provision a real monitoring/alerting service per the plan in §12
- [ ] Add a `/api/health` route if using an external uptime pinger
- [ ] Run `sh scripts/install-git-hooks.sh` locally (each contributor, once) for the pre-commit secret scan

## Rollback strategy

Not separately implemented this phase — existing safe defaults: migrations are additive-only (never edit an applied one; a bad migration is fixed by a new forward migration, not a rewrite), and `git revert` on the deploy commit remains the standard rollback path for application code. No destructive migration exists anywhere in this repo's history to roll back.
