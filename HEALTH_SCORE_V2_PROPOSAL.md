# Subscription Health Score v2 — Design Proposal (NOT YET APPROVED)

Status: proposal only. No implementation files touched. Do not build against this until explicitly approved.

Scope note up front, because it drives every decision below: this document is grounded entirely in what `SubSentry`'s actual schema and existing computation modules can support today (verified by reading `schema.ts`, `signals.ts`, `insights.ts`, `savings.ts`, `price-history.ts`, `rules/health.ts`, `health-score.ts`, `types.ts`). Where the brief asks for a signal the data cannot honestly support, that is stated explicitly as **UNAVAILABLE** with the reason, not approximated with invented data. Several signal families the brief asks to "investigate" were already investigated once, by name, in a prior reviewed pass (see `rules/health.ts`'s own header comments) and deliberately rejected as manufactured warnings (raw subscription count, monthly-vs-annual billing mix). Re-litigating them here reaches the same conclusion for the same reason; that's called out per-family below rather than silently dropped.

---

## 1. Existing model

- 12 rules in `HEALTH_RULES` (`rules/health.ts`), each tagged with one of 5 dimensions: `spending`, `redundancy`, `growth`, `renewal`, `hygiene`.
- Each rule returns a signed `scoreImpact` on a `STRONG=30 / MEDIUM=16 / WEAK=8` tier scale, capped per-rule at 2-4x its tier.
- `computeHealthScore` (`health-score.ts`) scores each dimension independently: `100 + sum(deltas)`, clamped 0-100.
- Overall score = weighted average of *known* dimensions (`spending .2, redundancy .3, growth .1, renewal .2, hygiene .2`) minus a `worstDimensionPenalty` (up to 15 pts, based on how far the single worst dimension sits below 90). A dimension with zero firing rules is `"unknown"` and excluded from the average (never defaults to a silent 100).
- Confidence (`high/medium/low`) is computed **separately** from the score, from active-subscription count + account history depth. It is already never blended into the number — this is exactly the separation the brief asks for in §8/§Confidence.
- Already has 2 review-driven rebalance passes behind it (see the file's own comments) specifically to fix "83/100 Very Good next to genuinely concerning numbers" — the exact failure mode this brief is also targeting.

## 2-4. Complete signal inventory: available / unavailable

| # | Family | Verdict | Detail |
|---|---|---|---|
|1| Cost burden | **Partially available** | Monthly/annual totals, per-sub share, median/max cost, top-1/3/5 concentration, category HHI — all real arithmetic on `amountCents`/`billingCycle`. Raw spend *magnitude* alone is correctly excluded (brief's own §1 caveat: "$1,000 shouldn't be bad merely for being expensive" — matches existing design). |
|2| Redundancy | **Available** | `findDuplicates` (confirmed, deterministic name-match) + `computeFunctionalOverlapGroups` (review-tier, curated same-purpose groups) already exist and already are exactly the brief's "confirmed" vs "possible duplicate" split. |
|3| Unused/low-value | **UNAVAILABLE** | Grepped the whole codebase: zero usage/last-active/dormancy data exists anywhere (no field, no table). `smallSubscriptionsAddUp` is a **cost-shape** proxy ("many cheap ones add up"), not a usage signal, and must not be relabeled as one. |
|4| Renewal risk | **Available** | `nextRenewalDate` per sub, parameterized `upcomingRenewalTotalCents(days)`, `findRenewalCluster`, `overdueRenewals`. "Missing renewal date" is **structurally impossible** — the DB column is `NOT NULL` — so that sub-signal is dropped, not implemented as a no-op. |
|5| Portfolio complexity | **Mostly UNAVAILABLE as a scored signal** | Raw subscription count and billing-cycle-mix were already investigated and rejected in the current model ("having many subscriptions is not inherently unhealthy... scoring it was manufacturing a warning to populate the UI" — `rules/health.ts` header). Same conclusion holds here. The one legitimate complexity signal already exists: `uncategorizedImports` (hygiene). |
|6| Growth/creep | **Available, weak evidence** | Only `createdAt` (when a row entered SubSentry) exists — no way to distinguish "genuinely new" from "10-year-old subscription just imported." Already the acknowledged weakest dimension; stays that way. |
|7| Savings opportunity | **Available, confirmed vs. estimated already split** | `savings.ts`'s `evidenceTier: "confirmed" | "review"` is precisely this. "Estimated annual-plan savings" (a specific dollar estimate of switching monthly→annual) is **UNAVAILABLE**: no provider list-price table exists anywhere in this codebase, so any such number would be a fabricated generic assumption — exactly what the brief prohibits. |
|8| Data quality | **Available, and narrower than the brief assumes** | `amountCents`, `currency`, `billingCycle` are all `NOT NULL` at the DB level — cannot be missing. Per-subscription import *confidence* (`Confidence` type in `imports/detection.ts`) is used only at review-time and **is never persisted** on the subscription row, so "low-confidence merchant identity" is not a fact this app can state about an existing subscription. What's real: `uncategorizedImports` (classifier gap), and price-history *coverage* (what % of the portfolio has ≥2 price points to reason about). |
|9| Price/billing anomalies | **Available, narrow scope, must be stated honestly** | `subscriptionPriceHistory` + `computeLatestPriceChange` are real and already wired into `health.price_increases`. Critical existing caveat that must survive into v2 verbatim: **no import path writes a history row for an existing subscription today** — only a user's own edit does. This can only ever catch a price hike the user typed in, not one a provider raised silently. Frequency-of-change (2+ recorded changes) is a new, legitimately available extension of the same data. |
|10| Category risk | **Available** | `categoryConcentration` returns only the top category's share; extending to a full category HHI is pure arithmetic on data already grouped. |
|11| Merchant patterns | **Mostly UNAVAILABLE / subsumed** | There is no merchant field distinct from `name`. "Multiple subs from the same merchant" *is* what `findDuplicates`' name-matching already detects. A separate "merchant concentration" metric would be double-counting the same underlying fact through a different label — flagged in the dependency map (§ below), not built as a second signal. |
|12| Billing efficiency | **UNAVAILABLE as a scored signal** | Requires knowing a provider's real annual-plan price to estimate savings — no such data exists (see #7). "Monthly billing is inherently worse" was already investigated and explicitly rejected in the current model for good reason (it isn't true). Re-affirmed, not re-opened. |
|13| Financial concentration | **Available** | Top-1/3/5 share and HHI are pure arithmetic over already-known per-sub monthly cost. This is new relative to today's model (today only has a single-category-share check and an absolute 2x-mean outlier test) and is the one clearly "mathematically appropriate, improves the score" addition the brief calls for. |
|14| Portfolio consistency | **Available, but folds into redundancy, not a new score line** | "Same near-identical name, different price" is literally `findDuplicates`' own pair data viewed from a different angle — scoring it separately double-counts the same pair. Proposal: enrich the existing duplicate finding's description with the price delta; no new scored rule. |
|15| Account history | **Available, deliberately kept out of the score** | Account age already feeds `confidence`, not the score — and the brief's own instruction ("do not penalize users for having a long history") is the reason it stays there. `canceledCount` (hygiene, positive-only) already exists. **New and genuinely available**: reactivation — a currently-active subscription whose name fuzzy-matches a *canceled* one on the same account (`ctx.subscriptions`, not just `ctx.active`, is already in `EngineContext`). |
|16| Behavioral warning signals | **One genuinely available, rest UNAVAILABLE** | `dismissedSavingsRecommendations` (userId, recommendationId, dismissedAt) already exists in the schema and is **not currently read by the health engine at all**. Cross-referencing it against `computeSavingsRecommendations`' confirmed duplicates lets us detect "a confirmed duplicate was already surfaced and dismissed, and is *still unresolved*" — real, factual, no inferred intent. Everything else in this family (psychological framing, "repeatedly adding similar subscriptions" as a trait) is explicitly out of scope per the brief's own "do not infer intent" rule. |

## 5-11. Proposed model: hierarchy, normalization, categories, weights, formulas

**Keep the existing architecture's skeleton** (5 dimensions, dimension-local 0-100 scoring, weighted overall, separate confidence) — it is sound and already reviewed twice; the fix is richer, continuous, magnitude-aware signals feeding it, plus a harsher aggregation step, not a rewrite.

**Dimension weights: unchanged** (`spending .2, redundancy .3, growth .1, renewal .2, hygiene .2`) — no new evidence changes which dimensions are best-evidenced.

### Redundancy (weight .3)

- **Duplicates** (replaces flat `-min(n*30, 60)`):
  `penalty = -min(60, round(24 * f(n) * g(share) * staleness))`
  - `f(n) = 1 + 0.4·ln(1+n)` — diminishing returns per additional pair (1→1.28×, 3→1.55×, 5→1.72×), not linear.
  - `g(share) = 0.6 + 0.9·min(share, 0.35)/0.35` where `share` = confirmed-duplicate monthly cost ÷ total monthly spend — a $10 duplicate in a $2,000/mo portfolio and a $10 duplicate in a $50/mo portfolio no longer score identically.
  - `staleness = 1.15` if any involved duplicate's recommendation id is in `dismissedSavingsRecommendations` **and** the pair is still present today (dismissed but never actually resolved); else `1.0`. Requires one new `EngineContext` field (`dismissedRecommendationIds: Set<string>`).
- **Functional overlap** (review tier, unchanged shape): `-min(32, round(16*(1+0.3·ln(1+groups))))`.
- Dependency guard carried over unchanged from today's code: a pair already scored as `duplicates` is excluded from `functionalOverlap`'s count if it's the same subscription pair (prevents the same two subscriptions being penalized twice under two labels).

### Spending (weight .2)

- **Category concentration**: generalize from "top category share" to full **category HHI** (`Σ share²` across all categories). Piecewise: `HHI<0.30→0`, `0.30-0.50→` linear 0 to −16, `0.50-0.80→` linear −16 to −30, `>0.80→−30` (cap). Existing single-contributor-is-already-an-outlier silencing rule is preserved.
- **Portfolio concentration (new)**: same HHI formula, computed over *individual subscriptions'* share of monthly spend instead of categories. Its penalty and the existing `expensive_outliers` rule's penalty are **combined by `max()`, never summed** — both are different measurements of the same underlying fact ("one subscription dominates"), so only the larger applies. This is the direct fix for the brief's anti-double-counting requirement on "high-cost count + top-1 concentration."
- **Expensive outliers**: unchanged detection (≥2× mean annual, ≥$30/yr floor), unchanged tier, now folded into the `max()` above rather than stacking independently.
- **Price increases**: unchanged `-min(32, count*16)` for genuine recorded increases, **plus** a new flat `-8` (once, not per-sub) if any subscription shows 2+ recorded changes in the trailing 12 months ("repeated change" pattern), combined cap stays 32 for this rule. Framing must retain the existing scope caveat verbatim (only catches user-typed price edits today).
- **Small-subscriptions-add-up**: unchanged, `-16` flat.
- **Long-running**: unchanged, `+8` positive-only.

### Growth (weight .1, deliberately capped low — unchanged rationale)

- Replace the binary "≥5 added in 30 days" with a **rate**, not a raw count: `rate30 = recentGrowthCount(30) / max(active.length, 1)`, with a floor requiring the raw count ≥3 (so 1-of-2 subscriptions being new never trips this). Tiers: `<15%→0, 15-30%→-4, 30-50%→-8, >50%→-8` (cap). This directly fixes "more subscriptions should not automatically mean bad" — a large, healthy, slowly-growing portfolio and a tiny, rapidly-multiplying one are no longer compared on the same raw-count scale.
- **Acceleration kicker**: `rate30 > 2× rate_prior30` (days 30-60 ago) *and* raw count ≥3 → additional `-4`, combined cap `-16` for this rule (up from today's flat `-8`, deliberately harsher for a genuine step-change, still WEAK-dimension-scaled).

### Renewal (weight .2)

- **Exposure** (replaces binary `upcoming > monthly*1.5`): continuous ratio `r = upcoming30 / monthly`. `penalty = -min(24, round(16 * clamp((r-1.3)/(2.0-1.3), 0, 1)))` — starts accumulating softly at 1.3× instead of a hard cliff at 1.5×, but now reaches a harsher ceiling (−24 vs today's flat −16) by 2.0× instead of needing 1.5×. Gentler at the margin, harsher at genuinely bad values — directly the brief's diminishing-returns-except-at-the-real-problem ask.
- **Renewal-date entropy (new, narrow)**: only evaluated when the exposure rule above finds no dollar spike — a normalized concentration measure (1 − Shannon entropy, or HHI) over ISO-week buckets of `active` renewal dates, active.length≥4. Fires only for an unusually clustered date pattern beyond what the existing informational 3-item/7-day cluster already reports: `-8` flat. This is timing-pattern evidence, independent of the dollar-exposure metric above (a portfolio can be low-exposure but weirdly clustered), so it's additive, not a duplicate of the exposure rule.
- **Overdue renewals**: unchanged, lives in `hygiene` (bookkeeping neglect), not `renewal` — preserving the existing, correct split between "forward risk" and "recordkeeping."
- Explicitly rejected: separate scored windows at 7/60/90 days. The 30-day window is the one scored figure; 60/90-day totals may be shown as **informational, unscored** breakdown lines (same dollars, would double-count if also scored).

### Hygiene (weight .2)

- **Overdue renewals**, **uncategorized imports**, **canceled-history positive**: unchanged.
- **Reactivation (new)**: any active subscription whose normalized name fuzzy-matches (`namesLikelyMatch`) a *canceled* subscription on the same account → flat `-8` regardless of count (ambiguous evidence — could be a deliberate, fine re-subscription — so no per-instance scaling).
- Multi-currency coverage gap: **moved out of scoring entirely**, into confidence only (see §12) — this is data this app can't reason about, not evidence the user did something wrong, matching the brief's "poor data quality reduces confidence, never blindly punishes."

### Overall aggregation (harsher, structural, not per-rule)

```
overall_raw   = Σ(dimension.score × weight) / Σ(known weights)
worst_penalty = min(20, max(0, (90 - min(known dimension scores)) × 0.25))     // was 15 / ×0.2
spread_penalty= max(0, count(known dims with score < 70) - 1) × 6, capped 18  // NEW
score         = clamp(round(overall_raw - worst_penalty - spread_penalty), 0, 100)
```

`spread_penalty` is the direct fix for "duplicates + concentration + poor renewal hygiene together should score poorly even if no single dimension alone is severe" — it activates only when **multiple** dimensions independently show real problems, so it can never fire from one bad dimension alone (that's `worst_penalty`'s job) and can never fire on a clean account (needs 2+ dimensions below 70).

Rating bands (`92/80/65/45`) stay as-is — the harsher aggregation above changes how many accounts land where, not the meaning of each band.

## 12. Confidence methodology (extends, doesn't replace, existing logic)

Existing basis (active count, history depth) is kept. **Added**: if `splitByPrimaryCurrency(active).included.length / active.length < 0.7` (most money-based signals only ran over the majority-currency slice), cap confidence at `medium` regardless of the other two factors, with reason `"A meaningful share of your subscriptions are in a different currency and weren't included in dollar-based signals."` This is the direct fix for "sparse/fragmented data cannot produce false confidence" applied to a real, currently-silent gap (today the whole engine quietly drops non-primary-currency subscriptions from money math with no confidence signal at all).

Score vs. confidence stay **structurally separate returns**, as today — a 72/Low and a 72/High are never rendered with the same visual weight; that's a UI concern downstream of this file, not something the model needs to encode into the number itself.

## 13. Dependency / anti-double-counting map

| Signal A | Signal B | Resolution |
|---|---|---|
| Confirmed duplicates | Functional overlap | Same pair excluded from B if already in A |
| Confirmed duplicates | Portfolio consistency ("same merchant, different price") | B is not a separate score — folds into A's description only |
| Expensive outliers | Portfolio concentration (HHI) | `max()`, never summed, when driven by the same subscription |
| Category concentration | Expensive outliers | Existing single-contributor silencing rule, unchanged |
| Duplicate count | Duplicate spend-share | Combined into one formula (`f(n)·g(share)`), never two additive lines |
| Merchant concentration | Confirmed duplicates | Not built as a separate signal — no data distinguishes "merchant" from "name" beyond what duplicate-matching already uses |
| Renewal exposure (30d) | Renewal windows (7/60/90d) | Only 30d is scored; others informational-only |
| Renewal exposure | Renewal-date entropy | Independent evidence (dollar risk vs. timing pattern); entropy only fires when exposure found no spike, to avoid restating the same cluster twice |
| Recent-growth rate | Growth acceleration | Same underlying `createdAt` data, two different windows — acceleration only adds on top when it represents a genuine step-change, capped combined |
| Portfolio/category complexity (raw count) | — | Not scored at all (previously rejected; re-affirmed) |
| Account age | — | Confidence only, never score (unchanged) |
| Multi-currency coverage | — | Confidence only, never score (new, moved out of scoring) |

## 14. Confidence-vs-score, restated

A score is never adjusted for data quality — a data gap makes the engine **say less** (dimension `"unknown"`, or capped confidence), never inflate or deflate the number itself. This principle already exists in the code (`"unknown"` dimensions are excluded from the weighted average rather than defaulting to 100) and is extended, not changed, by the multi-currency confidence cap above.

## 15. Synthetic portfolio calibration (20 scenarios)

Exact scores require running the real formula in code (the brief's own §"Score calibration" asks to compare *independently calculated* expectations against the implementation — that comparison is the automated calibration test suite in §19, run against real TypeScript, not hand arithmetic that risks its own errors). What can be stated precisely now is the **expected band and the dominant reason**, which is what an approver needs to sanity-check the model's shape before implementation:

| # | Portfolio | Expected band | Rating | Confidence | Why |
|---|---|---|---|---|---|
|1| Perfect (8 subs, no dupes/overlap/outliers, spread renewals, all categorized) | 95-100 | Excellent | High | Zero negative evidence anywhere → no worst/spread penalty |
|2| One subscription only | 85-95 | Very Good/Excellent | Low | Most dimensions `"unknown"` (need 2+ subs); low confidence caveats this explicitly |
|3| Cheap portfolio ($20/mo total, 4 subs, clean) | 90-100 | Excellent | Medium/High | Low spend is never itself penalized (matches brief §1) |
|4| Expensive but clean ($900/mo, 6 subs, no concentration/dupes) | 85-95 | Very Good/Excellent | High | High spend alone never penalized; only fires if concentrated |
|5| Duplicate-heavy (4 confirmed pairs, 25% of spend) | 30-45 | Fair/Needs Attention | High | `f(4)≈1.65 × g(0.25)≈1.24` → near the 60-cap; redundancy dimension collapses |
|6| High-growth (8 of 10 subs added in 30 days) | 55-70 | Good/Fair | Medium | `rate30=80%` → growth dimension floor (`-8`, weight .1 limits overall drag — matches "warning, not catastrophic") |
|7| High-concentration (one category = 85% of spend) | 45-60 | Fair | High | Category HHI in top band (`-30`) drives spending dimension down hard |
|8| High-renewal-risk ($1,200 due in 30 days vs. $300 typical, `r=4`) | 40-55 | Fair | High | Exposure penalty maxed (`-24`) + likely dimension floor |
|9| Poor data (2 subs, 3 days old) | wide/unreliable | any | Low | Confidence caveat is the headline, not the number |
|10| Large but healthy (150 subs, well spread, 3 added recently) | 85-95 | Very Good/Excellent | High | Rate-based growth (2%) and no other negative evidence — large count alone never penalized |
|11| Small but inefficient (5 subs, 2 confirmed dupes, 1 overlap) | 35-50 | Needs Attention/Fair | Medium | Redundancy dominates a small, low-weight-diluted portfolio |
|12| High *estimated* savings only (functional overlaps, no confirmed dupes) | 65-80 | Good/Very Good | High | Review-tier evidence is capped softer (`-32` max) than confirmed |
|13| High *confirmed* savings (3 confirmed pairs, large $) | 30-45 | Fair/Needs Attention | High | Confirmed + magnitude multiplier both push hard |
|14| Many possible (functional-overlap) duplicates, zero confirmed | 60-75 | Good | High | Overlap-only penalty ceiling (`-32`) is deliberately softer than confirmed |
|15| Many confirmed duplicates (6+ pairs) | 15-30 | Needs Attention | High | Redundancy penalty hard-capped at `-60`; dimension near 40, drags overall via worst+spread penalties |
|16| Mixed billing (monthly/yearly/quarterly spread, otherwise clean) | 90-100 | Excellent | High | Billing mix is not scored (§12 unavailable-as-signal, re-affirmed) |
|17| Category-concentrated but small (2 subs, 1 category) | 85-95 | Very Good/Excellent | Medium/Low | `categoryConcentration` returns null at ≤1 category by design — no opinion, not a penalty |
|18| "Merchant"-concentrated (3 subs, same normalized name, none flagged) | n/a — this *is* the duplicates rule | — | — | Confirms §11's subsumption: this scenario is scored entirely by `health.duplicates`, no separate merchant line exists |
|19| Price-increase-heavy (5 of 8 subs with recorded +15-40% increases) | 40-55 | Fair | High (if history covers most subs) / Medium otherwise | Base penalty near cap (`-32`) plus repeated-change flat `-8` |
|20| Worst-case (dupes + concentration + renewal spike + overdue, all severe) | 0-15 | Needs Attention | High | Every dimension floors near 0 → `worst_penalty` maxes at 20, `spread_penalty` maxes at 18 on top |

## 16. Edge cases

- **Zero active subscriptions**: `computeHealthScore` returns `null` today — unchanged, correct.
- **All-canceled account**: same as zero-active; canceled history itself never scores (it's positive-only and requires `count>0`, fine either way).
- **Single currency-fragmented portfolio** (10 subs, 6 different currencies, none dominant): most money-based rules silently see a tiny `included` slice; confidence cap (§12) is the safety net, not the score.
- **A dimension with literally one rule firing, and it's a tie for "worst"**: `Math.min` picks one; `spread_penalty` still counts every dimension below 70, so ties don't under-penalize.

## 17. Monotonicity / invariant tests (must pass before ship)

1. Score is always in `[0,100]` for randomized fuzz-generated portfolios (property test, not just the 20 fixed cases).
2. Adding a confirmed duplicate to an otherwise-fixed portfolio never increases the score.
3. Increasing a confirmed-duplicate's cost (holding everything else fixed) never increases the score.
4. Removing a confirmed duplicate never decreases the score.
5. Fixing an overdue renewal date never decreases the score.
6. Improving price-history coverage (adding real, non-increasing price points) never decreases the score.
7. A portfolio that is a strict superset of a clean portfolio, with only harmless small additions (no dupes/overlap/concentration/overdue), never drops more than a small bounded amount (guards against "adding subs alone tanks the score," the brief's own explicit invariant).
8. A worst-case fixture (per #20 above) never lands above 20.
9. A perfect fixture (per #1 above) always lands at 92+ (Excellent band).
10. `confidence.level === "low"` fixtures never simultaneously report `score >= 90` without the UI-facing caveat present (i.e., sparse data can't present as confidently excellent) — this is already true structurally (score and confidence are independent fields) but gets an explicit regression test so a future change can't quietly couple them.

## 18. Required code changes

- `src/lib/insights-engine/signals.ts`: add `portfolioConcentrationHHI`, `categoryHHI`, `renewalExposureRatio`, `renewalDateEntropy`, `reactivationCandidates`, `priceChangeFrequency`, `growthRate` (rate-based, replacing raw-count reads inline in the rule).
- `src/lib/insights-engine/rules/health.ts`: rewrite `concentration`, `outliers` interaction (max-combine), `recentGrowth`, `renewalRisk` bodies per formulas above; add `reactivation` rule (hygiene).
- `src/lib/insights-engine/types.ts`: add `dismissedRecommendationIds?: Set<string>` to `EngineContext`.
- `src/lib/insights-engine/engine.ts` (or its DB-loading caller): one new bulk query for the current user's `dismissedSavingsRecommendations` ids, passed into `EngineContext` — same "one bulk query, no N+1" pattern `priceHistoryBySubscriptionId` already follows.
- `src/lib/insights-engine/health-score.ts`: `worstDimensionPenalty` constants (20/.25), new `spreadPenalty` term, extend `computeConfidence` with the multi-currency-coverage cap.
- No schema/migration changes — everything above reads tables that already exist.

## 19. Required automated tests

- Update `health-score.test.ts` and `engine.test.ts` fixtures for the new formulas (existing "every RULE_RECOMMENDED_ACTION key matches a real rule id" style guard tests extended to new rule ids).
- New `health-score.calibration.test.ts`: the 20 scenarios in §15, asserting each lands in its stated band — this is where "expected vs. implementation" actually gets checked, not by hand.
- New property-based test file (fast-check or hand-rolled randomized fixtures) for invariants #1-#7 in §17.
- Fixed regression fixtures for invariants #8-#10.
- Unit tests for each new pure signal function in `signals.ts` (HHI edge cases: empty, single-item, uniform distribution → HHI=1/n; entropy edge cases: all-same-week, evenly spread).

## 20. Live verification plan

1. Run the full new test suite (`npm run typecheck && npm run lint && npm test`) — required by this repo's own security/quality rules before any behavior-affecting change.
2. Seed 3-4 real-shaped accounts locally spanning the calibration bands (clean, duplicate-heavy, concentrated, worst-case) and confirm the dashboard's health gauge, dimension breakdown, and "why" summaries read sensibly to a human, not just numerically correct.
3. Spot-check one multi-currency account to confirm the new confidence cap fires and its caveat text renders (not just the score).
4. Confirm `RULE_RECOMMENDED_ACTION` has an entry for the new `reactivation` rule id (existing test guard should catch a miss, but verify by hand once).
5. Diff the score for a handful of existing dev/staging accounts (if any) against their v1 score — expect meaningful drops only where genuine, evidenced problems exist; a clean account's score should barely move.

---

**Stopping here per instructions. Nothing in `src/` has been touched.** Flag which parts of this you want changed, cut, or approved as-is before any implementation begins.
