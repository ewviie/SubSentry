# ⚓ Doubloon

AI-powered subscription management. Track what you're paying for, catch
duplicate and overpriced subscriptions, and add new ones by typing them in
plain English instead of filling out a form.

## What's implemented

- **Auth** — email/password signup and login, database-backed sessions
  (opaque cookie token, only its hash stored server-side), rate-limited and
  protected by middleware.
- **Subscriptions CRUD** — add, edit, and delete subscriptions (name, amount,
  currency, billing cycle, category, renewal date, status, notes).
- **Dashboard** — monthly/annual spend, active count, upcoming renewals,
  spend-by-category breakdown, all with count-up animations, skeleton
  loaders, empty states, and success/error toasts (respects
  `prefers-reduced-motion`).
- **AI quick-add** — type `"Netflix £10.99 monthly"` into the quick-add bar
  and confirm the parsed result before saving. Falls back to a demo provider
  with realistic canned responses when no `ANTHROPIC_API_KEY` is set, so the
  whole loop is testable keyless.
- **Deterministic insights** — expensive-category, overdue-renewal,
  high-yearly-spend, and possible-duplicate detection, computed purely from
  your data (no AI call). An optional "Rewrite with AI" pass can restate them
  in plainer language.
- **Billing** — a Stripe Payment Link handles checkout with no Stripe SDK
  dependency; a hand-verified webhook (`/api/stripe/webhook`) records
  completed checkouts, and `/api/billing/activate` redeems the Payment
  Link's redirect to upgrade the account to Pro. Free plan is capped at 5
  active subscriptions; Pro is unlimited.
- **Settings** — account info, current plan with usage against the free-plan
  limit and an upgrade CTA, AI mode (live vs. demo), and logout.

## Run it

```bash
npm install
cp .env.example .env   # see below — everything has a safe default for local dev
npm run db:dev         # starts an embedded Postgres-compatible dev server (keep running)
npm run dev            # in a second terminal — http://localhost:3000
```

No `ANTHROPIC_API_KEY`? AI features run in demo mode automatically. No
`STRIPE_PAYMENT_LINK`? Upgrade buttons are simply hidden and the free-plan
limit still works — billing is entirely additive.

## Environment

See `.env.example` for the full list with explanations. Summary:

| Variable | Required? | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Any Postgres wire-protocol connection string — the embedded `npm run db:dev` server, Docker (`docker-compose.yml`), or a hosted Neon/Supabase instance all work identically. |
| `ANTHROPIC_API_KEY` | No | Enables live AI (quick-add parsing, insight narration). Omit for demo mode. |
| `AI_MODEL` | No | Defaults to `claude-opus-4-8`. |
| `STRIPE_PAYMENT_LINK` | No | A Stripe Payment Link URL. When set, "Upgrade to Pro" buttons appear and point at it. |
| `STRIPE_WEBHOOK_SECRET` | No (required if using billing) | Signing secret for `/api/stripe/webhook` (`whsec_...`). Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`. |

## Maintenance

Expired sessions are deleted the moment their token is next presented, but a
cookie that's simply abandoned never gets looked up again. Run
`npm run db:cleanup-sessions` on a periodic schedule in production (daily is
plenty, given the 30-day session lifetime) — via Vercel Cron, a scheduled
GitHub Actions workflow, plain `cron`, or whatever your deployment platform
offers.

## Architecture

```
src/app/
  (auth)/              # login, signup — redirects away if already authenticated
  (app)/               # dashboard, subscriptions, settings — behind requireUser()
  api/
    auth/              # signup, login, logout
    subscriptions/     # CRUD + quick-add
    ai/narrate-insights/
    billing/activate/  # redeems a completed Stripe checkout
    stripe/webhook/    # records completed checkouts
src/lib/
  auth/                # session creation/validation, password hashing
  subscriptions/       # validation, queries, money math, insights
  ai/                  # provider abstraction (Anthropic + demo), rate limiting
  billing/             # plan/limits, Stripe webhook signature verification
  db/                  # Drizzle schema + client
src/components/        # dashboard, subscriptions, billing, and shared ui/ primitives
scripts/dev-db.ts      # embedded PGlite Postgres server for zero-setup local dev
scripts/cleanup-expired-sessions.ts  # scheduled sweep for abandoned sessions
drizzle/               # generated SQL migrations
```

The AI provider surface (`src/lib/ai/provider.ts`) is a small text-in/
structured-out interface — swapping models or vendors means implementing it
once, not touching every call site.

## Testing

```bash
npm run typecheck
npm run lint
npm run test
```

Vitest covers the pure logic: money math, insights, Stripe signature
verification, and plan gating. There's no end-to-end test suite yet —
UI changes should be verified manually against a running dev server.
