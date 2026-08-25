# Legal Document Council — Terms of Service + Privacy Policy
## Final synthesis (2-round adversarial debate, 7 lenses)

> **Local council** — all 7 perspectives come from Claude playing different roles, not from
> different AI vendors or actual lawyers. Treat convergence across lenses as *stronger internal
> consistency*, not as legal validation — none of this replaces qualified counsel, especially for
> every item marked "lawyer-required" below.

Method: Round 1 — 7 lenses worked independently and blind to each other, each grounding claims
in the actual published document text and in facts verified directly against the SubSentry
codebase (a "ground-truth dossier" I compiled first). Round 2 — every lens read all 7 Round 1
outputs and was required to specifically challenge, corroborate, or refine points that
intersected with its own, not just restate itself. No document changes were made — this is
findings only, per your instruction.

---

## TIER 1 — Fix now (cheap, low-risk, no jurisdictional dependency)

### 1. SubSentry's own Pro-plan billing terms are entirely absent from the Terms
**Convergence: 5 of 7 lenses independently found this** (Customer Lawyer, SubSentry Defense
Lawyer, Consumer+Financial Claims Lawyer explicitly; Privacy and HK/Vietnam lenses touched it).
Verified: real Stripe Checkout + Billing Portal, a `plan` column, a live pricing card — but the
Terms discuss "refunds," "billing," and "cancellation" only for *third-party merchants the user
tracks*, never SubSentry's own plan. An earlier draft of the Terms had a one-line clause for this
that the new document dropped.

**Sharpened by the council's own debate into a specific fix:**
- A short, factual billing section: self-serve cancellation via the Stripe Billing Portal, access
  continues through the already-paid period, plan reverts to free on cancellation/non-payment, no
  partial-period refunds except where legally required. (Explicitly **not** a blanket "all sales
  final" clause — that risks conflicting with EU/UK digital-content withdrawal rights unless
  Stripe's checkout is confirmed to capture a waiver of that right, which isn't verifiable from
  this repo.)
- The disclosure should appear **at or near the point of purchase**, not only inside a Terms
  document most users never read before clicking "Subscribe" — several auto-renewal/negative-option
  regimes key off disclosure *timing*, not just existence.
- State the EU/UK digital-content withdrawal-right position explicitly rather than a bare "as
  legally required."
- **Tie this directly to a real, verified code fact**: `src/lib/billing/plan.ts` currently has
  `BETA_ALL_ACCESS = true` — every user gets full Pro-equivalent access for free today, and nobody
  can be charged. This is good, honest present-tense behavior (correctly labeled "Beta — full
  access" in the UI, not "Pro"). But it's a single boolean away from converting existing free-beta
  users into billed subscribers. The council's strong recommendation: write the billing section
  **now**, before that flag ever flips, and treat "fresh pre-charge notice/consent shown to
  already-enrolled users at the moment of the flip" as a **product requirement**, not just a
  documentation fix — Terms text alone, sitting unread since signup, does not satisfy
  negative-option consent law for that specific conversion moment.

### 2. Liability cap ($100 or fees paid) — recommend raising the floor + adding carve-outs, not just leaving it
Genuine three-way convergence, not a real disagreement (an earlier framing suggested a tension
between the Customer Lawyer and SubSentry Defense Lawyer — Round 2 resolved this explicitly):
- **SubSentry Defense Lawyer**: a cap this low, for a product holding encrypted bank/financial
  tokens, is a plausible unconscionability target (UK CRA 2015 §62, EU Unfair Contract Terms
  Directive) — and GDPR Art. 82 liability for SubSentry's own data-protection breach can't be
  capped by contract language regardless of what's written. A clause perceived as eliminating all
  meaningful redress is the one most likely to be struck entirely.
- **Customer Lawyer**: agrees, and adds the practical point — an unenforceable-in-theory clause
  still functions as a real ceiling for the median user, since only a minority ever litigate to
  test it.
- **Consumer+Financial Claims Lawyer**: frames it as "illusory protection, not real protection" —
  a shockingly-low number mostly deters small claims before they're tested, which doesn't actually
  serve consumers despite looking protective on paper.
- **Convergent recommendation**: raise the floor and/or add an explicit carve-out for gross
  negligence, willful misconduct, and non-excludable statutory liability (GDPR Art. 82
  specifically) — this is the one item where "more protective of the user" and "more legally
  durable for SubSentry" point the same direction.

### 3. Security-event logs are misleadingly folded into the Privacy Policy's general retention/deletion framework
**Independently found by 2 lenses** (SubSentry Defense Lawyer, Privacy Lawyer), then further
sharpened by the International Privacy Lens in Round 2. Verified: `logSecurityEvent()` is
`console.warn`-only — there is no database table for security events. Their actual
retention/access/deletion is controlled entirely by the hosting platform's own log system (e.g.
Vercel's default retention), not by SubSentry's code, and **account deletion cannot touch them**.
The Privacy Policy lists "security-related logs" as a collected category and implies they're
covered by the stated retention/deletion regime.
- **Fix (wording only, no downside)**: add one sentence disclosing that operational/security logs
  may be retained separately by the hosting/infrastructure provider under its own schedule,
  outside the account-deletion flow.
- **Separately, flagged as a product/engineering item, not a wording fix**: this is a real
  storage-limitation exposure (GDPR Art. 5(1)(e)) the moment this product has real EU/UK volume,
  independent of what the Policy says. A DB-backed, purgeable security-log table would actually
  close it; the wording fix only closes the *disclosure* gap.

### 4. Billing/audit records (`checkoutSessions`, `stripeEvents`) silently survive account deletion
Found by the Privacy Lawyer. Verified: these are deliberately excluded from the cascade-delete
(`checkoutSessions` gets its user-id FK set to null, `stripeEvents` is untouched) — a defensible,
even legally-necessary choice (tax/accounting retention), but the Policy's current broad
"subject to legally-required/permitted retention" language lets a user reasonably believe
*everything* including billing history is gone. **Fix**: one explicit sentence naming this.

### 5. Undisclaimed marketing-page health-score screenshot
Found and code-verified by the Consumer+Financial Claims Lawyer, corroborated by the Hong Kong
Lens (Trade Descriptions Ordinance angle). The in-app health-score logic is genuinely careful
(confidence levels, an honest "unknown" status rather than a fabricated number — verified in
`health-score.ts`), but the public marketing page shows a specific, precise-looking "83/100" /
"$146.97" screenshot with **no adjacent disclaimer on that page** — a prospective user's first
impression is formed by the undisclaimed number, before any of the in-app hedging is visible.
**Fix**: a short "illustrative example" caption near the screenshot. Cheap, low-priority relative
to items 1–4, but a real and easy fix.

### 6. No age-verification mechanism despite an 18+ Terms requirement
Verified: no DOB field or age checkbox exists anywhere in signup. Council consensus: the
proportionate fix is a simple DOB field or attestation checkbox — **explicitly not** full ID
verification, which multiple lenses flagged as disproportionate overreach (a new sensitive-data
category with its own regulatory exposure, for a beta subscription tracker).

---

## TIER 2 — Minimal, non-committal document additions (defensible now; do NOT go further than this)

### 7. Add Hong Kong and Vietnam to the existing generic "your rights aren't reduced" language
**A genuinely interesting three-way convergence**: the International Privacy Lens independently
noticed that the Privacy Policy gives detailed, dedicated sections to the EEA/UK/Switzerland and
California — jurisdictions reachable only by a *hypothetical* website visitor — while saying
nothing about Hong Kong or Vietnam, where the operators are **actually, presently** working. Both
the Hong Kong Lens and Vietnam Lens, working independently, reached the same underlying
observation from the other direction.

**Resolved in Round 2 into a specific, careful recommendation, not a broad new section**:
- Do **not** write a substantive, PDPO-content-compliant Hong Kong section or a Vietnam
  Decree-13-citing section — every jurisdiction lens agrees this would be premature (unconfirmed
  facts about where data-processing control is actually exercised, whether local users exist,
  what the eventual entity's incorporation situs will be) and could itself create exposure (e.g.
  Hong Kong's PDPO has a *prescriptive* notice-content requirement — asserting PDPO compliance
  without actually meeting it would be worse than the current silence).
- **Do** widen the existing generic clauses (Terms §17/§33's "nothing excludes non-waivable
  rights," Privacy §42 "International Users") with one sentence making explicit that this
  extends to the jurisdiction(s) the Service is **operated from**, not only where a user is
  located, and/or one sentence naming Hong Kong and Vietnam in the same register already used for
  EEA/CA ("if applicable law in your jurisdiction grants you rights, we honor them — this may
  include jurisdictions such as [EEA/UK], [California], [Hong Kong], [Vietnam]"), with zero
  specific statutory citations or enumerated rights.
- This closes the *optics* gap (a regulator or plaintiff's counsel could otherwise ask "you
  clearly know how to write a jurisdiction-specific section — why did you write four and skip the
  one place your own founders work from") without overclaiming anything.

### 8. Recharacterize the AI-feature "consent" language as contract-performance, not consent
**Independently found by 2 lenses** (International Privacy Lens in Round 1, Privacy Lawyer
converging on the same underlying fact in Round 2 after seeing it). The Policy's §21 hedges AI
processing as depending on "your affirmative request or another applicable basis" — but also
names "consent" as a possible legal basis for processing generally, with **no consent-capture or
withdrawal mechanism anywhere in the product** (confirmed: AI features are just rate-limited,
on-demand feature usage, no separate consent UI). Under GDPR, naming consent as a basis implies a
right (withdraw anytime, no detriment) the architecture doesn't support. **Fix**: characterize the
AI feature specifically as Art. 6(1)(b) contract-performance (the user's own feature-click *is*
the requested action), not consent.

### 9. Make the California section explicitly anticipatory
Found by the International Privacy Lens, cross-checked against the Consumer+Financial Claims
Lawyer's independent code verification that `BETA_ALL_ACCESS` means no real revenue exists yet.
CPRA's applicability thresholds (~$25M+ revenue, or 100K+ CA consumers' data, or 50%+ revenue
from data sales) are almost certainly not met by an early-stage beta with no ad/analytics
infrastructure — a materially different and *stronger* argument than "we can't tell who's in
California," since it doesn't depend on geography at all. **Fix**: soften the framing to
"if and when applicable thresholds are met."

---

## TIER 3 — Deliberately NOT a document fix: operator action items

### 10. Business Registration Ordinance (Hong Kong) / equivalent Vietnamese business-registration and personal tax-residency exposure — HIGH URGENCY, NOT a wording problem
**The single most consequential Round 2 development.** The Hong Kong Lens and Vietnam Lens each
independently identified the *same structural point* without coordinating: **an operator's
physical presence and work activity in a country can create business-registration and personal
tax-residency exposure completely independent of where the company is eventually incorporated.**
This is not a hypothetical someday-question — the operators are, right now, actually working from
both Hong Kong and Vietnam simultaneously, which means this is potentially a **live, dual,
present-tense exposure carried personally by the operators today**, regardless of what any
document says.

This is explicitly **not fixable by editing the Terms or Privacy Policy** — it's a real-world
compliance question about the humans running the business. The council's unanimous recommendation
across both jurisdiction lenses: **engage qualified Hong Kong and Vietnamese counsel on this
specifically, before revenue or local footprint grows further** — it's cheaper to resolve now than
after the fact pattern hardens.

### 11. GDPR/UK GDPR "offering" ambiguity — a decision, not a document tweak
The International Privacy Lens's sharpest Round 2 conclusion: unlike the CCPA question (which has
a numeric threshold escape valve), GDPR's Art. 3(2)(a) "offering to EU individuals" test has no
revenue/size safe harbor — a single instance of directing services at the EU market can trigger it
regardless of company size, and the current setup (accepting all signups globally, English-only,
no exclusion) leaves this genuinely unresolved. The recommendation is to **make an explicit,
deliberate choice**, not to leave it ambiguous:
- **Option A**: exclude EU/UK signups (a lightweight geoblock or explicit non-offer statement) —
  cleanly closes the exposure.
- **Option B**: accept that GDPR applies and follow through on the consequences — specifically,
  appoint an **Art. 27 EU/UK representative** (a genuine, currently-unaddressed gap the
  International Privacy Lens flagged as the one clean, non-cosmetic defect in the current EEA
  section) and maintain an Art. 30 records-of-processing inventory.
- Doing neither — publishing a detailed EEA rights section while accepting EU signups with no plan
  for either path — is, per the council, "the worst of both options."

---

## Explicitly out of scope for now (the council's own restraint, not an omission)

- **No exclusive governing-law/forum clause should be added yet.** Honest today (no entity exists
  to designate one) and arguably pro-consumer as-is; picking a jurisdiction now with no genuine
  nexus risks being struck as forum-of-convenience and would read as evasive if ever reported on.
  Wait for the entity to actually exist.
- **No mandatory arbitration/class-action waiver should be added.** No US jurisdictional footing
  for an unincorporated, non-US-based beta operator; likely unenforceable in EU/UK/Australia and
  would read as disproportionate overreach for the current stage of the business.
- **No substantive, statute-citing Hong Kong or Vietnam section** — see Tier 2 item 7 for the
  correctly-scoped alternative.
- **No full ID-verification age gate** — disproportionate; a DOB/attestation checkbox is the
  correct scope (Tier 1 item 6).

---

## Items explicitly requiring qualified local counsel (not resolvable by any further code review)
- Hong Kong: PDPO territorial reach given actual data-processing control location; whether the
  cross-border transfer restriction (commonly cited as PDPO §33) is even currently in force
  (flagged with low confidence, deliberately not asserted as fact); Business Registration
  Ordinance "carrying on business" threshold; Trade Descriptions Ordinance/Unsolicited Electronic
  Messages Ordinance applicability; Control of Exemption Clauses Ordinance (Cap. 71) as applied to
  the liability cap.
- Vietnam: business-registration/tax-residency threshold for physical presence without a local
  entity; cross-border personal-data-processing and possible data-localization/cybersecurity-law
  obligations (explicitly flagged as low-confidence, no citation asserted); e-commerce/online-trader
  registration; a State Bank of Vietnam cross-border-payment question flagged as genuinely
  uncertain and unresearched.
- General: whether Stripe's hosted Checkout captures a valid EU/UK digital-content
  withdrawal-right waiver (not verifiable from this repository — lives in Stripe's own
  dashboard configuration).

---

## What the council did NOT find
No lens found evidence that the savings-estimate, health-score, or AI-recommendation language
*inside the product* overstates certainty — that area was independently checked by the
Consumer+Financial Claims Lawyer directly against `health-score.ts` and found to be genuinely
careful (explicit confidence levels, an honest "unknown" state, review-only phrasing). The one
real gap in that area is presentational (Tier 1 item 5: the marketing screenshot), not the
underlying logic. Similarly, the cancellation-guidance feature (a generic web-search link) was
checked directly in code and found to be honestly scoped — its in-app copy is *more* conservative
than the Terms' broader future-proofing language, the safer direction, and no lens considered it
a real problem.
