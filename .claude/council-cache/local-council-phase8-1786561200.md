# Local Council — Phase 8 SubSentry Intelligence Upgrade Review

> **Local council** — these perspectives all come from Claude playing different
> roles, not from different AI vendors. Treat agreement as a shared starting
> point to pressure-test, not as independent confirmation.

Roles: Devil's Advocate, Security Auditor, Maintainability Advocate, Compliance Officer, Simplicity Champion.

---

## 🗳️ Devil's Advocate

### Position
Well-organized, well-commented code, but the phase's central sales pitch — "the old model was arbitrary numbers, ours is principled evidence tiers" — is mostly rhetorical, and the new spending dimension can still double-penalize a single underlying fact through uncoordinated rule interactions.

### Key points
- The "arbitrary vs. principled" narrative doesn't survive scrutiny — STRONG/MEDIUM/WEAK and the dimension weights are asserted, not derived from any backtest.
- **Spending-dimension rules aren't as independent as claimed**: `health.concentration` and `health.expensive_outliers` can co-fire on the *same* underlying subscription (a lone expensive sub that's also alone in its category), stacking two penalties for one fact.
- `getSavingsPriority`'s $15 threshold is a flat, universal dollar bar — inconsistent with every other Phase 8 rule's "relative to the user's own portfolio" design principle.
- Priority-tier tie-breaking let a larger-dollar review-only finding outrank a smaller-dollar confirmed one within the same tier, distinguished only by a badge.
- `RULE_RECOMMENDED_ACTION` is an unchecked, string-keyed side table — only 1 of 9 entries had test coverage; a typo would silently degrade to `null`.

### Confidence
`medium`

**Fix status**: concentration/outliers double-count — **fixed** (suppression when the sole category member is already flagged as an outlier, regression tests added). Priority tie-break — **fixed** (evidenceTier now breaks ties before dollar amount, regression test added). `$15` flat threshold — **kept, documented**: a dollar amount is more legible as a "high impact" badge than a portfolio-relative percentage, and the phase's "avoid universal thresholds" principle was aimed at detection (does something qualify as evidence), not this presentation-layer bucketing. `RULE_RECOMMENDED_ACTION` coverage — **fixed** (see Maintainability below).

---

## 🗳️ Security Auditor

### Position
The Phase 8 diff itself introduces no new authz, injection, or data-exposure vulnerabilities — but the review surfaced two unrelated files in the repo root containing apparent IDOR-probing payloads against an unrelated third-party production system.

### Key points
- Ownership/IDOR: verified clean — every new function is a pure computation over an already `requireUser()`-scoped subscription array; no new query, no ID re-lookup.
- XSS: no new risk — all new render paths use plain JSX text interpolation.
- Prompt injection: pre-existing, already defended (`narrateInsightsSystemPrompt`), not a Phase 8 regression.
- Compounding O(n²) cost from multiple independent detection passes is worth a second look at the `MAX_ACTIVE_SUBSCRIPTIONS` ceiling, but same-tenant only, not attacker-controlled.
- **`idor-test.json`/`test-payload.json`**: unrelated GraphQL reconnaissance payloads targeting an unrelated third-party production host, unexplained, untracked.

### Confidence
`medium`

**Fix status**: the two unrelated files were surfaced to the user directly (outside the Phase 8 workflow) and deleted at the user's explicit direction. The Phase 8 diff itself required no security fixes. O(n²) compounding noted as a future perf-review item, not urgent.

---

## 🗳️ Maintainability Advocate

### Position
Unusually well-factored for a codebase this size, but the changes lean on hand-maintained prose (comments, `DETECTION_MATRIX.md`) as the mechanism keeping five interrelated files consistent, with no automated check tying that prose to the code.

### Key points
- `RULE_RECOMMENDED_ACTION` — stringly-typed, cross-file coupling, only 1/9 entries tested.
- A stale test name/assertion (`"sorts recommendations by monthly savings, descending"`) predated the Phase 8 sort rewrite and no longer verified what its name claimed.
- `DETECTION_MATRIX.md` is accurate today but nothing fails CI if a threshold constant drifts from the doc's prose.
- Clean separation of concerns overall: `signals.ts` (detectors) / `rules/health.ts` (scoring) / `health-score.ts` (aggregation) is a good layering, and shared primitives (`computeFunctionalOverlapGroups`, `findSmallSubscriptionsCluster`) are correctly reused rather than reimplemented.

### Confidence
`medium`

**Fix status**: `RULE_RECOMMENDED_ACTION` — **fixed** (exported for testing, added a structural test asserting every key matches a real `HEALTH_RULES` id, extended coverage from 1/9 to 9/9 rules via `computeHealthScore`-level tests). Stale test — **fixed** (renamed and rewritten to test same-tier dollar ordering, a genuinely distinct, previously-untested behavior). `DETECTION_MATRIX.md` drift risk — accepted as an inherent tradeoff of hand-written docs, not solved with new tooling (would be overbuilding for this phase).

---

## 🗳️ Compliance Officer

### Position
The five capabilities are compliance-neutral (no new data collection, no new retention, all derived from already-fetched fields) — the live issue is more directive `recommendedAction` language landing with no accompanying audit trail of what was shown to a user and when.

### Key points
- No new PII, no new storage — every new function is a pure derivation, never persisted.
- `uncategorizedImports`'s manual-vs-imported distinction is a genuinely good fair-processing choice — a user's own "Other" is never treated as a defect.
- `recommendedAction` strings are more directive than anything shipped before, though already appropriately hedged/conditional ("cancel it *if* it's no longer needed").
- No audit trail of what advisory text was shown to a user, when — pre-existing architectural gap, raised in stakes (not created) by more specific guidance.
- Anthropic classifier data-sharing (pre-existing, not part of Phase 8's 5 capabilities) has no documented data-processing disclosure.

### Confidence
`medium`

**Fix status**: reviewed all 9 `recommendedAction` strings — already consistently conditional/hedged, no rewording needed. Added an explicit code comment documenting the "review prompt, never an instruction, never implies SubSentry acted" boundary for future entries. Audit-trail gap and Anthropic data-sharing disclosure — both documented as out-of-scope, pre-existing limitations in the final report; no persistence added (consistent with "don't add database history requirements unless genuinely required").

---

## 🗳️ Simplicity Champion

### Position
Individually well-justified, but two concrete instances of avoidable duplication slipped in, most notably identical title strings copy-pasted across `health.ts` and `savings.ts` whose neighboring description text had *already* drifted apart.

### Key points
- `RULE_RECOMMENDED_ACTION` — same cross-file string-coupling concern as Maintainability.
- **Literal copy-paste**: the exact same title template in `health.ts` and `savings.ts`, with the description one line below already diverged (`savings.ts` had gained an extra sentence `health.ts` never got) — duplication risk manifesting in real time, not hypothetical.
- `impactCents`/`monthlySavingsCents` as two parallel dollar fields — their relationship enforced only by a comment, not the type system.
- `DETECTION_MATRIX.md` is useful today but is itself a symptom of rules that now cross-reference each other more than their file boundaries suggest.

### Confidence
`medium`

**Fix status**: duplicated title — **fixed** (extracted `smallSubscriptionsClusterTitle` into `insights.ts`, used by both callers; descriptions deliberately kept separate, matching how every other rule pair in the codebase already writes distinct health-summary vs. savings-card copy). `impactCents`/`monthlySavingsCents` — kept as two fields: a type-level invariant here would require an awkward discriminated union for a relationship already clearly documented in a comment; changing it would be over-engineering by this same lens's own standard.

---

## Synthesis

**Shared starting point to stress-test, not corroboration**: three of five members (Devil's Advocate, Maintainability, Simplicity) independently converged on the same underlying fact — `RULE_RECOMMENDED_ACTION`'s cross-file string coupling with thin test coverage. Because all three are the same model, this convergence is a signal about how *legible* that risk is from the code itself, not three independent confirmations; it was still worth fixing given how easy the failure mode (silent `null`) is to reproduce.

**Genuine tension**: Devil's Advocate's "the weights are still arbitrary, just better-dressed" critique and the phase's own design philosophy are in real tension that no amount of code review resolves — SubSentry has no ground-truth outcome data to calibrate against, a structural limitation the final report documents rather than papers over.

**Blind spot no member covered**: none of the five roles flagged the exact scenario this project surfaced organically — unrelated, unexplained files in the working directory. That's outside all five lenses' scope by design (none of them audit "does this repo contain content that doesn't belong here at all"), which is itself worth noting for future reviews.

**Suggested direction**: all concrete, verifiable findings (concentration/outliers double-count, priority tie-break, `RULE_RECOMMENDED_ACTION` coverage, stale test name, duplicated title string) were fixed with regression tests. The two judgment-call findings ($15 flat threshold, `impactCents`/`monthlySavingsCents` split) were evaluated and kept as-is with documented reasoning, not changed reflexively.
