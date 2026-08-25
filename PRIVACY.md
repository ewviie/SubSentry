# SubSentry Privacy Policy

**DRAFT — not yet reviewed by legal counsel. Do not publish or link to this
document from the app until a qualified lawyer has reviewed it.** Placeholder
values are marked `[LIKE THIS]` and must be filled in before publication.

_Last updated: [DATE]_

## Who we are

SubSentry ("SubSentry," "we," "us") provides a subscription-tracking web
application. This policy explains what personal data we collect through the
app, why, and what rights you have over it.

SubSentry does not currently operate as a formal registered legal entity. If
you incorporate before publishing this policy, replace this section with your
registered company name, registration number, and registered address.

**Contact for privacy requests:** privacy@subsentry.app _(placeholder address
— replace with a real, monitored mailbox before publishing)_

## What we collect

When you create an account and use SubSentry, we collect:

- **Account data**: your email address, your password (see "How we protect
  your data" below — we never store this in readable form), and an optional
  display name.
- **Subscription data you enter**: the name, price, currency, billing cycle,
  category, renewal date, status, and any notes you add for each subscription
  you track. This is data *about the other services you pay for* — it is not
  payment data for SubSentry itself.
- **Session data**: a record that you're logged in, so you don't have to
  re-enter your password on every page. See "Cookies" below.
- **Billing records**: if you upgrade to Pro, we record that a checkout
  happened and its status (pending, completed, activated). We do not collect
  or store your card number — that's handled entirely by Stripe (see "Who we
  share data with").
- **If you connect Gmail** (optional — only if you choose to link it): we
  request read-only access to your mailbox (Google's `gmail.readonly` scope
  — we cannot send, delete, or modify anything in your mailbox) and search
  it for receipt/invoice-like emails to detect subscriptions automatically.
  We store the connected mailbox address and an encrypted copy of the OAuth
  access/refresh token needed to keep reading it. **We do not store the
  content of your emails** — each email is read, checked for subscription
  details, and discarded; only the subscription details you then explicitly
  review and confirm are saved.
- **If you connect a bank account via Plaid or TrueLayer** (optional — only
  if you choose to link one): we request read-only access to account
  balances and transactions to detect recurring charges automatically. We
  store which institution is linked and an encrypted copy of the access
  token needed to keep reading it. **We do not store your raw transaction
  history** — transactions are read, checked for recurring-charge patterns,
  and discarded; only the subscription details you then explicitly review
  and confirm are saved. A small, bounded summary of each import (counts of
  items found/imported/skipped, and up to ~20 error messages if something
  failed to parse) is kept so you can see your import history — never the
  underlying email or transaction content.

We do not collect data through advertising trackers, analytics scripts, or
any tracking pixel. We do not sell your data to anyone, for any reason.

## Cookies

SubSentry uses exactly one cookie: a session token that keeps you logged in.
It is:
- **HttpOnly** — inaccessible to JavaScript, reducing exposure if a script on
  the page is ever compromised.
- **Secure** in production — only sent over HTTPS.
- **SameSite=Lax** — not sent along with most cross-site requests, which
  helps prevent other websites from acting on your behalf.
- Valid for 30 days, after which you'll need to log in again.

We do not use any other cookies — no advertising, no analytics, no
third-party trackers.

## Who we share data with

We share the minimum data necessary with the following third-party service
providers so SubSentry can function. Every provider below except Stripe is
entirely optional — used only for a specific integration you choose to
connect — and we never see or store your Gmail/bank login credentials
themselves, only an OAuth token scoped to the specific access described:

- **Stripe**, for billing. If you upgrade to Pro, Stripe handles your
  payment details directly — we never see or store your card number.
  Stripe's own privacy policy governs data you give directly to Stripe:
  https://stripe.com/privacy
- **Google (Gmail API)**, only if you connect Gmail: we request read-only
  access to search and read your mailbox for subscription-detection
  purposes, as described in "What we collect" above. Google's own privacy
  policy governs their processing: https://policies.google.com/privacy
- **Plaid**, only if you link a bank account through Plaid: Plaid provides
  the connection to your bank and shares account/transaction data with us
  for subscription-detection purposes. Plaid's own privacy policy:
  https://plaid.com/legal/#end-user-privacy-policy
- **TrueLayer**, only if you link a bank account through TrueLayer: same
  role as Plaid, for banks TrueLayer supports. TrueLayer's own privacy
  policy: https://truelayer.com/legal/privacy/
- **Anthropic** (maker of the Claude AI models), for two optional features
  you choose to use:
  - **Quick-add**: when you type something like "Netflix £10.99 monthly"
    into the quick-add bar, that text is sent to Anthropic's API to extract
    structured subscription details. You review and confirm the result
    before anything is saved.
  - **AI insight rewriting**: if you click "Rewrite with AI" on your
    dashboard, the names and computed figures for your subscriptions are
    sent to Anthropic's API to be rephrased as plain-language sentences.
  Both features are optional and only run when you actively choose to use
  them (typing into quick-add, or clicking "Rewrite with AI"). If you never
  use these features, or if the app is running without an AI key configured,
  none of your data is sent to Anthropic. Anthropic's own privacy policy
  governs their processing: https://www.anthropic.com/legal/privacy

We do not have a data processing agreement on file with any of these
providers as of this draft — **confirm a DPA is in place with each provider
you actually use (Stripe, Anthropic, and Google/Plaid/TrueLayer for
whichever import integrations are enabled) before publishing this policy**,
particularly if you expect EU users.

We do not share your data with any other third party, and we do not permit
these providers to use your data for their own purposes beyond providing the
service to us.

## How we protect your data

- Passwords are hashed with argon2id before storage — we never store or log
  your actual password, and we cannot recover it if you forget it (only
  reset it).
- Session tokens are stored as a one-way hash server-side; the token in your
  browser's cookie is never stored in readable form in our database, so a
  database compromise alone would not hand out valid login sessions.
- Login attempts are rate-limited to slow down automated password-guessing.
- Gmail/Plaid/TrueLayer OAuth tokens are encrypted at rest (AES-256-GCM)
  before storage — a database compromise alone would not hand out working
  access to your connected mailbox or bank account.

## How long we keep your data

- Your account and subscription data are kept for as long as your account is
  active.
- Expired sessions (past their 30-day lifetime) are inert immediately — they
  cannot be used to log in — and are deleted the moment their token is next
  presented. A scheduled sweep (`npm run db:cleanup-sessions`) also purges
  any that are simply abandoned rather than presented again; deploy this on
  a periodic schedule (daily is plenty) in production.
- If you delete your account (see "Your rights" below), we delete your
  account, subscription data, session records, and any Gmail/Plaid/
  TrueLayer connections. For Gmail and Plaid, this includes revoking the
  underlying OAuth grant with that provider (not just deleting our local
  copy of the token) on a best-effort basis. TrueLayer does not currently
  offer an API for us to revoke a grant on our end — we still permanently
  delete our local copy of the token, but you should also review and revoke
  SubSentry's access from your TrueLayer/bank account settings directly if
  you want to fully close that connection. Records Stripe requires us to
  keep for tax, accounting, or fraud-prevention purposes may be retained as
  required by law even after account deletion.

## Your rights

Regardless of where you live, you can ask us to:

- **Access** a copy of the personal data we hold about you.
- **Correct** inaccurate data (or just edit it yourself in the app for
  subscription data and your account name).
- **Delete** your account and associated data ("right to erasure").
- **Export** your data in a portable format ("right to data portability").
- **Object to or restrict** certain processing.

**Delete your account:** Settings → Account lets you delete your account
yourself at any time, no email required — this immediately removes your
account, subscription data, session records, and any connected Gmail/Plaid/
TrueLayer access (see "How long we keep your data" above).

**For every other right above** (access, correction beyond what you can
already edit yourself, export, objection/restriction): email
privacy@subsentry.app with your account email and the request. SubSentry
does not yet have a self-service "export my data" button, so we will action
an export request manually. We aim to respond within 30 days.

_(Building self-service export is recommended before this policy is
published to real users — self-service deletion already exists; a
manual-only process for export is a reasonable stopgap for a small beta, not
a long-term substitute.)_

### If you're in the European Economic Area, UK, or Switzerland

The rights above are the rights guaranteed to you under the GDPR (and UK
GDPR). In addition:

- **Legal basis for processing**: we process your account and subscription
  data because it's necessary to provide the service you've signed up for
  (performance of a contract). Where we send data to Anthropic for an AI
  feature, or connect Gmail/Plaid/TrueLayer, we rely on your explicit action
  (clicking to use that specific feature, or completing that provider's own
  OAuth consent screen) as the basis for that particular processing.
- **International transfers**: Stripe, Anthropic, Google, Plaid, and
  TrueLayer may process data outside the EEA/UK. _[Confirm and describe the
  specific safeguard relied on — e.g. Standard Contractual Clauses — once
  DPAs are in place for whichever of these providers are actually enabled.]_
- **Right to lodge a complaint**: you may lodge a complaint with your local
  data protection authority. _[Name the relevant supervisory authority once
  a specific EU establishment/representative is determined.]_

### If you're a California resident

_[Add CCPA/CPRA-specific disclosures here if you expect California users —
categories of data collected/shared, and the right to opt out of sale/share
(SubSentry does not sell data, but CCPA has specific disclosure requirements
even to state that).]_

## Changes to this policy

We'll update the "Last updated" date above when this policy changes, and for
material changes, we'll notify you by email or an in-app notice.

## Governing law

This policy is governed by the laws of **[GOVERNING LAW JURISDICTION —
NOT YET SPECIFIED]**, without regard to conflict-of-law principles.

## Contact

Questions about this policy or your data: privacy@subsentry.app
