# Local Council — Phase 7: Make SubSentry Genuinely Indispensable

**Local council** — these perspectives all come from Claude playing different
roles, not from different AI vendors. Treat agreement as a shared starting
point to pressure-test, not as independent confirmation.

5 members (Product/value, UX/activation, Growth/retention, Security/privacy,
Maintainability/engineering), each independently evaluating 3 candidate
directions identified by a fresh codebase audit, before any implementation.

## Candidates evaluated

1. **"Confirmed savings" measurement** — sum `monthlyCents()` over every
   `status="canceled"` subscription (zero schema change; the row's
   amountCents/billingCycle survive a cancel, only a delete removes them).
2. **Merge "Quick wins" and "Savings opportunities"** into one ranked
   priority list, replacing both dashboard cards.
3. **Surface `isDuplicateOfExistingId`** (already computed by
   `detection.ts`, currently shown only as an aggregate count on the reveal
   screen) as a visible badge on the actual import review-table row, and
   exclude duplicate matches from default pre-selection.

## Priority rankings (independent, blind)

| Lens | Ranking |
|---|---|
| Product/value | 3 > 1 > 2 |
| UX/activation | 3 > 2 > 1 |
| Growth/retention | 1 > 3 > 2 |
| Security/privacy | 3 > 1 > 2 (no opinion on 2) |
| Maintainability/engineering | 1 > 3 > 2 |

## Shared starting points (stress-test, not corroboration)

**Candidate 3 is essentially unanimous** — #1 in 3/5, #2 in the other 2.
Every lens independently confirmed the same underlying fact by reading
`review-table.tsx` directly: line ~56's selection initializer checks
`confidence === "high"` only, never `isDuplicateOfExistingId`, so a
high-confidence detection of an already-tracked subscription is pre-selected
and can be silently re-imported as a real second charge. Security called
this "a self-inflicted-harm issue that corrupts the data Candidate 1 would
depend on." Growth called it "a load-bearing wall under all of them" — a
double-count here undermines trust in every other number the app shows.

**Candidate 1 is top-2 in 4/5 lenses**, with two findings converging
independently across multiple lenses (not from the prompt, which never
suggested either):
- **Naming collision**: `savings-card.tsx`/`insight-panels.tsx` already use
  "confirmed" to mean "deterministic duplicate match, not a fuzzy AI guess"
  ("Yearly savings from confirmed duplicates"). A second, differently-defined
  "confirmed" figure on the same product would directly conflate two
  concepts — flagged independently by Product/value, UX, and Security.
- **Causal-attribution honesty**: crediting SubSentry for every canceled
  subscription overclaims causation the app can't prove (a user may have
  canceled for reasons unrelated to any SubSentry-flagged issue) — flagged
  independently by Product/value and UX. Copy must describe the user's own
  action ("you've canceled N subscriptions, saving $X/mo"), not claim
  SubSentry did the saving.
- **Delete-interaction gap** (Product/value, Maintainability): the figure is
  a live query over currently-canceled rows, not a ledger — deleting a
  canceled subscription (already possible via the existing danger-zone
  delete) silently lowers it with no acknowledgment.

**Candidate 2 is ranked last by 4/5 lenses.** It surfaces zero new dollars
(Product/value, Growth), carries real regression risk in the exact seam
Phase 6's dead-code bug already lived in (Product/value's specific citation
of `engine.ts`'s duplicate-exclusion comment), needs a non-obvious new
ranking rule to avoid burying non-monetary urgent findings (renewal
clustering, renewal spike) beneath trivial-dollar items (Product/value and
UX independently), and would ship with zero component-test safety net in a
codebase that has none for React components (Maintainability). Only UX
ranks it #2, on the strength of matching an existing decluttering pattern
elsewhere in the codebase — a real but comparatively weak case against the
other four lenses' concerns.

## Genuine tensions

- Security explicitly separated itself from Candidate 2 ("no meaningful
  security surface either way — defer to other lenses") rather than padding
  a ranking with a lens that had nothing to say — treated as an honest
  abstention, not a missing data point.
- Growth/retention's #1 ranking of Candidate 1 rests on a distinction the
  other lenses under-weighted: it is the only candidate whose value
  compounds with account age (a monotonically-growing, historically-earned
  number) rather than only reflecting current account state. Growth also
  flagged that Candidate 1 has *no return trigger of its own* — it rewards
  a user who's already back, it doesn't pull them back — and suggested
  folding a running total into the existing renewal-reminder email
  (reusing Phase 5's send infrastructure) to convert it from passive to
  active. Evaluated and deferred: the renewal-reminder cron was deliberately
  tuned in Phase 5 for lean, minimal per-run queries; adding a live
  aggregate lookup inside that loop is a bigger, riskier change to
  already-sensitive production infrastructure than "smallest useful
  version" for this phase, not a same-phase addition.

## Blind spots flagged (repo-verified before accepting)

- Growth/retention named import-history's total lack of drill-down/diffing
  as "the single strongest imaginable retention loop" but correctly
  self-identified it as very likely needing a new persisted
  import-batch/diff table — confirmed via `schema.ts` (no such table
  exists) and left out of scope, flagged as the strongest Phase 8 candidate.
- Security flagged that email verification being inactive (a deliberate,
  reasoned Phase-0-era tradeoff — `signup/route.ts`'s own comment) becomes
  more consequential as more email-triggering / address-tied features ship
  on top of it. Not reversed this phase (would mean touching security-
  sensitive auth flow with no specific mandate to do so) — noted as a
  "conscious re-check," not silence, in the final report.
- Maintainability flagged one real coupling to watch: `OptimizationScoreCard`'s
  copy hardcodes a parenthetical reference to "(Savings opportunities)" by
  name — irrelevant once Candidate 2 is deferred, but worth remembering if
  that merge is revisited later.

## Suggested direction (synthesized, not any single member's)

1. **Build Candidate 3** as scoped by every lens: a visible badge (not a
   silent auto-merge/auto-modify — Security's explicit line) plus excluding
   duplicate matches from default pre-selection, still overridable by the
   user via the existing checkbox.
2. **Build Candidate 1**, but only after fixing what 2+ lenses independently
   found: use a UI term other than "confirmed" (avoiding the existing
   "confirmed duplicates" collision), write copy that describes the user's
   own action rather than claiming SubSentry caused the saving, and address
   the delete-interaction gap with an honest scoping note rather than
   blocking deletion. Land it on the dedicated `/savings` page rather than
   the dashboard's already carefully-tuned `SavingsCard` hero, to avoid the
   exact "two numbers on one screen" collision risk both Product/value and
   UX warned about specifically for that component.
3. **Defer Candidate 2.** Not a rejection of the underlying observation
   (the split genuinely is implementation-driven, per Maintainability's own
   read of `engine.ts`) — a disciplined scope decision given 4/5 lenses
   independently found the value-to-risk ratio weak for this phase, and the
   brief's own instruction that discovering a smaller scope than expected is
   an acceptable, even preferred, outcome.

---

## Final re-check — after implementation (3 members: Devil's Advocate, Security, Product/Simplicity)

Asked: did this actually increase user value, create unnecessary complexity, introduce
security risk, improve the discover→understand→act→verify loop, accidentally fabricate
intelligence, have a simpler alternative, be noticeable to a real user, and create
recurring value? Against the actual implemented diff, not the pre-implementation plan.

**Security: clean, and net-positive.** No new query surface (`computeRealizedSavings`
is a pure function over the already-`requireUser()`+`listSubscriptions(userId)`-scoped
array); `isDuplicateOfExistingId` was already computed server-side and already shipped
to the client before this diff — only *read* client-side now, never a new field.
Confirmed the selection-default change is exactly that: a default, not an auto-action —
the checkbox stays unconditionally enabled and the real import boundary
(`/api/imports/confirm`) is untouched. If anything, reducing accidental duplicate
re-imports is a data-integrity improvement, not a regression.

**Product/Simplicity: both features are proportionate, and deferring the third
candidate was correct.** No schema changes, no new queries, existing patterns reused
throughout (the currency-guard mirrors `money.ts`'s established
`sumMonthlyCentsIfSingleCurrency` rule). Confirmed the duplicate-detection fix "protects
the product's own credibility" — a silently re-imported duplicate would corrupt every
other savings number the app shows, not just this one feature. Flagged the same
causal-attribution nuance the *initial* council round already anticipated and the
copy was written to avoid (canceling for reasons unrelated to SubSentry still counts) —
judged as an honest, appropriately-scoped limitation, not a fabrication, given no
billing-verification integration exists to do better.

**Devil's Advocate found a real bug the initial round didn't anticipate, and it was
fixed**: `isPreselectedByDefault`'s duplicate check inherited detection.ts's pre-existing
`listSubscriptions()` call, which returns every status, not just active — so a detected
cluster matching a *canceled* existing subscription (a plausible legitimate
resubscription, exactly what a bank-sync import should catch) was being flagged and
default-deselected as if it were a mistake. This was a real, verified false-positive
class, not speculative. **Fixed**: `detectRecurringSubscriptions` now only matches
against `status === "active"` existing subscriptions; added `it.each(["canceled",
"paused"])` regression coverage in `detection.test.ts`.

**Also fixed**: Devil's Advocate noted editing (not just deleting) a canceled
subscription's amount silently changes "Money saved so far" with no disclosure — the
shipped copy only warned about deletion. Broadened the existing caption on `/savings`
to honestly cover both cases ("This reflects each subscription's current details —
editing or deleting a canceled one changes this total too") rather than adding
conditional logic to the edit form for one specific field.

**Investigated and not changed**: Devil's Advocate's point that "duplicate" is now used
for three related-but-distinct concepts across `savings.ts`, `insights.ts`, and the
import flow — on inspection, all three consistently mean "looks like the same service
as something else," just applied in different contexts (existing-vs-existing,
candidate-vs-existing); judged a coherent single concept, not the kind of two-meanings-
for-one-word collision the "confirmed" naming issue actually was. Also not changed: the
inherent attribution-fuzziness of showing a savings figure on a page titled "Smart
Savings" — the copy was already written to avoid causal claims, and no placement
avoids this entirely without abandoning the feature's home page altogether, which
Section 7 of the brief specifically asks for.

Second CodeRabbit pass after the detection.ts fix: 0 findings.
