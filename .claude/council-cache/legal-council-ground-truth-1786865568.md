# SubSentry Ground-Truth Dossier (verified against the actual repository, not the legal documents)

Compiled by direct code inspection for a council review of the current Terms of Service
(`src/app/terms/page.tsx`) and Privacy Policy (`src/app/privacy/page.tsx`). Every item below
was confirmed by reading actual source files, not inferred from the legal documents' own claims.
Where the documents make a claim, cross-check it against this dossier — don't assume the
documents are accurate.

## Legal entity / operator status
- No legal entity name, registration number, registered address, or jurisdiction of incorporation
  exists anywhere in the repository (env files, schema, code comments, or docs).
- Both documents' own text already states this explicitly: "SubSentry does not currently operate
  as a formally established legal entity."
- No fact in the repo establishes Hong Kong, Vietnam, Singapore, the US, or any other jurisdiction
  as the entity's home. The user's own framing says the founders/operators work "between Hong Kong
  and Vietnam" — that is a statement about where people currently are, not a legal fact about
  incorporation, tax residency, or applicable consumer-protection jurisdiction. Treat it as
  context only.

## Age / eligibility
- Terms §5 requires users to be "at least 18 years old."
- **No age or date-of-birth field exists anywhere in the signup flow** (`api/auth/signup/route.ts`,
  `signup-form.tsx`). Age is asserted in the Terms but has zero technical enforcement or even a
  checkbox — a user of any age can complete signup.

## Authentication & security (verified accurate)
- Password hashing: Argon2id (`src/lib/auth/password.ts`, `argon2.hash(password, {type: argon2.argon2id})`).
- Session tokens: SHA-256 hash stored in DB, never the raw token (`src/lib/auth/session.ts`,
  `createHash("sha256")`); sessions last 30 days (`SESSION_DAYS = 30`); cookie is HttpOnly, Secure
  in production, SameSite=Lax.
- Bank/Gmail OAuth access & refresh tokens: encrypted at rest with AES-256-GCM
  (`src/lib/security/token-encryption.ts`).
- Rate limiting: real, enforced at every mutating/expensive route boundary (independently audited
  this session — every checker call is followed by a `.allowed` check and a 429 response). Backend
  is in-memory per-process for most routes; the 11 highest-value auth limiters (login, signup,
  verify-email, resend-verification, forgot-password, reset-password, delete-account) use an
  optional Upstash-Redis-backed distributed limiter that silently falls back to in-memory if
  `UPSTASH_REDIS_REST_URL`/`TOKEN` are unset (they are blank/optional in `.env.example` — cannot
  verify from the repo whether a real deployment has them configured). Login also has an
  independent, durable, DB-backed lockout (5 failed attempts → 15-minute lock, keyed by email,
  survives restarts/instance count) — this one endpoint's brute-force protection does NOT depend
  on Upstash.
- CAPTCHA: Cloudflare Turnstile, optional/env-gated (`isCaptchaConfigured()`), used on signup,
  resend-verification, and — only once failures start compounding — login.
- No SOC 2, ISO 27001, or other independent security certification exists (confirmed: nothing in
  the repo references one, matching both documents' own disclaimer).
- No cron/scheduled job purges expired session rows, old `loginAttempts` rows (except on account
  deletion, see below), or security-event logs. Expired sessions are simply treated as invalid at
  read time (`expiresAt` check), not deleted. Security events (`logSecurityEvent`) are
  `console.warn` JSON lines only — **not written to any application database table** — so their
  actual retention/access/deletion is entirely controlled by whatever the hosting platform's log
  system does (e.g., Vercel's own log retention), not by SubSentry's own code, and account
  deletion cannot touch them.

## Account deletion (verified scope)
- Self-service deletion cascades via Postgres `ON DELETE CASCADE` on `users.id` across: sessions,
  subscriptions, imports, bankConnections, emailConnections, emailVerificationTokens,
  passwordResetTokens (`src/lib/auth/account-deletion.ts`).
- `loginAttempts` (keyed by email, not userId) is explicitly deleted in the same transaction.
- **`checkoutSessions` (FK set to null, not deleted) and `stripeEvents` are deliberately NOT
  deleted** — Stripe's own billing/audit trail survives account deletion by design (documented in
  the code's own comment).
- Callers (the `/api/account` route) are expected to revoke external OAuth/bank tokens at the
  provider (Gmail, Plaid) before calling this function; `deleteUserAndAllData` itself makes no
  outbound calls and only deletes local rows.

## Third-party processors actually integrated in code
- **Stripe** — billing/checkout via Payment Links + Billing Portal (mint a hosted portal session
  via `POST https://api.stripe.com/v1/billing_portal/sessions`; SubSentry never touches raw card
  numbers). Webhook signature-verified.
- **Anthropic** — two *optional*, on-demand AI features only: (1) quick-add free-text parsing,
  (2) "Rewrite with AI" insight narration. Both rate-limited at 20/day/user each, both only ever
  called when the user actively triggers that specific feature. No AI processing happens as a
  side effect of normal app use.
- **Plaid** and **TrueLayer** — bank-account connect, read-only (no code path initiates a
  payment, transfer, or purchase through either).
- **Google (Gmail)** — read-only `gmail.readonly` OAuth scope; verified in code the app never
  sends/deletes/modifies email or changes account settings.
- **Cloudflare Turnstile** — CAPTCHA, optional/env-gated.
- **Upstash** — optional distributed rate-limiting backend, env-gated, falls back silently to
  in-memory if unconfigured.
- **Email delivery**: generic SMTP via Nodemailer (`src/lib/auth/email.ts`) — **not a named
  vendor** (previously used Resend's HTTP API per a code comment, now generic SMTP; the actual
  operator's configured SMTP host is an env var, unknown from the repo).
- No analytics, advertising, or tracking-pixel libraries found anywhere in the codebase. No cookie-
  consent banner component exists. No geo-IP/country-detection code exists anywhere (no
  `cf-ipcountry`, no `x-vercel-ip-country`, nothing) — the app cannot currently distinguish an EEA/
  UK/Swiss/California visitor from any other visitor by any technical means.

## Cancellation guidance (verified actual behavior)
- The only "cancellation assistance" that exists is a generic web-search link:
  `https://www.google.com/search?q=how+to+cancel+{name}+subscription` (`edit-subscription-form.tsx`).
- The UI copy explicitly and correctly tells the user: "SubSentry only tracks what you tell it —
  it can't cancel this for you." No maintained per-merchant cancellation-URL database exists.
- Changing a subscription's status to "canceled" only updates SubSentry's own record; it has zero
  effect on the actual merchant relationship.

## SubSentry's own Pro-plan billing terms
- The app has real paid functionality: a `plan` column (`free`/`pro`) on `users`, Stripe Checkout
  (Payment Links) + Billing Portal, a pricing section on the marketing site.
- **The newly-published Terms of Service contains no section addressing SubSentry's own Pro-plan
  billing terms at all** — no billing-cycle description, no price-change notice provision, no
  refund policy for SubSentry's own subscription, no statement of what happens to Pro access on
  cancellation or non-payment. Every "refund"/"billing" mention in the new Terms concerns
  third-party merchants the user tracks, never SubSentry's own paid plan. (The previous version of
  the Terms had a one-line refund/termination clause for this; the new version dropped it when it
  was replaced with the new, more general-purpose document.)
- Actual cancellation of a Pro subscription happens entirely inside Stripe's own hosted Billing
  Portal UI — the app has no custom in-app cancel/refund logic of its own to describe.

## Marketing claims (checked for conflicts with "no guaranteed savings" disclaimers)
- No "guaranteed savings," specific dollar-savings promises, or percentage-off marketing claims
  found on the landing/pricing pages. Pricing section shows the Pro plan's own price ("/mo"); no
  savings-amount claims found there.
- The in-app Smart Savings/health-score features (audited extensively earlier this session) are
  already carefully worded as estimates/opportunities, never guarantees, with confirmed vs.
  estimated distinctions enforced in code — this is a genuine area of strength, not a gap.

## What this dossier does NOT establish
- Whether any Data Processing Agreement exists with any processor (not verifiable from a code
  repository — that's a contractual fact, not a code fact). Both documents already say none is
  finalized yet.
- Where the app's infrastructure is actually hosted/what region (not in the repo).
- Actual user geographic distribution (not in the repo).
- Whether the operator has legal counsel, insurance, or has taken any step toward incorporation
  beyond what's written in these two documents.

## Addendum (found by a Round 1 council member, verified directly)
- `src/lib/billing/plan.ts` currently has `const BETA_ALL_ACCESS = true;`, which makes
  `hasPaidAccess()` return true for every user regardless of `plan`, and `getUpgradeUrl()`
  return `null` (no upgrade link shown) during this state. Today, nobody can actually be
  charged — the whole paid tier is dormant. The settings UI correctly labels this as
  "Beta — full access," not "Pro" (per the finding; not independently re-verified by me).
  This is a single-flag switch: flipping it to `false` reverts to real Stripe billing with no
  other code changes. This is directly relevant to the "no Pro-plan billing terms in the
  Terms" gap — that gap is currently low-stakes (nobody is being charged) but would become a
  live, real gap the moment this flag flips.
- Marketing page `src/components/landing/features-section.tsx` shows a screenshot with a
  specific "83/100 subscription health score" and "$146.97" monthly-spend figure, with no
  adjacent disclaimer text on that public marketing page itself — the confidence/uncertainty
  framing (verified real and well-implemented in `health-score.ts`) only appears once a user
  is inside the authenticated dashboard.

## Addendum 2 (resolves the Privacy Lawyer's Round 2 open question)
- Verified directly: the `imports` DB table schema (`src/lib/db/schema.ts`) stores ONLY
  `source`, `status`, `detectedCount`, `importedCount`, `ignoredCount`, and a small bounded
  `errors` jsonb array (capped at ~20 entries, "a structured summary, not a dump of raw parser
  internals" per the schema's own comment) — no raw file content, no raw transaction array,
  no raw email body column anywhere. `gmail-extract.ts` decodes email content in memory
  (`Buffer.from(...).toString("utf8")`) but contains no `insert`/`.values(` call at all — it
  never writes to the DB itself. `imports/analyze/route.ts` buffers an uploaded CSV via
  `formData.get("file")` in memory only, no `fs.writeFile`/blob-storage call found anywhere in
  the import pipeline. **Conclusion: the Privacy Policy's §5/§6/§39 claim that raw CSV/
  transaction-feed/email content is not intentionally retained after processing is ACCURATE,
  confirmed by direct schema and code inspection — not merely inferred from the dossier's
  silence.**
