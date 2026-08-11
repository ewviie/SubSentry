import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { LandingFooter } from "@/components/landing/landing-footer";
import { absoluteUrl } from "@/lib/seo";

// force-dynamic — this page must be rendered fresh per request, not
// statically cached. proxy.ts issues a brand-new CSP nonce on every
// request and stamps it onto every <script> tag Next.js renders, but only
// for a render that actually happens in that request's own context; a
// statically-cached HTML response has no such context; its scripts either
// carry no nonce at all or a stale one from whenever the page was last
// generated, which can never match a real visitor's own fresh per-request
// header nonce. Since this app's CSP has no 'unsafe-inline' fallback, the
// browser then silently refuses to run every script on the page — this
// page never actually hydrates, confirmed via a real production build
// (no React fiber on any element, globalThis.TURBOPACK never populated).
// force-dynamic is the standard, documented fix for this exact nonce/
// static-caching tension (see Next's own CSP guide) — there is no partial
// or ISR-cached alternative that keeps a *correct* per-request nonce,
// since caching the HTML at all necessarily means baking in one nonce
// value and replaying it to many different requests, each with their own
// distinct header nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of SubSentry.",
  alternates: { canonical: absoluteUrl("/terms") ?? "/terms" },
};

// Same reasoning as privacy/page.tsx's LAST_UPDATED — a fixed literal, not
// new Date(), so it only moves when this text actually changes.
const LAST_UPDATED = "August 8, 2026";

export default function TermsOfServicePage() {
  return (
    <>
      <MarketingNav />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Terms of Service" }]} />
      <main id="main-content">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-display">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>
          <p className="mt-5 text-lg text-muted-foreground">
            These Terms of Service (&quot;Terms&quot;) govern your use of SubSentry (&quot;SubSentry,&quot;
            &quot;we,&quot; &quot;us&quot;), currently offered as an early-stage beta product. Please read
            them alongside our{" "}
            <Link href="/privacy" className="text-foreground underline underline-offset-4">
              Privacy Policy
            </Link>
            , which explains what data we collect and how we handle it.
          </p>

          <div className="mt-10 space-y-10">
            <section>
              <h2 className="text-h2 font-semibold">Acceptance of terms</h2>
              <p className="mt-2 text-muted-foreground">
                By creating an account or otherwise using SubSentry, you agree to these Terms. If you don&apos;t
                agree, don&apos;t use the service. We may update these Terms from time to time — see
                &quot;Changes to these Terms&quot; below.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Service description</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry helps you track recurring subscriptions, surface duplicate or forgotten ones, and
                identify potential savings opportunities. You can add subscriptions manually, import them from
                a CSV file, or connect a bank account or your Gmail inbox to have them detected automatically.
                SubSentry is a tracking and organization tool — it does not hold your money, place orders,
                or cancel anything on your behalf.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry is currently in beta. Features described here, in the app, or on our marketing pages
                may change, be added, or be removed as the product evolves.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">User accounts</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>You must provide a valid email address and a password meeting our minimum requirements to
                  register.</li>
                <li>You&apos;re responsible for keeping your login credentials confidential and for all
                  activity that happens under your account. Tell us immediately if you suspect unauthorized
                  access.</li>
                <li>You must be at least 16 years old to use SubSentry.</li>
                <li>You&apos;re responsible for the accuracy of the information you provide, including your
                  email address and the subscription details you enter or confirm.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">User responsibilities</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>You&apos;re responsible for reviewing anything an automated import (CSV, bank connection,
                  or Gmail scan) detects before confirming it — SubSentry shows you a review step for exactly
                  this reason, and detection can be wrong.</li>
                <li>You&apos;re responsible for only connecting bank accounts or email inboxes that you own or
                  are authorized to access.</li>
                <li>You&apos;re responsible for actually canceling any subscription you decide to cancel with
                  the underlying provider — SubSentry does not do this for you.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Acceptable use</h2>
              <p className="mt-2 text-muted-foreground">You agree not to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>Use SubSentry for any unlawful purpose, or in violation of any applicable law or regulation.</li>
                <li>Attempt to gain unauthorized access to another user&apos;s account or data, or to any part
                  of our systems or infrastructure.</li>
                <li>Interfere with, overload, or disrupt the service (including bypassing rate limits or
                  CAPTCHA checks) or attack it in any way.</li>
                <li>Scrape, reverse-engineer, or resell access to the service without our written permission.</li>
                <li>Upload or submit malicious files, or content you don&apos;t have the right to submit.</li>
                <li>Use another person&apos;s bank account or email inbox connection without their authorization.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We may suspend or terminate accounts that violate this section — see &quot;Termination&quot;
                below.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">AI-generated insights disclaimer</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry uses AI (via Anthropic&apos;s Claude models) for two optional features: extracting
                structured subscription details from text you type into &quot;quick add,&quot; and rephrasing
                computed insights into plain-language sentences. Both features are optional, only run when you
                choose to use them, and always show you the result to review before anything is saved.
              </p>
              <p className="mt-2 text-muted-foreground">
                AI-generated output can be incomplete or wrong — a misread price, wrong currency, or wrong
                renewal date. You&apos;re responsible for reviewing and correcting anything an AI feature
                produces before relying on it. Automated subscription detection from a bank connection, CSV, or
                Gmail scan uses rule-based matching, not AI, but carries the same caveat: it&apos;s a starting
                point for your review, not a guaranteed-accurate result.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Financial disclaimer</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is not a bank, a payment processor, a financial advisor, or a fiduciary. Nothing in
                the app — including totals, savings estimates, a &quot;health score,&quot; or any other
                figure or recommendation — is financial, investment, tax, or legal advice. Savings estimates
                are calculated from the data you&apos;ve entered or imported and are illustrative only; they
                are not a guarantee that you will save that amount, or anything at all, if you act on them.
                Any decision to cancel, downgrade, or keep a subscription is yours alone, and you&apos;re
                solely responsible for that decision and its consequences.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Service availability</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is provided on an &quot;as available&quot; basis, with no uptime guarantee or
                service-level agreement, particularly during this beta period. Features that depend on a
                third-party provider (Stripe for billing, Anthropic for AI features, Plaid/TrueLayer for bank
                connections, Google for Gmail import) depend on that provider&apos;s own availability and may be
                degraded or unavailable if that provider is down or misconfigured. We may modify, suspend, or
                discontinue any part of the service at any time, with or without notice.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Limitation of liability</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is provided &quot;as is&quot; and &quot;as available,&quot; without warranties of
                any kind, express or implied, including any warranty of merchantability, fitness for a
                particular purpose, or non-infringement. To the maximum extent permitted by law, SubSentry and
                its operators will not be liable for any indirect, incidental, special, consequential, or
                punitive damages, or for any loss of data, revenue, or profits, arising from your use of (or
                inability to use) the service — including any decision you make based on a subscription total,
                savings estimate, or other figure the app shows you. Nothing in these Terms excludes or limits
                liability that cannot lawfully be excluded or limited under the law that applies to you. These
                Terms, and any dispute arising from them, are governed by the laws of{" "}
                <span className="italic">[governing-law jurisdiction — not yet specified]</span>, without
                regard to conflict-of-law principles.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Termination</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  You may stop using SubSentry at any time. You can permanently delete your own account and
                  all its data yourself from Settings, or email us to request account closure and deletion of
                  your data — see our{" "}
                  <Link href="/privacy#account-deletion" className="text-foreground underline underline-offset-4">
                    Privacy Policy
                  </Link>{" "}
                  for details.
                </li>
                <li>
                  We may suspend or terminate your account if you violate these Terms, particularly the
                  &quot;Acceptable use&quot; section, or if required to do so by law.
                </li>
                <li>
                  If your Pro subscription is active at termination, no refund is owed for the unused portion
                  of the current billing period unless required by law or by our arrangement with Stripe.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Changes to these Terms</h2>
              <p className="mt-2 text-muted-foreground">
                We&apos;ll update the &quot;Last updated&quot; date above when these Terms change, and for
                material changes, we&apos;ll notify you by email or an in-app notice. Continuing to use
                SubSentry after a change takes effect means you accept the updated Terms.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">Contact</h2>
              <p className="mt-2 text-muted-foreground">
                Questions about these Terms:{" "}
                <a href="mailto:legal@subsentry.app" className="underline underline-offset-4 hover:text-foreground">
                  legal@subsentry.app
                </a>
                . See also our{" "}
                <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
                  Privacy Policy
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
