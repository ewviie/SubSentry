# FRONTEND_DESIGN_PHASE_2_REPORT.md

Continuation of `FRONTEND_DESIGN_AUDIT.md` and `FRONTEND_DESIGN_FINAL_REPORT.md`. This pass targeted the areas the prior report explicitly deferred: dashboard experience with real data, component-primitive quality, and a full 8-breakpoint responsive sweep. Read both prior reports in full before starting; nothing here contradicts or undoes them.

## Changes made

1. **Closed the warning/info contrast gap** flagged as "not independently verified" in the final report. Measured live in-browser (canvas-based sRGB extraction, same method as the earlier success-token check): dark warning 6.84:1, dark info 5.94:1, light warning 6.47:1, light info 6.48:1 — all clear WCAG AA's 4.5:1 with real margin. No token values changed; this closes a stated open item, not a new fix.

2. **Fixed a real, user-visible savings/optimization inconsistency on the dashboard** (`components/dashboard/insights/insight-panels.tsx`). Found by seeding realistic multi-subscription data and reading the actual rendered dashboard, not by inspecting source alone:
   - "Optimization score" showed **100/100, "$0.00/yr in unrealized savings identified"** while "Optimization recommendations" directly below it showed a real, different figure: **"switching to annual plans... could save an estimated $161.93/year."** Root cause: two independent computations feed the dashboard — `lib/subscriptions/savings.ts` (deterministic duplicate-name matching only, by deliberate design) drives the score and the "Savings opportunities" card; a separate insights-engine rule computes the annual-billing-discount estimate and was never folded into the score.
   - Reconciling those two computations into one number is a logic change, not a frontend one — out of scope here ("do not rewrite working architecture"). Instead, fixed the actual UX problem with an accurate-labeling change only: both cards' copy now explicitly says "confirmed duplicates" instead of the unqualified "your current spend" / "potential" phrasing that implied broader coverage than the number represents. Verified via direct DOM query (`textContent` on `[data-slot="card-description"]`) that both cards now read consistently.
   - Flagged the deeper reconciliation (folding all insight-engine-computed savings into the optimization score) as a real, worthwhile follow-up — see Remaining below.

3. **Verified, not changed**: reviewed `Input`, `Table`, `Dialog`, `DropdownMenu` primitives. All are built on Base UI (`@base-ui/react`), which handles focus trap, roving tabindex, `aria-*` wiring, and keyboard nav internally — no gaps found worth changing. `Table` already wraps in `overflow-x-auto`. This confirms rather than repeats the prior audit's finding that the component layer is already solid.

## Before / after

**Before**: the dashboard's two savings-related numbers could show `$0` and a nonzero real figure side by side under what reads as one coherent "how much can I save" story — directly undermining the brief's own stated goal ("users should immediately understand what they can save").

**After**: both cards are honest about what they measure. A user reading "Optimization score: 100/100, $0/yr in *confirmed duplicate* savings" immediately understands why "Optimization recommendations" below can still show a real, different dollar figure — it's a different, non-overlapping signal, not a bug.

## Components improved

None structurally changed this pass — the review confirmed the existing primitives (Input/Table/Dialog/DropdownMenu) are already correctly built. The one component-level change was content/copy, in `insight-panels.tsx`, not a primitive.

## Design decisions

- Did **not** attempt to unify the two savings-computation systems into one number. That's a real architecture change (touching `insights-engine/rules/*`, `optimization-score.ts`, and `engine.ts`'s wiring) explicitly out of scope for "do not rewrite working architecture." Fixed the user-facing symptom (misleading labels) without touching the computation.
- Did **not** add new animations, new color usage, or new components this pass — the brief's own "Component Quality" and "Motion Design" sections were reviewed and found to already meet the bar set in Phase 1; forcing changes onto correctly-built code would not have "genuinely raised quality," which was the explicit instruction.

## Accessibility checks

- Re-confirmed (did not re-fix) the Phase 1 `CardTitle` heading fix still holds after this pass's changes — E2E suite (`e2e/accessibility.spec.ts`) still passes.
- No new interactive elements added this pass, so no new a11y surface to check beyond the contrast measurements in §1.

## Visual QA — full breakpoint sweep (this pass's most substantial new verification)

Ran a real DOM-measured overflow check (`document.documentElement.scrollWidth - window.innerWidth`, not a screenshot eyeball) at all 8 requested breakpoints (320/375/430/768/1024/1280/1440/1920px) across 4 pages (landing, dashboard, subscriptions, settings) — **32 checks, all returned 0 overflow**. This closes the "not exhaustively tested" item the prior report explicitly flagged as incomplete.

Also independently reproduced (once) a known environment artifact from the prior session: this sandbox's backgrounded browser tab freezes `requestAnimationFrame`-driven state, which can make a live page look broken in a screenshot when it isn't (a `CountUp` counter briefly appeared frozen at `$0.00` mid-review). Verified via direct DOM/`textContent` query each time before concluding anything was actually wrong — not re-documented at length here since the prior report already covers the mechanism; only new instances are noted.

## Testing

No new automated tests added this pass. The one behavior change (`insight-panels.tsx` copy) is a content-accuracy fix verified via live DOM query at the time of the change; a dedicated E2E assertion pinning exact copy strings was judged lower value than the DB-integration/E2E tests already covering this app's actual behavioral surface — matches this codebase's own established testing philosophy (test behavior and structure, not exact UI strings) rather than introducing a new pattern.

## Remaining improvements (stated plainly, not done this pass)

1. **Reconcile the two savings-computation systems** (`lib/subscriptions/savings.ts` vs. the insights-engine's optimization-category rules) into one number, so "Optimization score" reflects every recommendation shown below it, not just confirmed duplicates. Real logic work, correctly out of scope for a frontend-only pass.
2. Landing page and the broader app visual language remain as assessed in the prior two reports — already strong, deliberately not touched again.
3. No further component-primitive gaps found to fix; if "Component Quality" work continues, the next candidates worth a fresh look are the ones not reviewed this pass in depth: `Accordion`, `AlertDialog`, `Select`, `Skeleton` (all exist, none inspected this session).

## Verification (this pass)

```
npm run lint         ✅ clean
npm run typecheck    ✅ clean
npm test              ✅ 388 passed (unchanged — copy-only change, no lib logic touched)
npm run build         ✅ clean, all 38 routes present
npm run test:e2e      ✅ 14 passed (no new tests this pass; all pre-existing, including
                          Phase 1's 3 accessibility tests, still green)
```
