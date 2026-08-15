# Local Council — Phase 6: Make SubSentry Actually Useful

**Local council** — these perspectives all come from Claude playing different
roles, not from different AI vendors. Treat agreement as a shared starting
point to pressure-test, not as independent confirmation.

5 members, each independently inspecting the actual codebase and asked: "What is the
biggest remaining gap between SubSentry's current implementation and a genuinely
useful subscription-management product?"

## 🗳️ Product/UX

**Position**: The biggest gap is the "decide what to do about it" half of the promise —
every action path (savings cards, quick wins, renewal-reminder emails) routes to the
same generic edit form with a status dropdown and delete button. No cancellation link,
no merchant-specific guidance; marking something "canceled" is purely an internal DB
flag with no real-world consequence.

**Key points**: Every "action" terminates at the same dead end (`/subscriptions/[id]`);
the edit form/schema have no concept of "how to actually cancel"; the savings engine's
real analytical power (fuzzy-name duplicates + category concentration) is honest but
narrow — no usage/staleness signal exists anywhere, so a non-duplicate, unused
subscription is invisible to it; the detail page doesn't fully re-surface savings
context. *(Last point later found partially incorrect — see Corrections.)*

**Confidence**: high

## 🗳️ Devil's Advocate

**Position**: The insights/health-score/savings machinery is not evidence-based — it's
hand-tuned point values applied to metadata the app never validates against outcomes,
and it can't distinguish "forgotten" from "used daily and loved."

**Key points**: Health score weights are admittedly hand-tuned (own code comment); zero
usage/value signal exists anywhere — only price/name/category/date; `billing_mix` rule
rewards annual/quarterly billing (+3/-3) as "typically costs less," which is in tension
with the app's own mission since annual billing is the pattern most associated with
*forgotten* subscriptions; no price-history table exists, so "renewed at a higher price"
can never be detected; `optimization-score.ts`'s "100 = nothing to recover" is fed
entirely by duplicate-name matching, so 5 genuinely wasteful non-duplicate subscriptions
still score 100; detection confidence is biased toward known/curated merchants rather
than behavioral evidence; renewal-reminder timezone limitation is self-acknowledged.

**Confidence**: medium (reasoning grounded in code incl. its own admissions; not run
against real transaction data)

## 🗳️ Security

**Position**: Ownership scoping, injection defenses, and abuse-bounding on every new
surface are already unusually rigorous; the real remaining gap is a proportionality
mismatch — a single static symmetric key protects every user's live bank/Gmail OAuth
tokens, a blast radius far beyond "subscription tracker."

**Key points**: every query checked is `userId`-scoped; formula-injection sanitization
correctly extended to Gmail (own comment: "the one provider still missing it"); no
`dangerouslySetInnerHTML` renders user-controlled strings; renewal-reminder abuse is
bounded (unique claim, per-run cap, `emailVerified` gate); financial data doesn't leak
into logs; the one real architectural risk is `TOKEN_ENCRYPTION_KEY` as a single
non-versioned key across the whole user base — no envelope encryption or rotation path.

**Confidence**: medium (sampled rather than exhaustively read every file)

## 🗳️ Maintainability / Architecture

**Position**: Money/date centralization is genuinely disciplined, not the risk. The real
liability is two independent, full insight-computation passes running on every dashboard
load, already patched around rather than consolidated, plus a test-coverage gap on the
ownership layer.

**Key points**: `monthlyCents()`/`filters.ts` are the real canonical utilities, and every
apparent deviation (`analytics.ts`'s `annualizedCents()`) carries an explicit comment
justifying why; `insights.ts` and `insights-engine/` both run full O(n²) duplicate
detection on every dashboard load, already caused one shipped bug (identical sentence
rendered twice) fixed by a manual filter, not a shared source of truth; **claimed
`queries.ts` (ownership layer) has zero test coverage — verified FALSE**, see
Corrections; zero coverage above the lib layer (components/routes).

**Confidence**: high

## 🗳️ Growth / Retention

**Position**: The discovery engine and insight math are both genuinely well-built — the
real gap is that the product stops at description and never reaches consequence. It
identifies waste and calculates a number, but "decide/act" dead-ends at SubSentry's own
database, and almost nothing pulls the user back after the first session.

**Key points**: the renewal reminder (Phase 5) is the only legitimate return hook, and
it's narrow — no digest, no discovery email, no price-change alert; the one mechanism
that could pull in new forgotten spend without user effort (Plaid/TrueLayer/Gmail sync)
has no cron re-scan and isn't even configured in this deployment; **6 of 9 dashboard
insight cards render pure text/badges with zero click targets** — "Quick wins,"
literally described as "the most actionable things worth reviewing right now," gives
the user nothing to click; even the one working action (Savings → Review) only reaches
a generic edit form, never a real cancellation path; no price-history means the single
most emotionally compelling, genuinely-return-worthy notification a subscription
tracker can send is structurally absent.

**Confidence**: high

---

## Shared starting points (stress-test, not corroboration)

Three of five lenses (Product/UX, Devil's Advocate, Growth/Retention) independently
converged, without seeing each other's answers, on the same conclusion: **the product
correctly identifies problems but "deciding/acting" dead-ends at a generic internal
edit form with no real-world follow-through.** This is unusually strong signal for a
same-model panel — three different assigned lenses landed on the identical, specific
mechanism (not just a vague "needs more features").

Two lenses (Devil's Advocate, Growth/Retention) independently flagged the **absence of
any price-history data** as the single highest-value missing signal a subscription
tracker could have.

## Genuine tensions

- Devil's Advocate wants the scoring system treated with more epistemic humility
  (weights are hand-tuned, no usage data); Growth/Retention implicitly treats the score
  as a legitimate hook worth investing in further. Both are right from their own angle:
  the score is real, deterministic, and reproducible (not fabricated), but it does not
  and structurally cannot measure "value," only "shape of spend."
- Security is comparatively satisfied with the current state (finds a proportionality
  concern, not a coding flaw); the other four lenses are all pushing for more surface
  area (more actions, more signals, more return hooks). A "make it more useful" phase
  has to add surface area without touching the one place Security is already
  comfortable with.

## Blind spots

- No lens deeply audited the CSV/Apple/Google-Play import *discovery* funnel's real
  effectiveness end-to-end against messy data (Devil's Advocate raised it but couldn't
  verify without real transaction data).
- No lens flagged mobile usability specifically — out of scope for all five given the
  question's framing.
- Security's static-key finding and Maintainability's dual-engine-architecture finding
  are both real but neither is fixable within "additive, no new architecture, no
  rewrite" constraints — both are legitimate future-phase items, not something this
  phase's implementation should attempt.

## Corrections (claims verified against code and found inaccurate)

- **Maintainability's claim that `src/lib/subscriptions/queries.ts` has zero test
  coverage is false.** `queries.idor.test.ts` and `queries.concurrency.test.ts` both
  exist in that exact directory and directly test ownership scoping against a real
  Postgres instance. No action taken on this claim.
- **Product/UX's claim that the subscription detail page doesn't re-surface duplicate
  context is false.** `DuplicateNotice` (`duplicate-notice.tsx`) already does exactly
  this, rendered directly above `SubscriptionSummary` on `/subscriptions/[id]`. No
  action taken on this claim.

## Suggested direction (synthesized, not any single member's)

Independent, direct code inspection (not any council member) found the single
highest-confidence, highest-value bug of this whole audit: **`QuickWinsCard` and
`PositiveHabitsCard` can never render for any user, under any data, because
`engine.ts` never includes `HEALTH_RULES` results — the only source of
`warning`/`positive` severity findings — in the pool that computes `quickWins`/
`positive`.** This directly explains Growth/Retention's "6 of 9 cards have no click
target" observation (one of those six literally never appears at all) and is a pure
correctness fix, not a design opinion: reuse already-computed, already-tested
`HEALTH_RULES` output instead of discarding it after health-score extraction.

Combined with the 3-lens convergent finding, the implementation for this phase should:
1. Fix the `quickWins`/`positive` dead-code bug (correctness, evidence-based, minimal diff).
2. Give `QuickWinsCard` (now real) a click-through to the relevant subscription, matching
   `SavingsOpportunitiesCard`'s existing pattern.
3. Add honest, non-fabricated cancellation guidance (a real search link, clearly labeled
   as a search) to the one screen every action path already converges on.

Price-history, a unified insight-engine architecture, and the token-encryption key
architecture are all real, legitimate gaps — explicitly left for a future phase as too
large for "smallest evidence-based improvement, no new architecture."

---

## Re-check — after implementation (3 members: Devil's Advocate, Security, Product/Data-Integrity)

Asked: "Did this phase materially improve SubSentry's ability to help a user discover,
understand, and act on recurring spending?" against the actual implemented diff.

**Consensus**: net positive. The `quickWins`/`positive` dead-code fix is real and
verifiable (all three independently confirmed the pre-diff bug from the source, not
from the summary). The cancellation-guidance box is honest, correctly scoped, and
introduces no misleading financial claims.

**Real bug found in the fix itself — confirmed by 2 of 3 members independently, then
verified directly and fixed**: excluding `health.duplicates` by `ruleId` alone removed
*both* its warning branch (correctly excluded — already covered by Savings
opportunities) *and* its harmless positive branch ("No duplicate subscriptions"), which
had zero collision risk since Savings opportunities is silent exactly when there are no
duplicates. Fixed: the exclusion now checks `ruleId === "health.duplicates" && severity
=== "warning"` specifically. Added a regression test proving the positive branch
survives when there are no duplicates.

**Other findings addressed:**
- `insights-engine/signals.ts` carried its own private, byte-identical copy of
  `namesLikelyMatch` instead of importing the canonical one from `subscriptions/insights.ts`
  (which it already imports `normalizeName`/`levenshtein` from) — consolidated.
- `e2e/quick-wins.spec.ts`'s post-click URL assertion accepted any UUID rather than
  confirming the click actually landed on one of the clustered subscriptions —
  strengthened to check membership.
- Mobile-overflow coverage for the new cancellation box only used a short name
  ("Netflix"), not exercising the actual overflow risk (a long, unbroken subscription
  name across three places in the box) — added a dedicated long-name test at the
  tightest viewport.

**Findings investigated and rejected:**
- Security flagged "unrelated pending modifications to session.ts/queries.ts/email.ts/
  api/me/route.ts" as out-of-scope-but-present in the working tree — verified via
  `git status --porcelain` to be **false**; no such files are modified. Treated as a
  hallucinated claim, not acted on.
- Devil's Advocate suggested `computeHealthScore` (health-score.ts) should return its
  already-evaluated `HEALTH_RULES` results for engine.ts to reuse, instead of engine.ts
  evaluating them a second time. Considered and declined: the duplication is a single
  call to the same pure function with the same input (provably identical results, zero
  divergence risk), and avoiding it would mean changing `computeHealthScore`'s public
  signature — touched by its own dedicated, already-passing test suite — for a
  stylistic gain, not a correctness one. Kept the documented, lower-risk approach.
- Devil's Advocate questioned the arbitrary `subscriptionIds[0]` choice for
  multi-subscription findings like renewal clustering. Considered and left as-is: this
  matches an existing, established codebase pattern (`savings.ts`'s
  `category_concentration` recommendation already picks one representative subscription
  for a multi-subscription finding), and there's no clearly better heuristic for a
  renewal cluster specifically (unlike "priciest" for concentration, no subscription in
  a cluster is more relevant than the others).
- Both Devil's Advocate and Product/Data-Integrity noted the cancellation box's actual
  capability is "a search query the user could type themselves" — a fair, honest
  characterization reflected plainly in the final report rather than oversold.

Both CodeRabbit findings from a subsequent final pass (a "critical" duplicate-variable
claim and 2 "minor" try/finally suggestions) were investigated and rejected: the
"duplicate" declarations are in genuinely disjoint function scopes (confirmed via
direct inspection plus a clean typecheck/lint/passing test run); the try/finally
suggestion would make the 2 new test files the only ones in the 14-file e2e suite not
following the codebase's fully consistent no-try/finally cleanup convention.
