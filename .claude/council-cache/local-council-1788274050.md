# Local Council — 90-Day Retention + Launch Readiness Audit

> **Local council** — these perspectives all come from Claude playing different
> roles, not from different AI vendors. Treat agreement as a shared starting
> point to pressure-test, not as independent confirmation.

**Question:** 90-DAY RETENTION + LAUNCH READINESS AUDIT for SubSentry. Central question: "If 100 real users signed up tomorrow, what would make them still want SubSentry 90 days later?" (Full prompt included the product context and 8-part audit ask given to every member — see session transcript for the verbatim text.)

**Roles:** Devil's Advocate, Simplicity Champion, Security Auditor, Scalability Architect, Maintainability Advocate.

---

## 🗳️ Devil's Advocate

### Position
The code is unusually disciplined for a solo-founder project — but the discipline has been spent almost entirely defending against *hypothetical* edge cases (adversarial audits, monotonicity proofs, calibration fixtures) rather than against the much more mundane failure modes that kill 90-day retention: silent notification gaps, recurring false-positive nags with no way to suppress them, and a monetization gate that's currently switched off. Three concrete, code-verified gaps found; no evidence the core loop is broken.

### Key points
- `STALE_THRESHOLD_DAYS = 120` (`staleness.ts:17`) means any subscription added during a user's first 90 days can never trigger `stale_subscription` inside those 90 days — the Day-90 "still using X?" nudge literally cannot fire until day 121+.
- `isDigestWorthSending` requiring `totalNewNotifications > 0` (`digest.ts`) means a 90-day-mature, already-optimized 10-subscription account is the *most likely* profile to generate zero new notifications for weeks running — zero emails, no steady-state fallback.
- `staleCandidates` deliberately never consults `dismissedRecommendationIds` — a subscription the user has correctly and repeatedly confirmed they still want re-notifies every 30 days forever, with (per this member's read) no escape but re-triggering `lastReviewedAt`.
- `BETA_ALL_ACCESS = true` (`plan.ts:21`) means no signup tomorrow experiences Free/Pro as designed — any monetization conclusion in this audit round is speculative until it's flipped.
- Health Score's multiple hand-tuned correction passes may be solving legibility with more precision rather than actually being legible to a real person over 90 days.

### Risks & blind spots
Every "council review"/"adversarial audit" comment in this codebase documents Claude-on-Claude critique, not real usage data — no digest open rate, click-through, or cohort return number exists anywhere. This audit (this member included) is structural reasoning about a hypothetical journey, not ground truth. Traced engine/job logic, not the rendered UI/email/browser click paths.

### Confidence
`medium` — three findings directly verified against source with line numbers; severity in practice unconfirmed (no live app, no analytics).

---

## 🗳️ Simplicity Champion

### Position
The retention *plumbing* (digest, notification generation, pro-features gating) is disciplined and appropriately simple. The one real over-engineering pocket is the Health Score engine — complexity added to fix complexity, not a simpler model chosen up front.

### Key points
- Health Score is ~2,500 lines across 5 files to produce one 0–100 gauge; two hand-tuned correction terms (`worstDimensionPenalty`, `spreadPenalty`) were layered on after the plain weighted average hid real problems.
- This is expensive-to-touch, cheap-to-leave-alone code — the tuning is load-bearing (a real non-monotonicity bug was caught by its own invariants test), not decorative. Recommendation: freeze it the way `SECURITY_STATUS.md` freezes security, don't extend it.
- Where the team already resisted complexity, it shows and should stay untouched: two coarse email toggles instead of per-type switches, `isDigestWorthSending`'s single-line gate, `generate.ts`'s explicit "never re-derive" posture.
- Import-provider surface (~6,500 lines across 6 providers) is large relative to audience (manual/AI-add is the pitched primary path) — not a delete candidate, but a "no new providers" discipline going forward.
- `pro-features.ts`'s single-array-three-call-sites shape is a good precedent to reuse for any future monetization copy.

### Risks & blind spots
This lens has almost nothing to say about the actual retention question — the complexity flagged is a maintainability/velocity risk for the team, not a user-facing retention gap. Did not verify whether the Health Score penalty stack is strictly necessary vs. just where the team arrived.

### Confidence
`medium` — grounded in reading the actual scoring code and its own candid comments; didn't rerun the calibration suite against a simpler alternative.

---

## 🗳️ Security Auditor

### Position
The security work here is genuinely solid and correctly frozen — but two narrow gaps sit exactly at the intersection of "security-relevant state change" and "silently stop being protected," and both are small, contained fixes.

### Key points
- **Plan downgrade is completely silent.** `stripe-webhook.ts` handles only `checkout.session.completed` and `customer.subscription.deleted` — on cancellation it flips `users.plan` to free with zero email/notification. The next `runConnectedAccountSyncJob` run then silently skips auto-sync for that user (`accountsSkippedFreePlan++`) while still calling `markBankConnectionSynced`, so `lastSyncedAt` keeps advancing as if sync succeeded — and that timestamp is genuinely shown in the UI ("Last synced ...", `connect-email-step.tsx`).
- **`provider_error` sync failures never escalate.** By design a single transient failure isn't flagged (reasonable), but there's no counter — a connection that fails every day for weeks gets no signal for the life of the connection, and `lastSyncedAt` isn't shown anywhere with a staleness indicator outside the Import Center flow.
- Everything else checked came back clean: unsubscribe tokens are purpose-scoped HMACs with `timingSafeEqual`, cryptographically independent by design; the AI-narration prompt-injection surface never reaches email; free-text interpolated into HTML email is consistently `escapeHtml`'d.
- Both findings are small: the downgrade email is wiring onto an existing handler using existing email infra; the `provider_error` escalation is a small counter reusing the existing `connection_issue` notification path.

### Risks & blind spots
Didn't verify Stripe's own dunning emails (could partially soften this, though not the *product* consequence). Code-only audit — didn't confirm live timing between a failed card and `customer.subscription.deleted` actually firing. Didn't judge whether the downgrade email itself is good product copy vs. a dark-pattern-adjacent nag — that's a product call, not a security one.

### Confidence
`high` — both findings grounded in direct, line-by-line code reads plus a negative grep confirming no downgrade-notification path exists anywhere.

---

## 🗳️ Scalability Architect

### Position
The core retention loop's automation layer is architecturally sound for a 100-user launch — bounded, fair-rotation batch jobs with per-item failure isolation. One specific mechanism (renewal-reminder ordering) has a real starvation failure mode, but only at 10x-100x scale, with no alerting to catch it when it happens.

### Key points
- `findReminderCandidates` orders strictly by `nextRenewalDate` with a 500/day cap — a long-lead-time (7/14/30-day) reminder always sorts behind every near-term one on every day's fresh query. At high enough volume (est. 1,500-5,000+ active users), long-lead reminders could silently never send. At 100 users this is "nowhere close to firing."
- The digest job and connected-account sync job use a safer nulls-first/oldest-first fair-rotation pattern instead — the right design, and renewal-reminders is the outlier because urgency-ordering and fairness-ordering are in tension and only urgency was chosen.
- `sendTransactionalEmail` creates a fresh SMTP transport per email by deliberate design (fine at low volume); inside a sequential loop of up to 500/day this becomes the first real bottleneck as volume grows, with no `maxDuration` override found on cron routes.
- No alerting exists anywhere (`logServerError` is structured stdout only) — "the watchdog itself has no watchdog."
- DB layer is genuinely fine and doesn't need caching at 100x scale — every per-user computation already scales with one user's own row count via indexed, already-fetched data.

### Risks & blind spots
The exact threshold is a reasoned estimate (10 subs/user assumed), not a load test. Didn't verify real Vercel timeout config or SMTP provider throughput limits. Didn't audit Stripe webhook or AI quick-add paths for the same class of issue (out of the assigned scope).

### Confidence
`medium` — code evidence is solid; the exact user-count threshold is an estimate.

---

## 🗳️ Maintainability Advocate

### Position
The retention-critical code is unusually well-tested and well-reasoned for its size — not at risk of silently breaking from ordinary neglect. The actual liability is elsewhere: narrative "process" comments across 26 files and 14 overlapping root-level report docs with no index, which make it easy for the *next* change to act on stale context or reinvent existing logic.

### Key points
- Test coverage matches risk surface closely (e.g. `generate.ts` 495 lines / `generate.test.ts` 546 lines; `health-score.ts` has both a main test file and a separate invariants suite).
- Bucketing/dedupe math (the "don't nag daily, don't go silent forever" pattern) is hand-rolled independently three times in one file with slightly different shapes and no shared helper — the exact bug class already found and fixed once per type, with nothing for the next notification type to reach for.
- "Watchdog phase"/"Council-review fix"/"Retention pass" tags span 26 files — useful once, but nothing keeps them accurate as code changes again; a future maintainer has to read history to find out what's still true.
- 14 root-level `.md` report files with no index or supersession markers (three separate "frontend design" reports alone) — `HEALTH_SCORE_V2_PROPOSAL.md` is correctly marked "NOT YET APPROVED" in its own text, but is one grep away from being read as spec.
- The entitlement-splitting reuse pattern (`splitSavingsRecommendationsByPlan` shared between `/savings` and the notification generator) is the right shape and should be the template for future Free/Pro-sensitive logic.

### Risks & blind spots
Can't judge whether the retention loop is *effective*, only whether it's safe to keep extending. Didn't run the test suite or open every flagged file individually — going on file presence/line counts and direct reading of the primary files as a proxy.

### Confidence
`medium` — grounded in direct reading of the full retention-loop source and a repo-wide grep confirming the narrative-comment pattern; didn't execute the suite or review every flagged doc.

---

## Synthesis

**Shared starting points (stress-test, not corroboration):** all five members independently read the same live code and landed on "the plumbing is sound, don't rebuild it" — that convergence is a shared prior (same model, same repo), not confirmation from independent sources. What it's worth: none of the five, working blind, felt compelled to invent a retention-loop-is-broken narrative to fill space, which is itself a data point given the prompt explicitly permitted "the loop is already sound, say so."

**Genuine tensions:** devil's advocate and the acted-on fix both point at "silence" as the central risk — but from different angles (devil: the *digest* going quiet for a healthy account; security: a *plan change* going unsignaled entirely). These aren't the same finding and pull toward different fixes; only the second was small, verified, and consequential enough to act on without contradicting a standing product principle from the immediately preceding session.

**Blind spots:** no member had access to real usage data (open rates, click-through, cohort return) — every finding here is structural/code-level reasoning, explicitly flagged as such by 4 of 5 members. No member deeply audited the actual rendered UI/UX (all worked from source, not a browser) — a UI-focused pass could still find communication-layer gaps none of these five would catch.

**Suggested direction (acted on):** ship the plan-downgrade email (security, high confidence, smallest and most verified fix) now. Defer everything else — each deferred item has either a standing reasoned justification already in the codebase (stale threshold, digest-silence principle), needs new schema surface disproportionate to its confirmed impact (`provider_error` counter), or is explicitly scoped by its own author as a future/10x-100x concern (renewal-reminder starvation) rather than a today problem.

---

*Every member's finding — including the four deliberately not acted on — is preserved above for future reference. See the session's own final report for the full reasoning behind each "not built" decision.*
