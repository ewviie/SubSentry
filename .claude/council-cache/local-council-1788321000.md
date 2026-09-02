# Local council — SubSentry product synthesis pass

**Local council** — these perspectives all come from Claude playing different
roles, not from different AI vendors. Treat agreement as a shared starting
point to pressure-test, not as independent confirmation.

Question: product-strategy sanity-check on SubSentry's next roadmap move —
originally proposed: "surface the permanent realized-savings total + a
synthesized one-sentence 'what changed and why' explanation in the weekly
digest," weighed against (a) category-level spend trends, (b) a dashboard
"what changed since you last looked" panel, (c) causally linking a savings
recommendation to the realized-savings row it produced, (d) a renewal-price-
watch flagging an upcoming renewal at a newly-increased price.

## 🗳️ Devil's Advocate

Position: the proposed digest-lead is the weakest of the four — the ledger
is a rare/plateauing metric (one row per subscription, ever), and
`topPriorityNotification` already does ~80% of the "synthesis" work. Flags
that option (d)'s "upcoming... newly-increased price" framing needs
verification: price-history is written only after a price change is
observed, so a true pre-charge warning may not be deliverable as pitched.
Flags (c) is not schema-free (no recommendationId stored on `realizedSavings`
today) and may be the best Free→Pro moment, underweighted in the original
framing. Confidence: medium.

## 🗳️ Simplicity Advocate

Position: lead with (b) — dashboard "what changed" — not the digest line;
be skeptical of the digest option for being safe rather than strong, and of
(d) for being a "false-simplicity mirage" (price-history can't know a future
price before it's charged without new capture/integration). On Q3: the
defensible differentiator is a composed "spend statement"/Year-in-Review
over already-reconstructed lifetime-cost + lifetime-savings data — a view,
not a new algorithm; a moat because it needs the user's own accrued history,
which a new competitor can't have. Confidence: medium.

## 🗳️ Security Auditor

Position: ranks options by new write-surface/injection risk, not product
value. Confirms no IDOR in the realized-savings read/write paths (properly
userId-scoped). Flags the realized-savings ledger's immutability is
code-level only (no DB REVOKE/trigger) — fine today, worth hardening once
it's a flagship trust claim. The concrete guardrail: any new digest sentence
that names a subscription/category must go through the same `escapeHtml`
discipline `topPriorityNotification.title/body` already uses — the digest's
numeric-only lines are currently safe only because nothing else is
user-controlled text yet. Confirms (c) needs a new write path with
server-derived (never client-supplied) recommendationId to avoid IDOR.
Confidence: medium.

## 🗳️ Scalability Architect

Position: the schema is shard-friendly and event-triggered (storage scales
with real changes, not elapsed time) — a real asset. The actual risk is that
every intelligence surface computes on read, uncached, and the weekly-digest
cron's `MAX_CANDIDATES_PER_RUN = 200` is a silent-degradation risk at scale
(not urgent now). On cost-to-run: (a) [digest realized-savings line] and (d)
[renewal-price-watch] are both cheap (O(1)-ish, ride existing indexed
reads); (b) [category trends] is the one to be wary of — O(months ×
subscriptions × categories) computed synchronously with no materialized
rollup, the most likely to become a real latency issue as accounts
accumulate years of history. On Q3: the most defensible capability is a
"what will this renewal actually cost" forecast built on the existing
price-creep pattern (`computePriceHistoryCreep`) — same shape as (d),
composition not new detection. Confidence: medium.

## 🗳️ Maintainability Advocate

Position: option (a) is right, but only if "synthesize" means template
composition of already-computed fields (reusing the canonical
`SEVERITY_RANK` + impact-cents priority order verbatim), not a new
ranking heuristic — the real risk industry-wide on this exact codebase is a
*second, parallel* "what changed" algorithm that quietly disagrees with the
one `digest.ts`/`generate.ts` already own (this has already happened once
and been explicitly fixed, per the file's own header comment). Flags (b)
[category trends] would re-derive the currency-safety invariant N times
instead of once — a real duplication risk given how many places already
guard it. Flags (c) fights the ledger's self-contained immutability design
contract unless done as a snapshot, not a live FK. Independently also
flags a renewal-price-watch as cheap and composable from existing indexed
data. Confidence: high.

## Synthesis — angles, not consensus

**Shared starting point (stress-test, not corroboration):** all five
independently read the same files and reached materially different
rankings from the same evidence — that spread is the signal, not the
agreement. Two things nearly every member converged on despite different
lenses: (1) the *proposed* digest-only realized-savings line is
under-ambitious relative to its framing ("reuses 100% existing data" is
true but undersells that most of the synthesis work already exists via
`topPriorityNotification`); (2) a genuinely *predictive* renewal-price-watch
is not deliverable today — price history only ever records a change after
it's observed, so this can only ever be retrospective ("this renews soon
and already went up"), never anticipatory, without new capture
infrastructure.

**Genuine tension:** simplicity/devil push toward the dashboard (visible on
every visit, not gated behind a weekly send that goes silent in quiet
weeks) while maintainability defends the digest specifically as the
*disciplined* choice (least new surface area, reuses the one already-owned
ranking algorithm) — and scalability's cost analysis favors both about
equally. Resolving this requires checking whether the dashboard already has
a "what changed" surface at all (it does — `AttentionPanel` +
`getRecentActivitySummary`, verified directly in-session, independent of
the council) — which reframes the tension: it's not "digest vs. dashboard,"
it's "wire the one missing fact (realized savings) and the one missing
synthesis step into both already-existing surfaces via one shared function,
never two."

**Blind spots:** no member checked whether the dashboard already renders
something like option (b) — all five treated it as pure greenfield work.
Security's HTML-escaping guardrail and maintainability's "reuse the one
ranking algorithm, never build a second" are the two most concrete,
actionable constraints and apply regardless of which surface gets touched
first.

**Suggested direction:** thread `computeRealizedSavings` into both
`AttentionPanel` (dashboard, unconditional once `canceledCount > 0`, same
gating `/savings` already uses) and `WeeklyDigestSummary` (digest, appended
only to a digest that's already being sent for other reasons — never makes
a quiet week non-quiet, per devil's explicit warning against exactly that
spam pattern). Extend the *existing* `SEVERITY_RANK`/impact-cents ranking
(already shared by `getAttentionItems` and `topPriorityNotification`) to
compose a top-2 sentence instead of a bare top-1 title, as one shared
helper both surfaces call — not two independently-written versions.
