# Local Council — Phase 2: Discovery→Review→Savings Loop

**Local council** — same-model role-play, not cross-vendor. Agreement = shared prior to stress-test, not corroboration.

## Synthesis

**5/5 convergence**: all 3 concrete gaps (review-action-bar total, import-complete-step total, edit-subscription-form cancel feedback) are legitimate, cheap, additive display-layer fixes over data already in scope. None require touching detection.ts/insights-engine/savings.ts.

**4/5 convergence (Devil, Maintainability, Security, implicitly Simplicity)**: currency is unvalidated free text per-row at review/detection time (confirmed: `RawTransaction.currency` set independently per transaction by CSV/Plaid/TrueLayer). A naive cross-row cents sum can silently produce a wrong, confidently-labeled dollar figure for a mixed-currency selection — directly violates the "no fabricated numbers" constraint. Resolution: only show a single summed total when the selection is single-currency; otherwise degrade honestly (omit or per-currency breakdown), never mislabel.

**Devil's Advocate — precise gating requirement**: "you'll save $X/mo" must only fire on a genuine active→canceled transition (compare previous vs. new status), never on pause (not permanent) or delete (could be a duplicate/data-entry correction, not real savings).

**Simplicity — DRY requirement**: one shared cents-summing utility reused by review-action-bar and import-complete-step, not two independently-written sums that can drift (echoed independently by Maintainability).

**Scalability — one additional real, near-term bug** (not speculative): `review-table.tsx`'s "select all" can select more rows than `importConfirmSchema`'s hard `.max(200)` cap, producing a generic Zod failure with no guidance. Reachable today by any user with a large legitimate bank history. Worth fixing alongside Gap 3 since already touching that file.

**Correctly out of scope this pass** (all lenses who raised it agreed): persisting dismissed savings recommendations (gap 5, cosmetic), funnel instrumentation (devil's suggestion, contradicts "small fix" scope), O(n²) savings computation at the 2000-subscription ceiling (scalability: "log it, don't schedule it," and forbidden to touch per brief anyway).

## Suggested direction

Implement:
1. Multi-currency-safe running total in review-action-bar (single-currency selections only; graceful fallback otherwise), reusing one new shared summing helper.
2. Same helper reused in import-complete-step for a real dollar total + link to /dashboard (not /savings — savings may be empty on a first import, per Devil).
3. Status-diff-gated "you'll save $X/mo" toast in edit-subscription-form, active→canceled only; delete gets the unconditional single-subscription monthly figure (Maintainability: no ambiguity there since the row is definitely gone).
4. Guard against selecting/submitting more than 200 rows in review-table's "select all", with clear copy (not a silent Zod failure).

Full per-member transcripts collected in this session; condensed here per token-efficiency instruction.
