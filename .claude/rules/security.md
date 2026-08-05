# Security rules (mandatory, all agents)

## Never

- Output, print, or echo the contents of `.env`, `.env.*`, `*.pem`, SSH keys, or any credential file.
- Modify production credentials, API keys, or secrets — including in `.env.example`, only ever placeholders there.
- Remove, weaken, or bypass an authentication check (`getSession()`, `requireUser()`).
- Remove, weaken, or bypass an authorization/ownership check (any `WHERE userId = ...` scoping, plan-gating in `src/lib/billing/plan.ts`).
- Disable, skip, or loosen Zod validation on an API route.
- Delete or skip a security-relevant test to make a suite pass.
- Commit `.env`, credentials, `.pem`, SSH keys, or production config — these must stay gitignored.
- Use `git commit --no-verify` or otherwise bypass hooks without explicit user instruction.

## Before changing security-sensitive code

Security-sensitive = auth (`src/lib/auth/**`), session, password hashing, rate limiting, ownership checks in any `queries.ts`/API route, token encryption (`src/lib/security/token-encryption.ts`), Stripe webhook verification, OAuth state/CSRF handling (TrueLayer), and `src/lib/billing/plan.ts` entitlement gating.

1. State the risk in plain terms (what breaks, what an attacker gains).
2. State the proposed fix.
3. Add or update a test that would fail without the fix.
4. Run `npm run typecheck && npm run lint && npm test`.

## Protected paths — never edit without explicit user request

`.env`, `.env.*` (except `.env.example` placeholders), `*.pem`, SSH keys, `drizzle/*.sql` (migrations — additive only, never edit an already-applied one), production deployment config.
