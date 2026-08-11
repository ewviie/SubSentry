# FRONTEND_DESIGN_AUDIT.md

Phase 1 of the premium frontend design transformation. Read the actual source (design tokens, component primitives, motion system, landing sections, app pages) and did live-browser verification (real screenshots + DOM measurement) rather than assuming from file names. Every claim below is either a direct source read or a DOM-measured/screenshot-verified observation — marked accordingly.

## What the product is, who it's for, what the UI should feel like

SubSentry is a subscription-spend tracker: type "Netflix £10.99 monthly" or connect a bank, and it surfaces total spend, duplicate/overlapping subscriptions, upcoming renewals, and savings opportunities. The user is someone who suspects they're bleeding money on forgotten subscriptions and wants a fast, trustworthy answer — not a full budgeting app. Trust signals that matter: **security posture made visible** (the landing page already does this — "Passwords hashed with Argon2id", "Sessions never stored in readable form"), **honesty about data** ("no bank connection required", "we never sell your data"), and **competence conveyed through restraint** — a finance product that looks calm and precise reads as trustworthy; one that looks flashy reads as a toy. The existing design already understands this (see Color System below) — the redesign's job is to extend that restraint consistently, not introduce more visual noise.

## Current strengths (real, verified — not assumed)

1. **The design token system is already sophisticated, not default-template.** `globals.css` uses OKLCH color space throughout, a custom `--text-display`/`--text-h1`/`--text-h2`/`--text-h3` typographic scale distinct from Tailwind's defaults, a 4-tier elevation/shadow system (`--elevation-low/medium/high/glow`) with a **separately engineered dark-mode recipe** (hairline highlight + deep diffuse shadow, because black shadows vanish on navy), and gold/violet accent colors deliberately reserved for specific meanings (gold = brand/financial emphasis, violet = AI-generated content) rather than scattered decoratively.
2. **Contrast was already audited and fixed at the token level.** Multiple inline comments in `globals.css` document specific WCAG AA failures found and corrected (e.g., `--muted-foreground` measured 4.35:1 against muted surfaces, moved to 5.5:1; category chart colors measured as low as 2.03:1 and were corrected with real before/after contrast ratios cited, including a note that OKLab-space compositing measures differently than naive linear-sRGB alpha math — someone tested this in a real browser, not just calculated it).
3. **A real, shared motion vocabulary exists** (`lib/motion.ts`): named spring presets (`springSmooth`, `springSnappy`) with documented reasoning for when to use which, `staggerContainer`, `fadeInUp`, `scaleIn`, hover/press primitives, and an explicit note on why list exits use a flat duration instead of a spring (spring overshoot on exit "reads as a glitch, not physicality"). This is the kind of detail that separates a considered motion system from ad hoc `transition-all`.
4. **21st.dev patterns are already being used, not ignored.** `PrimaryNav`'s sliding active-pill indicator is explicitly sourced from and adapted from 21st.dev's "Animated Navigation Tabs" pattern (real `layoutId` shared-element transition, not a copy-paste — adapted to real Next.js routing instead of tab-panel state).
5. **The hero section's product preview is honest, not a fake screenshot.** It's built from the actual `StatCard`/`CategorySpendBar` components the real dashboard uses, with representative sample data — an unusual amount of integrity for a marketing page, and a detail worth preserving/highlighting, not replacing with a generic illustration.
6. **Accessibility fundamentals are already in place**, confirmed across this project's own prior audit phases and re-verified spot-checks this session: skip-to-content link, `lang="en"`, focus-visible rings on every interactive primitive, zero `dangerouslySetInnerHTML`, `prefers-reduced-motion` respected globally via `MotionConfig reducedMotion="user"`.

**Bottom line**: this is not a "generic AI-generated app" that needs a foundation rebuilt. The foundation (tokens, motion, a11y, one flagship page) is already good. The gap to Stripe/Linear/Ramp tier is about **consistency, information density in the actual app screens, and a handful of real bugs** — not a missing design system.

## Weaknesses, inconsistencies, and real bugs found

### Critical — verified via live browser + DOM measurement, not assumed

**The `(auth)` route group's card renders significantly narrower than its intended width, on every auth page (login, signup, verify-email).**

`AuthShell` (`components/auth/auth-shell.tsx`) sets `className="w-full max-w-sm"` (intended: 384px), but its ancestor chain — `(auth)/layout.tsx`'s `<div className="flex min-h-svh flex-col items-center justify-center ...">` → `<main>` (no width class) → `AuthShell` — doesn't propagate that max-width correctly. A percentage-width (`w-full`) child inside a shrink-to-fit flex item (`main`, cross-axis `items-center`, not `stretch`) resolves to the container's *content-driven* width, not 384px.

Verified by direct `getBoundingClientRect()` measurement in a real browser:
- **Login page**: card measured **250px** wide (should be 384px) — visually subtle since the login form's content happens to wrap acceptably at that width, but still wrong.
- **Signup's "Check your email" success screen**: card measured **120px** wide, with the confirmation text overflowing the card boundary by **85px** — visually broken, text runs past the card edge into the page background. Screenshot-confirmed.

This is the first thing a new user sees after signing up. **This should be fixed as a plain bug, independent of any redesign direction** — it's not a taste question.

### High priority — consistency gap between the landing page and the app

The landing page (hero, trust section, features) received real design attention: staggered word-reveal headline, `SentryRing` brand motif reused meaningfully, honest live-data preview, deliberate spacing. The actual app screens (Settings, sampled in full) are functionally solid but visually flat by comparison: plain `Card` stacks with default padding, no equivalent visual rhythm, no equivalent motion beyond a generic fade-in wrapper. A user who signs up after being impressed by the landing page lands somewhere noticeably less crafted. **This is the single highest-leverage gap to close** — not "the app looks bad," but "the app looks like a different, less finished product than the marketing site that sold it."

### Medium priority — carried forward from prior audit passes this session, still unresolved

- `CardTitle` (`components/ui/card.tsx`) renders a `<div>`, not a heading element, in every one of its dozens of usages across the app — flagged in this session's earlier security/production audit and deliberately not fixed there (too broad a blast radius for that pass). Belongs in this redesign's typography work: promoting it to a real heading tag (with per-usage level review to avoid skipping levels) is now in scope.
- `subscriptions_user_status_idx` being an apparently-unused DB index is out of scope for a frontend pass — noted only so it isn't rediscovered as "new."

### Observed, lower priority

- Settings page's plan/billing card uses inline hex-adjacent utility combinations (`border-gold/30 shadow-elevation-glow ring-1 ring-gold/20`) that work but are hand-assembled per-usage rather than a named "premium/highlighted card" variant — every place that wants this treatment (Pro plan card, could extend to premium insight cards) re-derives the same class soup instead of composing one primitive.
- No dedicated financial-number display convention beyond `font-mono tabular-nums` used ad hoc (e.g., settings' `{activeCount} / {FREE_PLAN_SUBSCRIPTION_LIMIT}`) — the request for a first-class "financial numbers" typography treatment (Phase on Typography System) has a real gap to fill here, not just polish.
- Table/list density in `SubscriptionsExplorer` wasn't visually verified this pass (not screenshotted with real data) — flagged as needing a real screenshot pass before Phase 6 implementation, not assumed fine.

## Typography

- **Fonts**: Geist (body), Geist Mono (financial/code contexts), Space Grotesk (headings) — a legitimate, deliberate pairing already in place via `next/font/google` (self-hosted, no render-blocking external request). This is a good foundation, not something to replace wholesale.
- **Scale**: custom `--text-display/h1/h2/h3` tokens with per-size line-height and letter-spacing already tuned (e.g., display: `-0.02em` tracking, `1.05` line-height) — better than Tailwind's defaults, and exactly the kind of thing the request asks for. The gap is **application**, not definition: many app-page headings (`text-h1`, `text-h2`) are used correctly, but body/label/metadata hierarchy below h3 has no equivalently named scale (`text-sm text-muted-foreground` is reused directly everywhere rather than through a semantic `Label`/`Metadata` text component).
- **Descender clipping false alarm** (documented for the record): the hero's word-by-word reveal animation (`overflow-hidden` per-word wrapper) initially appeared to clip descenders (the "y" in "exactly"). Verified via forced-opacity DOM inspection that this was **entirely an artifact of this sandbox's browser tab being backgrounded** (`document.hidden === true` freezes Framer Motion's `requestAnimationFrame`-driven animation mid-transition, producing a misleading frozen frame) — already documented as a known gotcha elsewhere in this project's history. With opacity/transform forced to their settled end-state, the glyph renders correctly with no clipping. Not a real bug; noted so it isn't "fixed" again by someone trusting a raw screenshot.

## Color

Already covers: brand (primary/near-black navy + gold/violet accents), backgrounds (page/card/popover distinct), text (foreground/muted-foreground, WCAG-verified), borders (default + focus ring), semantic (`destructive` exists; no explicit `success`/`warning`/`info` tokens — success states currently borrow gold, which is *also* the brand-financial-emphasis color, a real overload worth resolving), financial-specific (`chart-1..6` for category colors, contrast-verified). **Gap**: no dedicated `success`/`warning`/`info` semantic triplet — currently improvised per-usage (e.g., is a "You're saving $X" callout gold because it's positive, or gold because it's a financial number? Both, ambiguously). This is real, addressable token work, not a full repaint — the palette itself (cool slate neutrals, restrained gold/violet accents) already avoids every anti-pattern the request calls out (no neon, no "generic AI purple" as a primary, no excessive gradients).

## Spacing, surfaces, icons

- Card elevation system (`shadow-elevation-low/medium/high/glow`) exists and is used with some intent (Settings' Pro-plan card uses `-glow`) but isn't consistently applied — most `Card` usages fall back to the primitive's default `shadow-xs`, meaning the elevation *system* is underused relative to what was built for it.
- Icons are consistently Lucide throughout (confirmed via `components.json`'s `"iconLibrary": "lucide"` and spot-checks) — no mixed icon sets found, a real strength, not a gap.
- Not every element is a card (confirmed — Settings' Plan section mixes a plain progress bar and a bordered callout box alongside actual `Card`s) — the "don't make everything a card" instruction is already being followed in places; needs to be the deliberate rule everywhere, not incidental.

## Responsive / accessibility / performance

- Not exhaustively tested at all 8 requested breakpoints this pass (320–1920px) — that belongs in Phase 8, after direction is chosen, so it's tested against the actual shipped result rather than the current one. What *was* verified: the landing page's `lg:grid-cols-[1.05fr_1fr]` hero layout correctly reflows to single-column below `1024px` (confirmed via the width-mismatch screenshot earlier in this session, which — before being corrected — inadvertently proved the mobile fallback works).
- `next/font` self-hosting means no external font-loading waterfall — a real performance strength already in place, not something to fix.
- No bundle-size or rerender profiling done this pass (out of scope for a visual/DOM-verified audit) — flagged for Phase 10, to run against the actual redesign output rather than the current baseline.

## Redesign plan (high level — full plan follows design research in Phase 2)

1. **Fix the auth-shell width bug immediately** (plain bug, not a design decision — blocks nothing else, should not wait for a direction choice).
2. **Bring the app screens up to the landing page's level of craft**, not the reverse — the landing page is the better reference point already in this codebase, not an external template.
3. **Fill real token gaps**: semantic success/warning/info triplet, a named "financial number" text style, a named "highlighted/premium card" variant to replace the hand-assembled version in Settings.
4. **Extend the existing motion vocabulary's discipline to the app screens** rather than inventing a second one.
5. Everything else (Phases 3–11 of the full brief) gets sequenced against 21st.dev research findings — next.
