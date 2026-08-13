# Local Council — Phase 5: Renewal Reminders

5 members. Key findings that changed the design:

**Devil's Advocate (critical, high confidence)**: original "claim-before-send" design does NOT actually mirror `stripeEvents` — that pattern wraps claim+work in one DB transaction (rollback-safe); an email send can't be transactional. A failed send after a successful claim would permanently orphan that reminder with no retry, silently. **Fix: claim tracks `claimedAt` separately from `sentAt`; job also reclaims stale (`sentAt IS NULL AND claimedAt < threshold`) rows via atomic conditional UPDATE.**

**Security (critical, high confidence, decisive)**: combined with the already-known fact that email is never verified/owned at signup, default-ON reminders let anyone sign up as `victim@example.com`, add fake subscriptions, and have SubSentry auto-email the real victim repeatedly with attacker-influenced content (subscription names) — a genuine spam/harassment relay using SubSentry's own sending domain, not a theoretical risk. Also: user-controlled subscription name must be HTML-escaped before interpolating into the email (no existing precedent in email.ts handles this — every current template only interpolates server-generated strings). Also: CRON_SECRET check must run before any DB query, must length-check before `timingSafeEqual`, must fail closed (503) if unset.

**Simplicity**: proposed collapsing the reminders table into 2 columns on `subscriptions`. Valid point about avoiding speculative "history" features, but the stale-reclaim fix (Devil's Advocate) needs a `claimedAt`/`sentAt` split regardless of table-vs-columns, and this codebase's own established precedent for "track processed unique events" is a dedicated table (`stripeEvents`) — kept as a lean table, not columns, for consistency with that precedent and to keep `subscriptions` (a hot, per-page-load-fetched table) free of reminder bookkeeping.

**Scalability**: candidate query must filter in SQL (not fetch-then-filter-in-JS), must be batch-capped (LIMIT), and needs a dedicated `(status, nextRenewalDate)` partial index — the existing `subscriptions_user_renewal_idx` is `userId`-first and useless for a cross-user cron scan. (3rd independent flag of the missing index — also raised by Devil's Advocate and Maintainability.)

**Maintainability**: reuse the existing `queries.concurrency.test.ts` DB-race-testing pattern for the claim logic; split pure job logic into its own testable module separate from the route handler (mirrors `stripe-webhook.ts`'s verify/route split); named window constants; dense schema comments matching house style, including explicit documentation of the default-ON tradeoff.

## Design changes made in response
- `renewalReminders` table (not columns) with `claimedAt` + nullable `sentAt`, unique on `(subscriptionId, renewalDate)`, stale-reclaim retry via conditional UPDATE.
- New partial index on `subscriptions (nextRenewalDate) WHERE status = 'active'`.
- Batch-capped, SQL-filtered candidate query.
- HTML-escape subscription name in the email template (new small helper).
- CRON_SECRET: fail-closed if unset, length-checked before timingSafeEqual, checked before any DB access.
- Per-run recipient cap (max N reminder emails to the same address per single job invocation) — direct mitigation for the fake-subscription spam-relay scenario Security found, without needing new persistent rate-limit state.
- Feature gated entirely behind a new dedicated secret (`RENEWAL_REMINDER_SECRET`, used both for cron auth-adjacent purposes and to derive the unsubscribe token) — if unset, the whole feature (job route + unsubscribe link generation) is inert, matching the established `isXConfigured()` degrade-to-hidden convention used for Stripe/Plaid/Token-encryption.
- One-click, no-login-required unsubscribe link (HMAC-signed, stateless) in every reminder email, plus a Settings toggle for logged-in users — directly required by the brief ("never make unsubscribing intentionally difficult") and the key mitigation bounding real-world harm from the spam-relay scenario even if it occurs.
- Default `users.renewalRemindersEnabled = true`, documented transparently as a judgment call given the tension Security raised (the toggle alone can't stop an attacker who fully controls the fake account either way — the real mitigations are the per-run recipient cap + one-click unsubscribe, not the default value).
