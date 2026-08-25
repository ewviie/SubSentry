# SECURITY_STATUS.md

**This is the authoritative security status doc.** Every other
`*_REPORT.md`/`*_AUDIT.md`/`*_MAP.md` file at the repo root that predates
this one is now archived (marked with a banner at its own top) — read this
file first, and only open an archived one for historical narrative, never
as a source of current claims.

Last verified: 2026-08-22, via a full independent re-audit of the current
code (not a review of the archived docs) plus a 7-role adversarial council
(Application Security, Auth/Identity, Database Security, API Security,
AI/Prompt-Injection, Privacy/Compliance, Devil's Advocate) and a CodeRabbit
pass over the resulting changes. See git history around this date for the
exact diff.

**Standing rule for any future session:** do not trust this file's claims
either, past the point they were written. Code changes; this doc doesn't
automatically follow. Re-verify against the actual current source before
relying on any claim below, the same way this file was produced by
re-verifying against the archived docs instead of trusting them. See
`.claude/rules/security.md` for the mandatory process before touching
security-sensitive code.

## Fixes landed in this pass

- **Subscription reactivation bypassing the free-plan limit** (Medium,
  latent while `BETA_ALL_ACCESS=true` in `src/lib/billing/plan.ts`) —
  `updateSubscription` (`src/lib/subscriptions/queries.ts`) now re-checks
  `hasReachedSubscriptionLimit` when a status change activates a
  subscription that wasn't already active, inside the same advisory-locked
  transaction the create path uses. Regression tests:
  `queries.reactivation.test.ts`.
- **CPU-exhaustion DoS via unbounded O(n²) fuzzy duplicate-name matching**
  (High, confirmed by direct benchmark — 2000 subscriptions with
  worst-case names took 30+ seconds of blocking CPU per pass, run
  independently up to 4x per page load). Fixed with a shared, bounded
  (`MAX_DUPLICATE_COMPARISON_SUBSCRIPTIONS = 300`) pairwise-comparison
  helper (`forEachLikelyDuplicatePair`, `src/lib/subscriptions/insights.ts`)
  now used by `insights.ts`, `savings.ts`, and
  `insights-engine/signals.ts`. Regression tests in `insights.test.ts`
  include a 2000-row performance guard.
- **Rate limit checked after the expensive computation** in `POST
  /api/ai/narrate-insights` — added a non-consuming `.peek()` to the shared
  rate limiter (`src/lib/rate-limit.ts`) and check it before
  `computeInsights` runs.
- **Email-verification consume-then-update not transactional**
  (`src/lib/auth/email-verification.ts`) — wrapped in `db.transaction`,
  matching the pattern `consumePasswordResetToken` already used.
- **next-themes inline bootstrap script silently CSP-blocked on every page**
  (functional bug, not exploitable, but real — flagged during E2E
  verification of this pass) — `src/app/layout.tsx` now reads the
  per-request nonce (set by `src/proxy.ts`) and passes it to
  `<ThemeProvider nonce={...}>`; without it, next-themes' inline
  theme-detection script had no nonce, so this app's nonce-based CSP
  (no `'unsafe-inline'` in `script-src`) silently blocked it — dark/light
  theming never applied anywhere, with no visible error beyond a CSP
  violation in the browser console. Regression test: the inline-script
  nonce check in `e2e/static-page-hydration.spec.ts`.
- **PRIVACY.md updated** to disclose Gmail/Plaid/TrueLayer as data
  sources/processors (previously undisclosed — a real compliance gap) and
  to correct the claim that no self-service account deletion exists
  (it does, via Settings → Account; export is still manual-only).

## Current verified state by area

Verified directly against code in this pass; a "PASS" here means "no
confirmed issue found this pass," not "provably perfect."

| Area | Status | Notes |
|---|---|---|
| Authentication | PASS | Argon2id hashing, dummy-hash timing-equalized login, DB-backed atomic lockout (`lockout.ts`), CAPTCHA on signup/resend-verification, layered rate limiting. |
| Authorization / IDOR | PASS | Every subscription/import/connection query scopes by `userId`; ownership checked before any mutation. `billing/activate` checks ownership before its idempotent shortcut. |
| Database | PASS | 100% parameterized Drizzle queries, no raw string SQL concatenation, no mass assignment, advisory-lock transactions around every check-then-write race identified. |
| API | PASS (1 fix applied) | See narrate-insights fix above. CSRF (Origin/Referer vs. real `Host`), no CORS misconfig, request-size caps enforced by byte-counting (not spoofable `Content-Length`), cron endpoint fails closed without `CRON_SECRET`. |
| Input validation | PASS | Zod on every route that accepts a body/query. |
| XSS / CSRF / injection | PASS | Zero user-influenced `dangerouslySetInnerHTML` (4 uses total, all static JSON-LD). Origin/Host CSRF check in `src/proxy.ts`. No SQL injection surface. |
| Sessions | PASS | Opaque random token, hash-only storage, httpOnly/secure(prod)/SameSite=Lax, revoked on logout/password-reset. |
| OAuth / imports | PASS | State-parameter CSRF on Gmail/TrueLayer, tokens encrypted at rest (AES-256-GCM), read-only scopes (`gmail.readonly`), raw email/transaction content never persisted — only user-confirmed subscription drafts are. |
| AI security | PASS WITH ACCEPTED RISK | Prompt injection mitigated (not structurally eliminated) via explicit "treat as data" system-prompt framing; bounded blast radius (plain-text render, no side effects, requires user to confirm a suspicious name first). AI quota limiter is in-memory/per-process — bypassable across serverless instances, same accepted-risk pattern as other in-memory limiters in this app. |
| Rate limiting / abuse | PASS | Auth endpoints have distributed (Upstash) + in-memory fallback; most other endpoints are in-memory-only (accepted, documented). |
| DoS / performance | PASS (1 fix applied) | See O(n²) fix above. Import-side duplicate detection (`imports/detection.ts`) is still O(clusters × existing subscriptions) but bounded by existing caps to a few seconds worst case — lower severity, not fixed this pass. |
| Secrets | PASS | No secrets in git history or `.env.example` (placeholders only); no `NEXT_PUBLIC_*` var exposes a server-only secret. |
| Dependencies / supply chain | PASS WITH ACCEPTED RISK | `npm audit --omit=dev`: 0 vulnerabilities. Dev-only transitive deps (shadcn CLI's MCP SDK → hono; drizzle-kit → esbuild) carry known advisories but never ship to the production runtime. |
| Webhooks / payments | PASS | Stripe webhook: HMAC-SHA256 verification, timing-safe compare, replay-tolerance window, idempotent via a unique-constrained event-id table in one transaction. |
| Security headers / transport | PASS | Nonce-based CSP with `strict-dynamic`, `frame-ancestors 'none'`, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on `/api/*`. |
| Privacy / data handling | PASS WITH ACCEPTED RISK | PRIVACY.md updated this pass (see above) but is still explicitly an unreviewed legal draft — do not publish/link it until a lawyer reviews it. No DPA on file with any processor. |

## Known accepted risks (not fixed, tracked here on purpose)

- In-memory (non-distributed) rate limiters on most non-auth endpoints,
  including the AI daily-quota limiter — resets per-process, doesn't share
  state across serverless instances. Upgrading requires requiring Upstash
  Redis in production, which is currently optional.
- `src/lib/imports/detection.ts`'s cross-check of detected clusters against
  existing subscriptions is still O(clusters × existing), bounded by
  existing input caps to a few seconds worst case behind an already
  rate-limited (10/hour), deliberate-action endpoint — not a passive
  page-load risk like the one fixed this pass.
- Prompt-injection defense for Gmail-derived subscription names sent to
  `narrateInsights` is a system-prompt instruction, not a structural
  guarantee. Bounded impact (see table above).
- PRIVACY.md is legally unreviewed; no DPA on file with Stripe, Anthropic,
  Google, Plaid, or TrueLayer.

## Verification suite (last run this pass)

```
npm run typecheck   ✅ clean
npm run lint        ✅ clean
npm test            ✅ 756 passed, 0 failed (61 files, incl. real-Postgres DB-integration tests)
npm run build       ✅ clean, all routes present, same static/dynamic split as before
npm run test:e2e    ✅ 88/88 passed on a clean full run once the theme fix landed. The
                        theme failures (static-page-hydration.spec.ts) were a real,
                        root-caused bug — see "next-themes inline bootstrap script"
                        above — not left open. Separately, a handful of unrelated
                        specs (cancel-guidance, import-duplicate-review,
                        login-lockout-captcha) intermittently fail/pass across runs
                        with no code change in between — traced to real, live network
                        calls this suite deliberately makes to Cloudflare's Turnstile
                        siteverify API (see playwright.config.ts's own comment on why
                        real CAPTCHA is used instead of a mock). Pre-existing flakiness,
                        not a regression from this pass — confirmed by re-running the
                        exact same specs immediately after a failure and getting a
                        clean pass with zero changes in between.
```

If you're re-running this suite and something above no longer holds, that's
a real signal this doc has drifted — update it (or archive it and write a
fresh one) rather than leaving it silently wrong for the next reader.
