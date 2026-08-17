# SubSentry Detection Matrix

Every deterministic intelligence rule in the codebase, in one place, so a
signal can never be silently double-counted, contradicted by another rule,
or shipped with wording the evidence doesn't support. Written as part of
Phase 8 ("world-class intelligence upgrade") — see that phase's final report
for the product rationale; this doc is the maintenance reference.

**How to use this doc**: before adding a new rule, check whether an existing
one already covers the same underlying fact from a different angle. Before
changing a rule's wording or weight, check what else reads its `ruleId` or
`dimension` (the "Also referenced by" column) so a change doesn't silently
break an assumption elsewhere.

All rules are pure functions of `EngineContext` (`{ subscriptions, active,
todayIso, isPremium }`) or of a plain `Subscription[]` — none of them query
the database directly; every one operates on data a caller already fetched
through the existing `requireUser()`-scoped queries.

---

## Free-tier facts (`src/lib/insights-engine/rules/free.ts`)

Plain facts, never a signal/risk/opportunity — `severity: "info"` always,
no `scoreImpact`, never affects Health Score or Smart Savings.

| Rule ID | Required data | Positive example | Edge case | Wording | Health Score | Smart Savings |
|---|---|---|---|---|---|---|
| `free.biggest_subscription` | 1+ active sub | "Netflix is your biggest subscription — $15.99/mo" | 0 active → null | FACT | No | No |
| `free.cheapest_subscription` | 2+ active subs | "Spotify is your cheapest subscription — $9.99/mo" | <2 active → null (nothing to compare) | FACT | No | No |

---

## Dashboard summary insights (`src/lib/subscriptions/insights.ts` → `computeInsights`)

Feeds the dashboard's "Insights" strip and (for `possible_overlap`) the
standalone `/savings` page's headline total via
`computePotentialSavingsMonthlyCents`.

| Rule | Required data | Positive/negative example | Edge case | Confidence | Wording | Financial impact | Health Score | Smart Savings |
|---|---|---|---|---|---|---|---|---|
| `expensive_category` | 2+ active subs, 40%+ share in one category | "Streaming makes up 52% of your monthly spend" | Only 1 category present → no opinion (not "balanced") | High (deterministic) | SIGNAL | None claimed | No (dashboard-only) | No |
| `overdue_renewal` | Active sub(s) with `nextRenewalDate < today` | "3 subscriptions have overdue renewals" | 0 active → skipped | High | FACT | None claimed | No — see `health.overdue_renewals` for the Health Score version of this same fact | No |
| `high_yearly_spend` | 2+ active subs, a sub costing ≥2× the group's mean annual AND ≥$30/yr | "Adobe Creative Cloud costs $659.88/year, more than double a typical subscription here" | Top 2 outliers only, to avoid flooding the strip | High | FACT | Real, stated | No | No |
| `possible_overlap` (duplicate) | 2+ active subs, near-identical names (`namesLikelyMatch`) | "Possible duplicate: Netflix and Netflix Premium" | Excludes pairs already resolved elsewhere — none, this IS the canonical duplicate detector | High (deterministic name match) | RISK (has real $ evidence) | `potentialSavingsMonthlyCents` set | No — mirrored by `health.duplicates`, which **is** scored | Yes — `computePotentialSavingsMonthlyCents` sums this |
| `possible_overlap` (functional overlap) | 2+ active subs resolving to the same curated `OverlapGroup`, **excluding** any already flagged as a confirmed duplicate | "Netflix + Disney+ — all provide video streaming functionality" | A merchant with no assigned overlap group never contributes (most merchants) | Medium (curated group, not category) | OPPORTUNITY (review, not proven) | None claimed | No — mirrored by `health.functional_overlap` | No — this specific insight never sets `potentialSavingsMonthlyCents` |

---

## Health Score rules (`src/lib/insights-engine/rules/health.ts`)

Every rule declares a `dimension` (`spending` \| `redundancy` \| `growth` \|
`renewal` \| `hygiene`). Dimension weights: redundancy 0.3, spending 0.2,
renewal 0.2, hygiene 0.2, growth 0.1. Evidence tiers: STRONG=20,
MEDIUM=11, WEAK=5 score-impact points.

| Rule ID | Dimension | Required data | Positive example | Negative example | Edge case | Confidence | Wording | Health Score | Smart Savings |
|---|---|---|---|---|---|---|---|---|---|
| `health.duplicates` | redundancy | 1+ active subs | "No confirmed duplicates" (+8) | "2 confirmed duplicate subscriptions" (−min(n×20, 40)) | 0 active → engine-level null | High (deterministic) | positive branch: FACT; negative: RISK | Yes, STRONG | Mirrored by `duplicate` in savings.ts (same underlying pairs) |
| `health.functional_overlap` | redundancy | 2+ active subs in a shared overlap group, **excluding** already-duplicate-flagged members | (no positive branch — see rule comment) | "1 possible functional overlap" (−min(n×11, 22)) | Null if no group found; null (not double-counted) for a pair already caught by `health.duplicates` | Medium (curated group) | OPPORTUNITY | Yes, MEDIUM | Mirrored by `functional_overlap` in savings.ts |
| `health.concentration` | spending | 2+ categories present | "Balanced spending across categories" (+5) | "Streaming is concentrated — 62%" (−11) | 1 category only → null (not "balanced") | High | positive: FACT; negative: SIGNAL | Yes | No |
| `health.expensive_outliers` | spending | 2+ active subs | "No outsized subscriptions" (+5) | "1 outsized subscription" (−min(n×11, 22)) | <2 active → null | High | SIGNAL | Yes | No |
| `health.small_subscriptions_add_up` **(new, Phase 8)** | spending | 4+ active subs; 3+ costing ≤50% of the account's own mean, combined ≥20% of total spend | (no positive branch by design — see rule comment) | "3 smaller subscriptions add up to $9.00/mo" (−11) | Evenly-priced portfolio → null by construction (nothing is "small" relative to the mean); never overlaps with `expensive_outliers`' flagged subscriptions (mutually exclusive by the ≤50%/≥200%-of-mean math) | Medium (relative threshold, not absolute) | SIGNAL | Yes, MEDIUM | Mirrored by `small_subscriptions` in savings.ts |
| `health.long_running` | spending | 1+ active sub ≥365 days old | "2 long-standing subscriptions" (+5) | (no negative branch — absence of long-running subs is neutral, not bad) | 0 qualifying → null | High | FACT | Yes, WEAK | No |
| `health.recent_growth` | growth | — | "Steady subscription count" (+5, needs 2+ active) | "5 subscriptions were added to SubSentry in the last 30 days" (−5) | Bar deliberately high (5+, was 3+) — this app can't distinguish a genuinely new subscription from an old one bulk-imported today | **Low** (explicitly, in the wording itself) | Never claims "growing rapidly" — states only "added to SubSentry" | Yes, WEAK (lowest-weighted dimension for this reason) | No |
| `health.renewal_risk` | renewal | 1+ active sub with nonzero spend | "Renewals are well spread out" (+5, needs 3+ active); a cluster with a proportional total is **neutral, 0 impact**, not positive or negative | "More than usual is due in the next 30 days" (−11) — only when upcoming 30-day total > 1.5× typical monthly spend | Clustering by count alone (e.g. 4 cheap renewals the same week) never moves the score — only a genuine amount-based spike does | High (amount-based, not count-based) | Cluster-only: SIGNAL (informational); spike: RISK | Yes, MEDIUM (spike only) | No |
| `health.overdue_renewals` | hygiene | 1+ active sub | "No overdue renewal dates" (+5) | "2 overdue renewal dates" (−min(n×11, 22)) | 0 active → null | High | FACT / RISK | Yes | No |
| `health.uncategorized_imports` **(new, Phase 8)** | hygiene | 1+ **imported** (non-manual) active sub | "All imported subscriptions are categorized" (+5) | "1 imported subscription couldn't be categorized" (−5) | 0 imported subs at all (all-manual account) → null — a manually-chosen "Other" is a deliberate choice, not a data gap, so it's never counted here | High (deterministic: `category === "other" && source !== "manual"`) | FACT (about SubSentry's own classifier, not the user) | Yes, WEAK | No |
| `health.canceled_history` | hygiene | 1+ canceled sub (any status history) | "3 subscriptions canceled when no longer needed" (+min(n×5, 15)) | (no negative branch) | 0 canceled → null | High | FACT (positive habit) | Yes, WEAK | No |

---

## Premium rules (`src/lib/insights-engine/rules/premium.ts`)

Premium-only (`premium: true`), never shown to free-tier users, never
folded into the free Health Score.

| Rule ID | Required data | Positive/negative example | Edge case | Confidence | Wording | Financial impact | Health Score | Smart Savings |
|---|---|---|---|---|---|---|---|---|
| `premium.annual_switch_savings` | 1+ monthly-billed active sub, estimated annual saving ≥$5/year total | "Switching could save an estimated $37/year" | Discount is a documented, labeled assumption (15%), never a real per-provider rate | Low — explicitly labeled "estimated" throughout | ESTIMATE | Estimated only, never claimed as confirmed | Yes — folds into `optimizationScore`, never `savingsForecast` (which stays confirmed-only) | No |
| `premium.risk_high_spend_concentration` | 2+ active subs, outlier(s) whose combined annual cost is ≥50% of total annual spend | "Spend is concentrated in a few expensive subscriptions" | 0 outliers → null | High | RISK | None claimed | No (premium insights list only) | No |
| `premium.risk_renewal_cluster` | 4+ renewals in the same 7-day window AND the cluster total > 1.5× typical monthly spend | "4 renewals due the same week, well above typical spend" | Count alone (no amount evidence) never fires this — matches `health.renewal_risk`'s same amount-based bar | High (amount-based) | RISK | Real, stated | No | No |
| `premium.risk_rapid_growth` | 10+ subscriptions added to SubSentry in the last 30 days | "10 subscriptions were added to SubSentry in the last 30 days" | Never claims "growing rapidly" — states only what's known (added to SubSentry ≠ actually started) | Low (explicitly caveated) | SIGNAL | None claimed | No | No |
| `premium.risk_category_concentration` | 2+ categories, one ≥60% of monthly spend | "Streaming dominates your spend — 68%" | <60% → null | High | RISK | None claimed | No | No |
| `premium.risk_expensive_duplicate` | A confirmed duplicate whose redundant cost is ≥20% of total monthly spend | "Netflix Premium is an expensive, likely-unused subscription" | No duplicate crossing 20% → null | High (deterministic name match) | RISK | Real, stated | No | Overlaps conceptually with `health.duplicates`/savings.ts `duplicate`, but is a stricter, premium-only re-surfacing of the *same* underlying pairs at a higher-severity threshold — not a second independent detector |

---

## Smart Savings opportunities (`src/lib/subscriptions/savings.ts` → `computeSavingsRecommendations`)

The standalone, fully-actionable savings engine (distinct from the
dashboard-summary insights above). Every recommendation carries
`evidenceTier` (`"confirmed"` \| `"review"`), `impactCents` (real dollar
amount involved, proven or not), and `urgencyDays` (days until the soonest
involved subscription's renewal) — the three inputs `getSavingsPriority`
combines into `high`/`medium`/`low`, per Phase 8 Part 6's prioritization
requirement. See that file's own header comment for the exact ranking
formula.

| Type | Required data | Evidence tier | `monthlySavingsCents` | Example | Edge case | Priority ceiling |
|---|---|---|---|---|---|---|
| `duplicate` | 2+ active subs, near-identical names | confirmed | Real — the redundant subscription's own monthly cost | "Netflix and Netflix Premium look like duplicates" | Same-name pairs get natural phrasing ("Two Netflix subscriptions...") instead of "Netflix and Netflix" | `high` (only type that can reach it) |
| `functional_overlap` | 2+ active subs in a shared overlap group, excluding already-duplicate-flagged members | review | Always 0 — never a proven saving | "Adobe Creative Cloud + Canva Pro" | A pair already caught by `duplicate` is excluded here — see the shared exclusion logic in `computeFunctionalOverlapGroups` | `medium` |
| `small_subscriptions` **(new, Phase 8)** | 4+ active subs; 3+ ≤50% of mean, combined ≥20% of total | review | Always 0 — never a proven saving | "3 smaller subscriptions add up to $9.00/mo" | Evenly-priced portfolio never fires | `medium` |

`computeTotalPotentialSavingsMonthlyCents` sums `duplicate`-type
recommendations only, each distinct redundant subscription counted at most
once even if it matches more than one pair.

---

## Double-counting guards already in place

These are the specific cross-rule collisions this codebase has found and
fixed (with regression tests) — read before adding a new rule that touches
duplicates, overlap, or spending-outlier detection:

1. **Duplicate ∩ functional overlap** (`computeFunctionalOverlapGroups` in
   `insights.ts`): a pair already matched as a confirmed duplicate (e.g.
   "Netflix" / "Netflix Premium") is excluded from overlap-group
   participation, so the same pair never produces both a `duplicate` and a
   `functional_overlap` finding. Applies identically in `health.ts`'s
   `functionalOverlap` rule, `insights.ts`'s `possible_overlap`, and
   `savings.ts`'s `functional_overlap` type — all three call the same
   shared function.
2. **Small-subscriptions cluster ∩ expensive outliers**
   (`findSmallSubscriptionsCluster`): mutually exclusive by construction —
   "small" means ≤50% of the portfolio mean, "outlier" means ≥200% of it —
   verified by a regression test, not just asserted in a comment.
3. **Dimension status vs. netted score**: a dimension can carry an
   unrelated positive and negative finding at once (e.g. spending:
   "balanced across categories" alongside a genuine outlier) — the status
   (`good`/`watch`/`attention`) is **not** a pure function of the netted
   numeric score; any real negative evidence caps status below `good`, so
   an unrelated bonus can never buy back a "Good" label over a real
   problem.
4. **Unknown dimensions excluded from the weighted average**: a dimension
   with zero contributing rules (e.g. `growth` for a single brand-new
   subscription) reports `status: "unknown"` and its placeholder 100 is
   excluded from the overall score's weighted average via renormalization —
   it can never silently inflate the score the way a real "good" 100 would.
5. **`health.duplicates`' warning branch excluded from Quick Wins**: Savings
   opportunities already gives duplicates a fuller treatment (dollar
   figure, specific review target); Quick Wins filters this one ruleId's
   warning branch out to avoid rendering the identical finding twice on one
   page. Its *positive* branch ("No confirmed duplicates") is deliberately
   **not** filtered — Savings opportunities is silent exactly when that
   branch fires, so there's no collision to avoid for it.

---

## Phase 9 additions

- **Price history** (`subscription_price_history` table, `src/lib/db/schema.ts`):
  the #1 limitation this doc used to list below is now partially closed.
  One row is written at creation (`source: "initial"`) and again only when
  `amountCents`/`currency` genuinely change via an edit (`source:
  "user_edit"`, see `queries.ts`'s `updateSubscription`) — no fabricated
  backfill for pre-existing subscriptions. `src/lib/subscriptions/
  price-history.ts`'s `computeLatestPriceChange` reads this honestly:
  null until a subscription has 2+ distinct-amount rows, so a subscription
  edited for the first time after this shipped is the first to ever show a
  real "Price increased X%" note (`subscription-summary.tsx`'s detail
  page). **Not** wired into the health score or Smart Savings yet —
  scoped to the subscription detail page only, on purpose, until real
  price-change history actually accumulates across the user base.
- **Biggest opportunity** (`src/lib/insights-engine/biggest-opportunity.ts`):
  a single, ranked pick — confirmed high-impact saving > genuine renewal
  cash-flow spike > medium-impact saving > highest-cost subscription
  fallback — surfaced on the dashboard right under the hero row. Reads
  every candidate from `EngineOutput` fields other cards already compute;
  adds no new detection.
- **Subscription detail page** (`subscriptions/[id]/page.tsx`): now also
  shows share of total annual spend, the same health-rule findings that
  reference this subscription elsewhere on the dashboard ("why SubSentry
  flagged it"), a recommended action where one exists, related
  subscriptions from the same functional-overlap group, and the price
  history note above.

## Known limitations (not built this phase — see Phase 7.2 and Phase 8 final reports for full reasoning)

- **Price-change detection in the health score / Smart Savings**: the
  underlying history now exists (see "Phase 9 additions" above), but
  scoring/savings integration is deliberately deferred until there's
  enough real multi-row history across users to weight it responsibly —
  building that on day-one-empty history would be exactly the
  "manufacture a signal before the evidence exists" failure mode this doc
  exists to prevent.
- **"What changed since I last checked"**: infeasible to build honestly
  without persisted snapshots (health score history, opportunity
  appeared/disappeared tracking). `createdAt`/`updatedAt` alone can't
  reliably distinguish "just canceled" from "any other edit."
- **True parent-company merchant concentration** (e.g. grouping Prime
  Video + Audible + Amazon Music as "all Amazon"): would require a new
  parent-company mapping layer beyond `merchant-normalizer.ts`'s current
  product-level `KNOWN_MERCHANTS` table. Not built — the "small
  subscriptions add up" and existing category-concentration signals cover
  the same underlying risk (spend concentrated in a few places) without it.
- **Classification confidence**: not persisted on the `subscriptions` row
  (only transient in AI-parsing DTOs) — there is no way to query "which
  stored subscriptions were low-confidence classifications" after the fact.
