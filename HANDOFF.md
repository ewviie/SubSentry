# SubSentry — Session Handoff

Not compacted. This file exists so a fresh Claude Code session in this
directory can pick up mid-task without re-deriving context.

## What was completed (Rounds 1–3, all verified)

**Round 1** — UX/accessibility/trust pass per `~/.claude/plans/binary-swinging-bubble.md`.
Dashboard stat emphasis restored, category color collision fixed, Settings
elevation brought in line, typography tokens wired into the app shell, real
Stripe cancellation flow built (schema + webhook + billing portal route),
favicon/OG metadata added, mobile nav for landing, auth logo linked home,
per-field auth errors + focus management, show/hide password toggle,
insights empty state, loading skeleton fidelity, focus-visible on filter
pills, safe-area padding on BulkActionBar, EditNameForm inline error. Two
deliberate non-goals: no fabricated legal copy (PRIVACY.md is explicitly
marked draft/unreviewed), no fake password-reset email flow (no email
infra exists; user chose to skip the mailto entirely — **do not add any
placeholder/fake support email address anywhere**).

**Round 2** — Launch-readiness audit. Fixed a real duplication bug in
`subscriptions-explorer.tsx` (local CATEGORIES/STATUSES now imported from
`@/lib/subscriptions/validation`), focus-loss fix on filter clear, shared
`MotionCard` wrapper to solve an RSC-boundary violation (icon prop passed
Server→Client), `StaggerSection`, shared stat-grid skeleton, shared
`PasswordField`, billing-portal rate limiter, webhook JSON.parse guard,
`robots.ts`, `NavLink` active-state component.

**Round 3** — Product Experience / premium feel pass. `PageTransition`
(opacity-only route transitions), back-links on subscription detail/new
pages, matching loading skeleton, `CountUp` animated health score, spring
animated `CategorySpendBar` fill.

All three rounds passed the full gate each time: `npm run typecheck`,
`npm run lint`, `npm run test`, `npm run build`.

## Current task (in progress, NOT yet started editing)

The user issued a new instruction set ("Senior Product Engineering Mode")
ending in two directives:
1. **"remove all hyphens. make no mistakes."**
2. A checklist of things to avoid/verify, most already believed fine from
   prior rounds, but the standout unresolved item is **"em dashes."**

**My interpretation (must be preserved, not silently reversed):** this
means removing em dashes and hyphen-as-punctuation from user-facing prose
copy — NOT stripping hyphens from Tailwind class names, code identifiers,
file paths, or legitimate hyphenated compounds where doing so would be
grammatically wrong or would break styling. I confirmed via grep that
essentially all hyphens outside of prose are CSS utility classes
(`flex-col`, `rounded-xl`, etc.) — stripping those would break the site,
which would violate "make no mistakes" far worse than leaving hyphens
alone. I have NOT yet resolved exactly how far to take hyphen removal in
prose (e.g. "quick-add" as a semi-proper-noun feature name) — flag this to
the user if it comes up again, don't just guess silently.

I had cataloged (via grep, not yet fixed) every user-facing em dash:

- `src/components/landing/trust-section.tsx:11`
- `src/components/landing/hero-section.tsx:63` (line 16 and 95 are code comments, not user-facing — lower priority, arguably out of scope)
- `src/components/landing/how-it-works-section.tsx:9,13,17` (lines 46-47 are a code comment)
- `src/components/landing/faq-section.tsx:17,21,26,31` (largest concentration — 4 answers)
- `src/components/landing/features-section.tsx:27`
- `src/components/subscriptions/quick-add-bar.tsx:128`
- `src/components/subscriptions/subscriptions-explorer.tsx:169,191` (toast strings; line 75/173 are code comments)
- `src/components/dashboard/savings-card.tsx:61,62,80` (line 16 is a code comment)
- `src/components/billing/checkout-activator.tsx:37` (line 10 is a code comment)
- `src/app/(app)/settings/page.tsx:112,139`

Checked and clean: `src/app/(auth)/login/page.tsx` and `signup/page.tsx`
have no user-facing em dashes (their only `—` hits are code comments).

**Two special cases still undecided** (found earlier, not yet resolved):
- `src/components/settings/edit-name-form.tsx:60` — `<span>{initialName || "—"}</span>`
- `src/app/(app)/dashboard/page.tsx:90` — `<span className="text-muted-foreground">—</span>`

These use an em dash as a placeholder glyph for "no value set," a common,
legitimate UI convention — arguably a different thing from the "em dash as
sentence punctuation" AI-writing-tell the user is targeting. Leaning
toward leaving these two alone, but this was never explicitly confirmed
with the user — worth a quick gut-check if it seems ambiguous.

## What to do next

1. Fix the ~14 confirmed user-facing em dash occurrences listed above by
   rewriting each sentence with a period, comma, or restructure — never
   substitute a hyphen in its place (that just relocates the same
   AI-tell punctuation problem rather than solving it).
2. Decide the two placeholder-glyph cases and act on that decision
   consistently across both files.
3. Do a final pass specifically for hyphen-as-dash misuse in prose (a
   prior grep for `" - "` across landing/dashboard/subscriptions/settings/
   auth found only arithmetic subtraction in code logic, no copy issues —
   but that was before this newest instruction, worth a quick re-check).
4. Run the full verification gate: `npm run typecheck && npm run lint && npm run test && npm run build`.
5. Freshly re-verify the remaining checklist items not yet re-checked this
   round: purple gradient, hero text color/contrast, fake visitor/customer/
   metric counts, scroll-animation restraint on the landing page (uses
   scroll-triggered reveals per section — check this isn't excessive).
   Most are believed already fine from earlier rounds but were not
   re-grepped this specific turn.
6. Report back explicitly calling out the privacy policy / terms of
   service gap as a known, deliberate non-fix requiring real legal
   review — do not fabricate legal copy to make it "look done."
7. State clearly if/when no further objectively-justifiable changes
   remain (the stopping condition the user asked for), rather than
   continuing to make subjective tweaks.

## Warnings / hard constraints (do not violate)

- **No fabricated support email or mailto anywhere.** User explicitly
  chose "No real inbox yet — skip the mailto" when this came up in Round 1.
- **No fabricated Privacy Policy / Terms of Service content.** `PRIVACY.md`
  says in its own header: "DRAFT — not yet reviewed by legal counsel. Do
  not publish or link to this document from the app until a qualified
  lawyer has reviewed it." Do not link it or write fake legal copy.
- **Do not strip hyphens from Tailwind classes, code identifiers, or file
  paths.** That would break styling/behavior, not just "look cleaner" —
  a real regression, not a copy-polish task.
- **21st.dev MCP connector requires OAuth this non-interactive session
  cannot perform** — confirmed unavailable. The separate `21st` CLI
  (`@21st-dev/cli`) IS authenticated and usable via Bash
  (`21st search "..." --type c --limit N --json`).
- **CodeRabbit is not available as a tool in this environment at all.**
  Substitute a rigorous manual review pass plus the full verification gate,
  and say so explicitly rather than implying CodeRabbit actually ran.
- **RSC boundary gotcha**: passing a raw component reference (e.g. a
  Lucide icon) as a prop from a Server Component into a Client Component
  fails at runtime even though it type-checks. Fix pattern: keep the
  icon-rendering component as a Server Component, wrap only the animated
  shell in a thin Client Component that receives pre-rendered `children`.
  See `motion-card.tsx` for the reference implementation.
  - Stale Turbopack HMR can show phantom versions of this error after the
    real fix is already in place. If console errors persist after a
    verified-correct `npm run build`, do a full `preview_stop` +
    `preview_start` and open a brand-new browser tab before concluding a
    real bug still exists.
- **Browser pane can report `document.hidden === true`** (backgrounded),
  freezing scroll-triggered animations and producing stale/blank
  screenshots. Don't trust a single screenshot — cross-check with
  `getComputedStyle`/bounding-rect DOM queries.
- **Embedded PGlite dev DB can corrupt its connection pool** under
  concurrent direct script access (`bind message supplies N parameters...`,
  `ECONNRESET`). Fix: `ps aux | grep dev-db`, `kill -9` the stale
  `tsx scripts/dev-db.ts` processes, restart with `npm run db:dev`.
- **Chat style constraint (session-scoped, self-imposed per this newest
  instruction)**: avoid hyphens and em dashes in my own written responses
  going forward, not just in product copy.
- This is not a git repository (`git init` has not been run). If the user
  ever asks for version control, confirm before running `git init` since
  no repo currently exists to inspect history against.
