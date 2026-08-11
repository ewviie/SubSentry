# SCALING_READINESS_REPORT.md

## Backend statelessness

- **Stateless app servers**: yes. All state lives in Postgres (users, sessions, subscriptions, rate-limit/lockout tracking as of this pass) or Redis (rate limits, when `UPSTASH_REDIS_REST_URL` is configured — see `src/lib/rate-limit-distributed.ts`). No in-process state a horizontally-scaled instance needs to share *except* the remaining in-memory rate limiters (billing, imports, AI, subscriptions, profile-update — see `SECURITY_HARDENING_REPORT.md`), which degrade to "each instance enforces its own limit independently" under scale-out — a real but bounded gap (worse abuse tolerance, not a correctness bug).
- **Session storage**: DB-backed (sha256 token hash in `sessions` table), not in-memory — already scale-out safe.

## Database connection handling

- `src/lib/db/index.ts` uses a lazy singleton `postgres.js` client per process, `prepare: false` (required for PGlite dev compat, also the safe default against connection poolers in transaction mode — PgBouncer, Supabase's pooler). `max: 5` in production, `max: 1` only against the local PGlite dev server.
- **Recommendation for real horizontal scaling**: if deploying multiple long-running instances (not serverless) against a pooler-fronted Postgres (Supabase, PgBouncer), confirm the pooler's own max connection count accommodates `instances × 5`. If deploying serverless (Vercel functions), consider Neon's or Supabase's serverless driver instead of `postgres.js` — a fresh TCP connection per cold-start invocation multiplied across many concurrent invocations is the standard serverless-Postgres pain point; this app doesn't hit it today only because a single Next.js server process still owns the lazy singleton per warm instance.

## Background jobs / queues

- **None exist.** Every operation in this app is synchronous, request-scoped: subscription CRUD, import parsing, AI quick-add, Stripe webhook processing, email sending (currently console-logged, see `src/lib/auth/email.ts`). No queue, no worker process, no cron beyond the two manual scripts (`db:cleanup-sessions`, and `deleteExpiredVerificationTokens` in `email-verification.ts`, neither wired to run automatically).
- **Real gap**: `deleteExpiredVerificationTokens()` and expired-session cleanup (`scripts/cleanup-expired-sessions.ts`) both need a scheduler (cron, GitHub Actions scheduled workflow, or a platform cron feature) to actually run periodically in production — right now they're callable functions with nothing invoking them. Neither is scaling-blocking (both tables self-bound: verification tokens are deleted on use or superseded by a fresh issue; sessions are checked for expiry on every read), just a slow, harmless row-count creep without cleanup.
- **When this becomes a real gap**: if email sending moves to a real provider synchronously in the request path (Resend's API call currently blocks the signup/resend-verification response) and that provider has meaningful latency/failure modes, moving email dispatch to a queue (or at minimum `after()`/background fire-and-forget) would keep auth endpoints fast and resilient to the email provider being slow or down. Not yet necessary at current scale/architecture.

## File storage

- **No file storage exists** — confirmed: `imports/analyze`'s uploaded CSV is read into memory, processed, and never persisted (`file.text()`, no disk/blob write anywhere in the codebase). Nothing to scale here today; if this changes (e.g., storing original uploaded files for audit), it should go to object storage (S3/R2/Blob) from day one, never local disk (which wouldn't survive a serverless cold start or be shared across instances anyway).

## Expensive operations

- **AI calls** (`src/lib/ai/anthropic-provider.ts`): synchronous, request-blocking, but already rate-limited per user (`src/lib/ai/rate-limit.ts`) and gated by `isAIConfigured()` (demo mode with zero external latency when no key is set).
- **CSV/bank import parsing** (`src/lib/imports/csv-parser.ts`, `detection.ts`): synchronous, in-memory, O(n) to O(n log n) depending on stage — bounded by the 5-10MB upload ceiling (`isContentLengthWithinLimit`, provider `maxFileSizeBytes`) and the existing `checkImportAnalyzeRateLimit`. Fine at current scale; would need to move to a background job only if uploads grow to a size where synchronous parsing risks a request timeout.
- **Plaid/TrueLayer sync** (`fetchTransactions`): makes 1 (Plaid) or N-per-account (TrueLayer, no bulk endpoint — see `DATABASE_QUERY_AUDIT.md`) external API calls per request, synchronously. Same profile as AI calls: rate-limited, but worth watching if a user links an institution with many accounts.

## Rate limiting at scale

Covered in depth in `SECURITY_HARDENING_REPORT.md` — summary: the 4 highest-value auth endpoints (login, signup, verify-email, resend-verification) now support a distributed (Upstash Redis) backend and fall back to in-memory; every other endpoint remains in-memory-only, a deliberate, documented scope decision for this pass.

## What would actually break first under real horizontal scale-out

In priority order:
1. **In-memory rate limiters on non-auth endpoints** — an attacker distributing requests across instances gets `limit × instance_count` effective throughput instead of `limit`. Not a security hole (auth is covered), a throttling-effectiveness degradation.
2. **No background job runner** — if email sending or any future slow integration needs to move off the request path, there's no existing queue/worker infrastructure to extend; it would need to be introduced (not configured) at that point.
3. **Postgres connection ceiling** — only relevant once instance count × max-connections-per-instance approaches whatever the actual Postgres deployment (Neon/Supabase free tier, self-hosted, etc.) allows. Not a code issue, a deployment-sizing one.

Nothing found that requires an architecture change to scale to a modest multi-instance deployment (a handful of long-running Next.js instances behind a load balancer, one shared Postgres). Serverless/edge deployment at high concurrency would want the connection-handling change noted above.
