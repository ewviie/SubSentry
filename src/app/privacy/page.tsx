import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { LandingFooter } from "@/components/landing/landing-footer";
import { absoluteUrl } from "@/lib/seo";

// force-dynamic — required for a correct per-request CSP nonce on this
// page's scripts. See terms/page.tsx's identical export for the full
// explanation (statically-cached HTML can't carry a matching nonce for
// any individual visitor's own fresh header nonce, so the browser
// silently blocks every script and the page never hydrates).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data SubSentry collects, why, and what rights you have over it.",
  alternates: { canonical: absoluteUrl("/privacy") ?? "/privacy" },
};

// Kept as a single literal rather than new Date() (unlike the guide page's
// PUBLISHED constant) — a legal document's "last updated" date must only
// change when its actual text changes, never on every rebuild.
const LAST_UPDATED = "August 8, 2026";

export default function PrivacyPolicyPage() {
  return (
    <>
      <MarketingNav />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Privacy Policy" }]} />
      <main id="main-content">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-display">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          <p className="mt-5 text-lg text-muted-foreground">
            SubSentry (&quot;SubSentry,&quot; &quot;we,&quot; &quot;us&quot;) is a subscription-tracking web
            application, currently in early-stage beta. This policy explains what personal data we collect
            through the app, why we collect it, and what rights you have over it.
          </p>
          <p className="mt-4 text-muted-foreground">
            SubSentry does not currently operate as a formally registered legal entity. This policy will be
            updated with our registered company name, registration number, and address once one exists.
          </p>

          <div className="mt-10 space-y-10">
            <section>
              <h2 className="text-h2 font-semibold">Information we collect</h2>
              <p className="mt-2 text-muted-foreground">When you create an account and use SubSentry, we collect:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Account data:</strong> your email address, your password
                  (see &quot;Authentication data&quot; below — we never store this in readable form), an
                  optional display name, and your plan (free or Pro).
                </li>
                <li>
                  <strong className="text-foreground">Subscription data:</strong> the name, price, currency,
                  billing cycle, category, renewal date, status, and any notes you add for each subscription
                  you track, plus how it was added (typed manually, uploaded via CSV, or detected from a
                  connected bank account or Gmail inbox). This is data <em>about the other services you pay
                  for</em> — it is not payment data for SubSentry itself.
                </li>
                <li>
                  <strong className="text-foreground">Session data:</strong> a record that you&apos;re logged
                  in, so you don&apos;t have to re-enter your password on every page. See &quot;Authentication
                  data&quot; below.
                </li>
                <li>
                  <strong className="text-foreground">Import history:</strong> a short summary of each import
                  you run — how many items were detected, imported, or skipped, and a bounded list of any
                  errors. We do not store the uploaded file, or the raw bank transactions or email content
                  behind an automated import — only this summary and whatever subscriptions you review and
                  confirm.
                </li>
                <li>
                  <strong className="text-foreground">Connected-account metadata:</strong> if you connect a
                  bank account or your Gmail inbox, we store which institution or mailbox is connected and an
                  encrypted access token so SubSentry can fetch new data on your next sync. See &quot;OAuth
                  integrations&quot; below.
                </li>
                <li>
                  <strong className="text-foreground">Billing records:</strong> if you upgrade to Pro, we
                  record that a checkout happened and its status (pending, completed, activated). We never see
                  or store your card number — Stripe handles that directly.
                </li>
                <li>
                  <strong className="text-foreground">Login-security data:</strong> a count of recent failed
                  login attempts per email address, used only to apply a temporary lockout after repeated
                  failures.
                </li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not collect data through advertising trackers, analytics scripts, or tracking pixels, and
                we do not sell your data to anyone, for any reason.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">How we use information</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>To operate the core product: store and display the subscriptions you track, and compute
                  the totals, savings estimates, and renewal reminders shown on your dashboard.</li>
                <li>To authenticate you and keep your account secure (sessions, lockouts, and, where enabled,
                  a CAPTCHA check on signup).</li>
                <li>To process payments and manage your plan, via Stripe.</li>
                <li>To detect subscriptions in data you choose to import — a CSV, a connected bank account, or
                  a connected Gmail inbox — which may involve a one-time call to Anthropic&apos;s API. See
                  &quot;Third-party services&quot; and &quot;OAuth integrations&quot; below.</li>
                <li>To send you account-related email, such as email verification and password-reset links.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not use your data for advertising, and we do not build an advertising profile of you.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Subscription and financial data handling</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  You can add subscription data manually, upload a CSV, or connect a bank account (via Plaid or
                  TrueLayer) or your Gmail inbox to have it detected automatically.
                </li>
                <li>
                  For a bank connection, SubSentry receives read-only transaction data from the provider for a
                  bounded lookback window, processes it in memory to detect likely subscriptions, and only
                  writes the specific line items you review and confirm to our database. The raw transaction
                  feed itself is not separately stored.
                </li>
                <li>
                  For a Gmail connection, SubSentry runs a narrow, read-only search for likely receipt or
                  renewal emails, reads only the matching messages, and extracts subscription-like details from
                  them. As with a bank connection, only the entries you confirm are stored — we do not store
                  the content of your emails.
                </li>
                <li>
                  None of these integrations can move money, place an order, or cancel a subscription on your
                  behalf — every connection SubSentry makes to a bank or your inbox is read-only.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Authentication data</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  Passwords are hashed with argon2id before storage. We never store or log your password in
                  plain text, and we cannot recover it if you forget it — only reset it.
                </li>
                <li>
                  Your signed-in state is represented by a session token in an HttpOnly cookie — inaccessible
                  to page JavaScript, marked <code className="rounded bg-muted px-1 py-0.5 text-sm">Secure</code>{" "}
                  in production (sent only over HTTPS), and <code className="rounded bg-muted px-1 py-0.5 text-sm">SameSite=Lax</code>.
                  The database stores only a one-way hash of that token, never the token itself, so a database
                  compromise alone would not hand out a working session. Sessions last 30 days, after which
                  you&apos;ll need to log in again.
                </li>
                <li>
                  We do not use any advertising or third-party tracking cookies.
                </li>
                <li>
                  Repeated failed login attempts against an email address trigger a temporary lockout, and
                  signup (and, where relevant, resending a verification email) may require passing a CAPTCHA
                  challenge, to slow down automated attacks.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Third-party services</h2>
              <p className="mt-2 text-muted-foreground">
                We share the minimum data necessary with the following providers so SubSentry can function.
                Several of these integrations are optional and only active if you choose to use that specific
                feature, or if this deployment has been configured to enable it.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Stripe</strong>, for billing. If you upgrade to Pro,
                  Stripe handles your payment details directly — we never see or store your card number.{" "}
                  <a href="https://stripe.com/privacy" className="underline underline-offset-4 hover:text-foreground" target="_blank" rel="noopener noreferrer">
                    Stripe&apos;s privacy policy
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-foreground">Anthropic</strong> (maker of the Claude AI models), for
                  two optional, on-demand features: parsing free-text you type into &quot;quick add&quot; into
                  structured subscription fields, and rephrasing your computed insights into plain-language
                  sentences when you ask for it. Both only run when you actively use that feature; if you never
                  use them, nothing is sent to Anthropic.{" "}
                  <a href="https://www.anthropic.com/legal/privacy" className="underline underline-offset-4 hover:text-foreground" target="_blank" rel="noopener noreferrer">
                    Anthropic&apos;s privacy policy
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-foreground">Plaid</strong> and{" "}
                  <strong className="text-foreground">TrueLayer</strong>, for connecting a bank account, if you
                  choose to. See &quot;OAuth integrations&quot; below.
                </li>
                <li>
                  <strong className="text-foreground">Google</strong>, for connecting your Gmail inbox, if you
                  choose to. See &quot;OAuth integrations&quot; below.
                </li>
                <li>
                  <strong className="text-foreground">Cloudflare Turnstile</strong>, a privacy-friendly CAPTCHA
                  used on signup (and resending a verification email) to reduce automated abuse, where enabled.
                </li>
                <li>
                  An <strong className="text-foreground">email-delivery provider</strong> (via standard SMTP),
                  used only to send you account emails like email verification and password reset links.
                </li>
                <li>
                  <strong className="text-foreground">Upstash</strong>, optionally, for shared rate-limiting
                  infrastructure across servers — it briefly sees the identifier (such as your IP address or
                  email) being rate-limited, not your account data.
                </li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not have a data processing agreement on file with these providers as of this policy&apos;s
                last update. We do not share your data with any other third party, and we do not permit these
                providers to use your data for their own purposes beyond providing the service to us.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">OAuth integrations</h2>
              <p className="mt-2 text-muted-foreground">
                Connecting a bank account or your Gmail inbox uses OAuth — you authorize access directly with
                the provider (Plaid, TrueLayer, or Google); SubSentry never sees or stores your bank or Google
                password.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Gmail:</strong> we request read-only access to your
                  mailbox (the <code className="rounded bg-muted px-1 py-0.5 text-sm">gmail.readonly</code>{" "}
                  scope) plus your Google account email address — never send, delete, or modify permissions.
                  You can disconnect a Gmail connection at any time from the import screen.
                </li>
                <li>
                  <strong className="text-foreground">Plaid / TrueLayer:</strong> we request read-only access
                  to account and transaction information for the institution you link. There is currently no
                  self-service &quot;disconnect&quot; button for a bank connection in the app — contact us
                  (below) and we&apos;ll remove it and revoke the underlying token.
                </li>
                <li>
                  Access and refresh tokens for every connected provider are encrypted at rest (AES-256-GCM)
                  before storage — they are never stored or logged in plain text.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Data security</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Passwords are hashed with argon2id; session tokens are stored as a one-way hash.</li>
                <li>Bank and Gmail access/refresh tokens are encrypted at rest (AES-256-GCM).</li>
                <li>All traffic is served over HTTPS, enforced with HTTP Strict Transport Security (HSTS).</li>
                <li>A strict, nonce-based Content-Security-Policy and standard security headers
                  (X-Frame-Options, X-Content-Type-Options) are applied to every response.</li>
                <li>State-changing requests are checked against the request&apos;s origin to guard against
                  cross-site request forgery, and Stripe webhook events are verified by signature before
                  they&apos;re trusted.</li>
                <li>Login attempts are rate-limited and temporarily locked out after repeated failures.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                No method of transmission or storage is 100% secure, and we cannot guarantee absolute security.
                We have not obtained any third-party security or compliance certification (e.g. SOC 2, ISO
                27001) as of this policy&apos;s last update.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Data retention</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>Your account and subscription data are kept for as long as your account is active.</li>
                <li>Expired sessions (past their 30-day lifetime) can&apos;t be used to log in, and are cleaned
                  up by a periodic maintenance job.</li>
                <li>If you disconnect a bank or Gmail account, its stored access token is no longer used for
                  new syncs; previously imported subscription data you confirmed is not automatically deleted.</li>
                <li>If you delete your account (see below), we delete your account, subscription data,
                  connected-account metadata, and session records. Records Stripe requires us to keep for tax,
                  accounting, or fraud-prevention purposes may be retained as required by law even after
                  account deletion.</li>
              </ul>
            </section>

            <section id="account-deletion">
              <h2 className="text-h2 font-semibold">Account deletion</h2>
              <p className="mt-2 text-muted-foreground">
                You can permanently delete your account yourself at any time from Settings → Danger zone
                → Delete account, after confirming your password. This immediately and permanently deletes
                your account, subscriptions, imports, insights, connected bank/email accounts (revoking
                those connections at the provider first), and every active session — it can&apos;t be
                undone. If you&apos;re unable to sign in to do this yourself, email us (below) from your
                account&apos;s email address and we will action the request manually; we aim to respond
                within 30 days.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Your rights</h2>
              <p className="mt-2 text-muted-foreground">Regardless of where you live, you can ask us to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li><strong className="text-foreground">Access</strong> a copy of the personal data we hold about you.</li>
                <li><strong className="text-foreground">Correct</strong> inaccurate data — or edit it yourself in the app for subscription data and your account name.</li>
                <li><strong className="text-foreground">Delete</strong> your account and associated data — see
                  &quot;Account deletion&quot; above for the self-service option.</li>
                <li><strong className="text-foreground">Export</strong> your data in a portable format.</li>
                <li><strong className="text-foreground">Object to or restrict</strong> certain processing.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                For access, correction, export, or a deletion request you can&apos;t complete yourself, email
                privacy@subsentry.app with your account email and the request. As SubSentry does not yet have
                self-service export, we will action export requests manually; we aim to respond within 30 days.
              </p>

              <div className="mt-6 rounded-xl border border-border bg-card p-5">
                <h3 className="text-h3 font-semibold">If you&apos;re in the EEA, UK, or Switzerland</h3>
                <p className="mt-2 text-muted-foreground">
                  The rights above are the rights guaranteed to you under the GDPR (and UK GDPR). We process
                  your account and subscription data because it&apos;s necessary to provide the service you
                  signed up for; where we send data to Anthropic for an AI feature, we rely on your explicit
                  action (choosing to use that specific feature) as the basis for that processing. Anthropic,
                  Stripe, Plaid, TrueLayer, and Google may process data outside the EEA/UK. We have not yet
                  finalized the specific transfer safeguard relied on for each provider, or identified a lead
                  supervisory authority — this section will be updated once that work is complete. You may
                  lodge a complaint with your local data protection authority at any time.
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-border bg-card p-5">
                <h3 className="text-h3 font-semibold">If you&apos;re a California resident</h3>
                <p className="mt-2 text-muted-foreground">
                  SubSentry does not sell or share personal information as defined by the CCPA/CPRA. Formal
                  CCPA/CPRA-specific disclosures (categories of data collected and shared, and how to exercise
                  your state-specific rights) will be added here if and when SubSentry has meaningful California
                  usage to warrant them.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Changes to this policy</h2>
              <p className="mt-2 text-muted-foreground">
                We&apos;ll update the &quot;Last updated&quot; date above when this policy changes, and for
                material changes, we&apos;ll notify you by email or an in-app notice.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Contact</h2>
              <p className="mt-2 text-muted-foreground">
                Questions about this policy or your data:{" "}
                <a href="mailto:privacy@subsentry.app" className="underline underline-offset-4 hover:text-foreground">
                  privacy@subsentry.app
                </a>
                . See also our{" "}
                <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
                  Terms of Service
                </Link>
                .
              </p>
            </section>
          </div>
        </article>
      </main>
      <LandingFooter />
    </>
  );
}
