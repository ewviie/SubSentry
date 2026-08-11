# Local Council — Phase 4: Retention, Return Reasons & Proactive Value

5-member local council (2 of 5 needed one retry after transient API errors on first attempt — noted, not hidden).

## Synthesis

**Convergence (Devil, Simplicity)**: reusing the existing $15/mo *monthly-normalized* savings threshold for renewal *urgency* would be a real semantic bug — a $200/yr charge hitting in 3 days is the urgent event, not its ~$16.67/mo equivalent. Resolved by using the codebase's actual existing urgency mechanism (`RenewalBadge` in `subscription-row.tsx`), which is purely date-based (days-until), sidestepping the cost-threshold mismatch entirely rather than needing a new one.

**Convergence (Devil, Simplicity)**: a proposed "recently added" surface (createdAt within 7 days) was dropped — bulk CSV imports create many rows with near-identical timestamps, so it would misfire as "new activity" right after onboarding, the exact moment it's least true. Not built.

**Convergence (Simplicity, Devil)**: don't re-sort the renewals list by a synthetic "expensive + soon" score — an unavoidable but expensive renewal (insurance, domain) would always outrank a genuinely cancelable but cheaper duplicate, pointing the user at the wrong item. Kept existing chronological order; urgency is signaled via badge only, not ranking.

**Critical catch (Maintainability)**: `daysUntilRenewal` (filters.ts) and `RenewalBadge` (subscription-row.tsx) already exist, already tested, already solve this exact problem — used elsewhere in the app (`/subscriptions` list). Reused directly instead of building parallel logic that could drift from the original.

**Security**: presentation-only change over already-`requireUser()`-gated, already-owned data — no new attack surface. Flagged (and followed): use `formatCents`'s existing malformed-currency guard, not a raw formatter. Flagged (not applicable): any future notification/cron endpoint must be authenticated from day one, not bolted on later — noted as a standing constraint on Phase 5+, nothing built this phase to violate it.

**Scalability**: no query changes — reads fields already present on an array (`data.upcomingRenewals`) already fetched once, already date-windowed server-side. No N+1 risk introduced.

**Devil's Advocate naming correction**: this phase is "renewal clarity," not "retention" in the strict sense — with zero notification/email infra, nothing built here changes whether a lapsed user *returns*; it only improves what an already-returning user sees. Reported honestly below rather than oversold.

## Direction taken
Enhanced `renewals-list.tsx` to show, per upcoming renewal: name, monthly cost, annual cost, and the existing `RenewalBadge` urgency tier (overdue / renews in ≤3 days / renews in ≤7 days / plain date) — by importing and reusing `daysUntilRenewal` + `RenewalBadge` verbatim, not reimplementing either. Zero new DB fields, zero new backend, zero new pure-logic modules.
