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
const LAST_UPDATED = "August 16, 2026";

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

          <div className="mt-5 space-y-4 text-lg text-muted-foreground">
            <p>
              This Privacy Policy explains how SubSentry (&quot;SubSentry,&quot; the &quot;Service,&quot;
              &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses, stores, processes, and
              protects information in connection with your use of the Service.
            </p>
            <p>
              SubSentry is currently an early-stage online project and beta service operated by the person or
              persons responsible for operating the Service from time to time and may be operated through one
              or more individuals, entities, or other lawful arrangements pending formal establishment of the
              business.
            </p>
            <p>
              References to &quot;SubSentry,&quot; &quot;we,&quot; &quot;us,&quot; and &quot;our&quot; refer
              to the person or persons responsible for operating the Service from time to time, unless
              otherwise stated.
            </p>
            <p>
              SubSentry does not currently operate as a formally established legal entity. These details will
              be updated when the business is formally established and the applicable legal entity, registered
              office, and other required information have been determined.
            </p>
            <p>This Privacy Policy is intended to explain our information practices in a clear and transparent manner.</p>
            <p>By accessing or using SubSentry, you acknowledge that you have read this Privacy Policy.</p>
            <p>
              Nothing in this Privacy Policy is intended to exclude, restrict, waive, or limit any privacy,
              data-protection, consumer, statutory, or other right that cannot lawfully be excluded, restricted,
              waived, or limited under Applicable Law.
            </p>
            <p>
              Please read this Privacy Policy alongside our{" "}
              <Link href="/terms" className="text-foreground underline underline-offset-4">
                Terms of Service
              </Link>
              .
            </p>
          </div>

          <div className="mt-10 space-y-10">
            <section>
              <h2 className="text-h2 font-semibold">1. Definitions</h2>
              <p className="mt-2 text-muted-foreground">For purposes of this Privacy Policy:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">&quot;Account&quot;</strong> means an account created
                  to access or use the Service.
                </li>
                <li>
                  <strong className="text-foreground">&quot;Personal Data&quot; or &quot;Personal
                  Information&quot;</strong> means information that identifies, relates to, describes, or can
                  reasonably be associated with an identifiable individual, to the extent defined as personal
                  data or personal information under Applicable Law.
                </li>
                <li>
                  <strong className="text-foreground">&quot;User,&quot; &quot;you,&quot; or
                  &quot;your&quot;</strong> means the individual using the Service.
                </li>
                <li>
                  <strong className="text-foreground">&quot;User Content&quot;</strong> means information,
                  data, files, transaction records, subscription information, account information,
                  communications, and other materials that you submit, upload, import, connect, transmit, or
                  otherwise make available through the Service.
                </li>
                <li>
                  <strong className="text-foreground">&quot;Third-Party Service&quot;</strong> means a
                  service, platform, provider, integration, data source, financial-data provider, payment
                  processor, artificial-intelligence provider, merchant, or other service operated by a third
                  party.
                </li>
                <li>
                  <strong className="text-foreground">&quot;AI Features&quot;</strong> means features using
                  artificial intelligence, machine learning, automated classification, language models,
                  generative models, statistical models, or similar technologies.
                </li>
                <li>
                  <strong className="text-foreground">&quot;Applicable Law&quot;</strong> means laws,
                  regulations, rules, orders, and legally binding requirements applicable to the relevant
                  person, activity, transaction, Service, or User.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">2. Information We Collect</h2>
              <p className="mt-2 text-muted-foreground">
                Depending on how you use SubSentry, we may collect different categories of information.
              </p>
              <p className="mt-2 text-muted-foreground">
                We aim to collect only information reasonably necessary to provide, secure, maintain, and
                improve the Service and to comply with Applicable Law.
              </p>

              <h3 className="mt-6 text-lg font-semibold text-foreground">2.1 Account Information</h3>
              <p className="mt-2 text-muted-foreground">When you create an Account, we may collect:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>email address;</li>
                <li>password authentication information;</li>
                <li>optional display name;</li>
                <li>account status;</li>
                <li>subscription or plan information;</li>
                <li>account preferences; and</li>
                <li>other information reasonably necessary to establish and operate your Account.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not intentionally store your password in readable or recoverable form.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where the Service uses password authentication, passwords are intended to be securely hashed
                before storage.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">3. Subscription Information</h2>
              <p className="mt-2 text-muted-foreground">
                You may provide information concerning subscriptions that you track through SubSentry.
              </p>
              <p className="mt-2 text-muted-foreground">This may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>subscription or merchant name;</li>
                <li>price;</li>
                <li>currency;</li>
                <li>billing cycle;</li>
                <li>category;</li>
                <li>renewal date;</li>
                <li>subscription status;</li>
                <li>notes;</li>
                <li>cancellation information;</li>
                <li>source of the subscription information; and</li>
                <li>other information you choose to provide.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                This information concerns subscriptions you track through SubSentry and is not necessarily
                payment information for your SubSentry Account.
              </p>
              <p className="mt-2 text-muted-foreground">
                For example, information concerning a subscription to another merchant may be stored so that
                SubSentry can organize and analyze that subscription.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">4. Financial and Transaction Information</h2>
              <p className="mt-2 text-muted-foreground">
                Depending on the features you use, SubSentry may process information relating to financial
                transactions or accounts.
              </p>
              <p className="mt-2 text-muted-foreground">This may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>transaction descriptions;</li>
                <li>merchant names;</li>
                <li>transaction dates;</li>
                <li>transaction amounts;</li>
                <li>currencies;</li>
                <li>account identifiers or related metadata;</li>
                <li>transaction categories;</li>
                <li>recurring-payment indicators; and</li>
                <li>other information provided by a financial-data provider.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where supported, SubSentry may receive this information from services such as Plaid or
                TrueLayer when you choose to connect a financial account.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry is designed to use connected financial information for the purposes described in this
                Privacy Policy and the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry does not itself hold or custody your money through these integrations.
              </p>
              <p className="mt-2 text-muted-foreground">
                Unless expressly stated otherwise, connected financial integrations are intended to provide
                read-only access.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">5. Import Information</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may allow you to import information through methods such as:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>manually entered information;</li>
                <li>CSV files;</li>
                <li>connected financial accounts;</li>
                <li>connected email accounts; or</li>
                <li>other supported import methods.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Depending on the import method, we may temporarily process information contained in the
                imported source to identify potential subscriptions or recurring transactions.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where the Service is designed not to retain the original source material, such as a raw CSV
                file, raw transaction feed, or email content, we do not intentionally retain that source
                material after the relevant processing is completed.
              </p>
              <p className="mt-2 text-muted-foreground">
                However, information that you review, confirm, save, or otherwise submit to the Service may
                become part of your Account data.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">6. Import History</h2>
              <p className="mt-2 text-muted-foreground">
                The Service may maintain limited records concerning imports you perform.
              </p>
              <p className="mt-2 text-muted-foreground">Import history may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>date and time of an import;</li>
                <li>import type;</li>
                <li>number of items detected;</li>
                <li>number of items imported;</li>
                <li>number of items skipped;</li>
                <li>bounded error information; and</li>
                <li>other operational information reasonably necessary to maintain the import functionality.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where applicable, the original uploaded file or raw source information may not be retained
                after processing.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">7. Connected Account Information</h2>
              <p className="mt-2 text-muted-foreground">
                If you voluntarily connect a supported Third-Party Service, we may receive or store information
                necessary to maintain that connection.
              </p>
              <p className="mt-2 text-muted-foreground">This may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>provider name;</li>
                <li>connected account or institution metadata;</li>
                <li>account identifiers;</li>
                <li>connection status;</li>
                <li>authorization metadata;</li>
                <li>access tokens;</li>
                <li>refresh tokens; and</li>
                <li>other technical information necessary to maintain the connection.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where supported by the Service, access and refresh tokens are encrypted before being stored.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not intentionally store your bank, financial institution, or Google password.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">8. Gmail Information</h2>
              <p className="mt-2 text-muted-foreground">
                If SubSentry provides Gmail integration and you choose to connect your Gmail account, SubSentry
                may request read-only access to your mailbox through Google&apos;s authorization system.
              </p>
              <p className="mt-2 text-muted-foreground">The Service may request the permissions necessary to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>identify potentially relevant subscription or receipt emails;</li>
                <li>read matching messages;</li>
                <li>extract subscription-related information; and</li>
                <li>provide the requested import functionality.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">The Service does not use a Gmail connection to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>send emails;</li>
                <li>delete emails;</li>
                <li>modify emails;</li>
                <li>change your Google account settings; or</li>
                <li>change your permissions.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                SubSentry is intended to process only the information necessary for the requested import
                functionality.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where the Service is designed not to retain email content, we do not intentionally store the
                contents of emails after the relevant processing is complete.
              </p>
              <p className="mt-2 text-muted-foreground">
                Information extracted from those emails that you review or confirm may be stored as Account or
                subscription information.
              </p>
              <p className="mt-2 text-muted-foreground">
                You may disconnect the Gmail integration through the available functionality or by contacting
                us.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">9. Financial Account Connections</h2>
              <p className="mt-2 text-muted-foreground">
                If SubSentry provides financial-account connectivity through Plaid, TrueLayer, or another
                provider, you authorize the applicable provider to provide information to SubSentry according
                to the permissions you approve.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry does not receive your bank password through these integrations.
              </p>
              <p className="mt-2 text-muted-foreground">
                The permissions available to you depend on the financial institution, provider, country, and
                connection method.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where supported, SubSentry requests read-only access for the purpose of retrieving relevant
                financial information.
              </p>
              <p className="mt-2 text-muted-foreground">SubSentry does not use these connections to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>move money;</li>
                <li>initiate payments;</li>
                <li>make purchases;</li>
                <li>transfer funds; or</li>
                <li>otherwise control your financial account,</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                unless a future feature expressly states otherwise and provides the required authorization and
                disclosures.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">10. Authentication and Security Information</h2>
              <p className="mt-2 text-muted-foreground">
                When you create or use an Account, we may collect information necessary to authenticate and
                secure your Account.
              </p>
              <p className="mt-2 text-muted-foreground">This may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>password hashes;</li>
                <li>session identifiers or hashes of session tokens;</li>
                <li>login timestamps;</li>
                <li>authentication events;</li>
                <li>failed login attempts;</li>
                <li>temporary security-lockout information;</li>
                <li>CAPTCHA verification information;</li>
                <li>security-related logs; and</li>
                <li>other information necessary to protect Accounts and the Service.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where implemented, passwords are hashed using Argon2id or another appropriate
                password-hashing mechanism.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where implemented, session tokens are stored in a secure manner intended to prevent a database
                compromise from directly providing usable session credentials.
              </p>
              <p className="mt-2 text-muted-foreground">Session cookies may use security attributes such as:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>HttpOnly;</li>
                <li>Secure; and</li>
                <li>SameSite.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                The specific configuration may vary depending on the environment and technical requirements.
              </p>
              <p className="mt-2 text-muted-foreground">
                Security-related logs (for example, failed sign-in attempts, lockouts, and rate-limiting
                events) may include an IP address and the email address entered at the time. These entries
                are recorded in infrastructure-level logging systems, not in a per-user searchable data
                store, and — unlike Account data — cannot currently be individually located, exported, or
                deleted through self-service or by request. Retention of this category is governed by our
                hosting/infrastructure provider&apos;s own log-retention practices, which this Policy does
                not separately control.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">11. Technical and Operational Information</h2>
              <p className="mt-2 text-muted-foreground">
                When you access the Service, we may automatically receive limited technical information
                necessary to operate and secure the Service.
              </p>
              <p className="mt-2 text-muted-foreground">Depending on the environment, this may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>IP address;</li>
                <li>browser type;</li>
                <li>device information;</li>
                <li>operating system;</li>
                <li>approximate connection information;</li>
                <li>timestamps;</li>
                <li>request information;</li>
                <li>error information;</li>
                <li>security events; and</li>
                <li>other technical information generated through normal operation of the Service.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">We use this information primarily for purposes such as:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>security;</li>
                <li>fraud prevention;</li>
                <li>abuse prevention;</li>
                <li>troubleshooting;</li>
                <li>service reliability;</li>
                <li>debugging;</li>
                <li>performance monitoring; and</li>
                <li>maintaining the Service.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">12. Rate Limiting and Abuse Prevention</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may use rate-limiting infrastructure to prevent abuse and protect the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Depending on the implementation, a rate-limiting provider may temporarily process an identifier
                such as:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>IP address;</li>
                <li>email address;</li>
                <li>Account identifier; or</li>
                <li>another identifier required to enforce a rate limit.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                For example, Upstash may be used as an optional shared rate-limiting service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Rate-limiting providers are not intended to receive your subscription or financial Account data
                merely for the purpose of rate limiting.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">13. CAPTCHA and Abuse Prevention</h2>
              <p className="mt-2 text-muted-foreground">
                Where enabled, SubSentry may use Cloudflare Turnstile or another CAPTCHA or anti-abuse
                mechanism.
              </p>
              <p className="mt-2 text-muted-foreground">This may occur during:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>account registration;</li>
                <li>verification-email requests;</li>
                <li>password-related security flows; or</li>
                <li>other security-sensitive actions.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                The CAPTCHA provider may process technical information necessary to determine whether a request
                is likely to originate from an automated or abusive source.
              </p>
              <p className="mt-2 text-muted-foreground">
                Use of such technology is intended to protect the Service and Users against automated abuse.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">14. How We Use Information</h2>
              <p className="mt-2 text-muted-foreground">We may use information we collect to:</p>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Provide the Service</h3>
              <p className="mt-2 text-muted-foreground">Including to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>create and maintain Accounts;</li>
                <li>store subscription information;</li>
                <li>display dashboards;</li>
                <li>calculate subscription totals;</li>
                <li>calculate savings estimates;</li>
                <li>identify potential recurring payments;</li>
                <li>identify potential duplicate subscriptions;</li>
                <li>generate renewal information;</li>
                <li>provide import functionality; and</li>
                <li>provide other requested functionality.</li>
              </ul>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Authenticate and Secure Accounts</h3>
              <p className="mt-2 text-muted-foreground">Including to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>authenticate Users;</li>
                <li>maintain sessions;</li>
                <li>prevent unauthorized access;</li>
                <li>detect suspicious activity;</li>
                <li>apply temporary lockouts;</li>
                <li>enforce rate limits;</li>
                <li>prevent fraud and abuse; and</li>
                <li>protect the Service.</li>
              </ul>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Process Payments</h3>
              <p className="mt-2 text-muted-foreground">
                Where paid functionality is available, we may process information necessary to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>determine your plan;</li>
                <li>initiate or verify checkout;</li>
                <li>record payment status;</li>
                <li>activate paid functionality; and</li>
                <li>maintain billing records.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Payment-card information is handled by the applicable payment processor rather than stored
                directly by SubSentry where the payment architecture supports this arrangement.
              </p>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Process Imports</h3>
              <p className="mt-2 text-muted-foreground">We may process information you choose to import to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>identify potential subscriptions;</li>
                <li>identify recurring transactions;</li>
                <li>extract subscription information;</li>
                <li>classify transactions;</li>
                <li>identify potential duplicates; and</li>
                <li>provide the requested import functionality.</li>
              </ul>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Provide AI Features</h3>
              <p className="mt-2 text-muted-foreground">
                Where you actively use an AI Feature, we may transmit the minimum information reasonably
                necessary to the applicable AI provider to perform that requested function.
              </p>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Analyze and Improve the Service</h3>
              <p className="mt-2 text-muted-foreground">
                Where we analyze information in aggregated or appropriately de-identified form — for example,
                to understand usage patterns, monitor performance, or improve features — we do so on the
                basis of our legitimate interest in maintaining and improving the Service. This is the
                disclosure referenced by the equivalent provision in our Terms of Service.
              </p>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Communicate With You</h3>
              <p className="mt-2 text-muted-foreground">We may use your email address to send:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>email verification messages;</li>
                <li>password-reset messages;</li>
                <li>security notifications;</li>
                <li>Account-related communications;</li>
                <li>
                  renewal-reminder emails, sent by default when a tracked subscription is approaching its
                  renewal date. Timing is calculated using UTC dates; because the Service does not currently
                  store a per-user time zone, a reminder may arrive on a different local calendar day than
                  the date shown, and should not be relied on as your sole warning before a renewal. You can
                  turn these off at any time in Account settings or via the unsubscribe link included in
                  every reminder email, without needing to log in;
                </li>
                <li>important Service notices;</li>
                <li>legally required notices; and</li>
                <li>other communications necessary to operate your Account.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not use your information to build an advertising profile or serve targeted advertising
                through the Service.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">15. Artificial Intelligence</h2>
              <p className="mt-2 text-muted-foreground">Certain SubSentry features may use AI Features.</p>
              <p className="mt-2 text-muted-foreground">For example, AI may be used to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>parse free-text subscription information;</li>
                <li>classify information;</li>
                <li>extract structured information;</li>
                <li>summarize information;</li>
                <li>generate explanations;</li>
                <li>rephrase computed insights; or</li>
                <li>assist with other requested functionality.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                AI processing may involve sending relevant information to an AI provider such as Anthropic.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where an AI Feature is optional, we intend to process information through that provider only
                when you actively request the applicable feature.
              </p>
              <p className="mt-2 text-muted-foreground">
                For example, if you do not use an AI-powered quick-add feature, your information should not be
                sent to the AI provider solely because the feature exists.
              </p>
              <p className="mt-2 text-muted-foreground">
                AI providers may process information according to their agreements with SubSentry and their
                applicable policies.
              </p>
              <p className="mt-2 text-muted-foreground">
                The information sent to an AI provider should be limited to what is reasonably necessary to
                perform the requested function.
              </p>
              <p className="mt-2 text-muted-foreground">
                AI-generated output may be inaccurate, incomplete, outdated, or inappropriate.
              </p>
              <p className="mt-2 text-muted-foreground">You should independently verify important information.</p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">16. Third-Party Service Providers</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may use third-party providers to operate specific portions of the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Depending on the features enabled in a particular deployment, these may include:
              </p>
              <ul className="mt-3 list-disc space-y-3 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Stripe</strong> — used for payment processing and
                  billing. Stripe may receive payment and billing information necessary to process
                  transactions. Where Stripe processes card information directly, SubSentry does not
                  intentionally receive or store your full payment-card number.{" "}
                  <a
                    href="https://stripe.com/privacy"
                    className="underline underline-offset-4 hover:text-foreground"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Stripe Privacy Policy
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-foreground">Anthropic</strong> — used for optional AI functionality
                  where enabled. Information may be sent to Anthropic when you actively use a feature that
                  requires AI processing.{" "}
                  <a
                    href="https://www.anthropic.com/legal/privacy"
                    className="underline underline-offset-4 hover:text-foreground"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Anthropic Privacy Policy
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-foreground">Plaid</strong> — may be used to connect financial
                  accounts and retrieve authorized financial information.
                </li>
                <li>
                  <strong className="text-foreground">TrueLayer</strong> — may be used to connect financial
                  accounts and retrieve authorized financial information.
                </li>
                <li>
                  <strong className="text-foreground">Google</strong> — may be used to provide Gmail
                  integration where enabled and authorized by you.
                </li>
                <li>
                  <strong className="text-foreground">Cloudflare Turnstile</strong> — may be used for CAPTCHA
                  and automated-abuse prevention.
                </li>
                <li>
                  <strong className="text-foreground">Upstash</strong> — may be used for shared rate-limiting
                  infrastructure.
                </li>
                <li>
                  <strong className="text-foreground">Email delivery provider</strong> — an email provider
                  using SMTP or another email-delivery mechanism may be used to send verification emails,
                  password-reset emails, security notices, and other Account-related communications.
                </li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                The specific providers used by a particular deployment may change over time.
              </p>
              <p className="mt-2 text-muted-foreground">
                We aim to disclose material providers and processing purposes as required by Applicable Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">17. No Sale of Personal Information</h2>
              <p className="mt-2 text-muted-foreground">We do not sell your personal information.</p>
              <p className="mt-2 text-muted-foreground">
                We do not use your personal information to create advertising profiles or sell personal
                information to advertisers.
              </p>
              <p className="mt-2 text-muted-foreground">
                We also do not intentionally disclose your personal information to third parties for their
                independent advertising purposes.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where Applicable Law provides a broader definition of &quot;sale,&quot; &quot;sharing,&quot; or
                similar concepts, our practices will be governed by the applicable legal requirements.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">18. Data Processing by Service Providers</h2>
              <p className="mt-2 text-muted-foreground">
                Third-party providers may process information on our behalf to provide infrastructure or
                functionality.
              </p>
              <p className="mt-2 text-muted-foreground">
                We aim to limit the information provided to third-party providers to what is reasonably
                necessary for their applicable function.
              </p>
              <p className="mt-2 text-muted-foreground">Third-party providers may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>payment processors;</li>
                <li>financial-data providers;</li>
                <li>email providers;</li>
                <li>AI providers;</li>
                <li>security providers;</li>
                <li>CAPTCHA providers;</li>
                <li>hosting or infrastructure providers; and</li>
                <li>rate-limiting providers.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not authorize these providers to use information provided solely for SubSentry&apos;s
                services for unrelated purposes except where permitted or required by Applicable Law or
                otherwise disclosed.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">19. Data Processing Agreements</h2>
              <p className="mt-2 text-muted-foreground">
                As of the date of this Privacy Policy, SubSentry may not have finalized formal
                data-processing agreements with every third-party provider used by the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where Applicable Law requires such agreements or contractual safeguards, we intend to implement
                appropriate arrangements as the Service and business structure mature.
              </p>
              <p className="mt-2 text-muted-foreground">
                The absence of a finalized agreement does not mean that we intend to permit providers to use
                your information for unrelated purposes.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">20. International Data Transfers</h2>
              <p className="mt-2 text-muted-foreground">
                Depending on the location of our infrastructure, service providers, and Users, information may
                be processed or stored in countries other than the country in which you reside.
              </p>
              <p className="mt-2 text-muted-foreground">Different countries may have different data-protection laws.</p>
              <p className="mt-2 text-muted-foreground">
                Where Applicable Law requires safeguards for international transfers, we intend to use legally
                recognized transfer mechanisms or other appropriate safeguards.
              </p>
              <p className="mt-2 text-muted-foreground">
                As SubSentry is currently an early-stage beta service, the specific transfer mechanisms
                applicable to each provider may change as our infrastructure and legal structure develop.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where legally required, we will provide additional information regarding international
                transfers.
              </p>
            </section>

            <section>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-h2 font-semibold">21. European Economic Area, United Kingdom, and Switzerland</h2>
                <p className="mt-2 text-muted-foreground">
                  If you are located in the European Economic Area, United Kingdom, or Switzerland, additional
                  data-protection rights may apply to you under applicable privacy laws, including the GDPR or
                  UK GDPR.
                </p>
                <p className="mt-2 text-muted-foreground">Depending on the circumstances, we may process Personal Data on the basis of:</p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                  <li>performance of a contract;</li>
                  <li>your consent;</li>
                  <li>compliance with legal obligations;</li>
                  <li>legitimate interests; or</li>
                  <li>another lawful basis recognized by Applicable Law.</li>
                </ul>
                <p className="mt-3 text-muted-foreground">
                  For example, processing Account information may be necessary to provide the Service you
                  requested.
                </p>
                <p className="mt-2 text-muted-foreground">
                  AI Features are optional and only run when you actively request them. Processing associated
                  with an AI Feature is generally based on your consent or, where applicable, our legitimate
                  interests in providing the feature you requested — not on the processing being necessary to
                  perform the Service&apos;s core contract. Where applicable, you retain the right to object to
                  this processing and to withdraw consent at any time, in addition to the other rights listed
                  in this Section.
                </p>
                <p className="mt-3 text-muted-foreground">You may have rights including:</p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                  <li>access;</li>
                  <li>correction;</li>
                  <li>deletion;</li>
                  <li>restriction;</li>
                  <li>objection;</li>
                  <li>data portability;</li>
                  <li>withdrawal of consent; and</li>
                  <li>the right to lodge a complaint with a competent supervisory authority.</li>
                </ul>
                <p className="mt-3 text-muted-foreground">
                  The availability and scope of these rights depend on Applicable Law and the circumstances of
                  the processing, and — for the security-log category described in Section 10 — may not be
                  capable of being individually located or actioned given the Service&apos;s current system
                  design.
                </p>
              </div>
            </section>

            <section>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-h2 font-semibold">22. California Privacy Rights</h2>
                <p className="mt-2 text-muted-foreground">
                  If you are a California resident, you may have rights under the California Consumer Privacy
                  Act, as amended by the California Privacy Rights Act, where applicable.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Subject to applicable thresholds and exemptions, these rights may include rights concerning:
                </p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                  <li>access to personal information;</li>
                  <li>correction;</li>
                  <li>deletion;</li>
                  <li>information concerning collection and disclosure;</li>
                  <li>restriction or objection to certain uses;</li>
                  <li>portability; and</li>
                  <li>other rights provided by California law.</li>
                </ul>
                <p className="mt-3 text-muted-foreground">
                  SubSentry does not sell or share personal information for cross-context behavioral
                  advertising.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Where legally required, additional California-specific disclosures and mechanisms for
                  exercising rights will be provided.
                </p>
                <p className="mt-2 text-muted-foreground">
                  You may contact us using the information in the Contact section to exercise applicable
                  privacy rights.
                </p>
                <p className="mt-2 text-muted-foreground">
                  We will not unlawfully discriminate against you for exercising a privacy right.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">23. Data Retention</h2>
              <p className="mt-2 text-muted-foreground">
                We retain information only for as long as reasonably necessary for the purposes described in
                this Privacy Policy, unless a longer period is required or permitted by Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">Generally:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>Account information is retained while your Account remains active;</li>
                <li>subscription information is retained while necessary to provide the Service and while your Account remains active;</li>
                <li>
                  an expired session is invalidated and removed the next time its token is presented to the
                  Service; a session that is never presented again (for example, an abandoned device) is
                  removed through a periodic maintenance process that may not run on a fixed automatic
                  schedule at all times;
                </li>
                <li>import information may be retained according to the applicable import functionality;</li>
                <li>connected-account metadata and tokens are retained while the connection remains active or as otherwise necessary;</li>
                <li>billing information may be retained as required for legal, accounting, tax, fraud-prevention, or operational purposes; and</li>
                <li>security and abuse-prevention information may be retained for a reasonable period necessary to protect the Service.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Retention periods may vary depending on the type of information and the purpose for which it is
                processed.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">24. Disconnecting Connected Accounts</h2>
              <p className="mt-2 text-muted-foreground">
                You may disconnect a connected account where the Service provides functionality to do so.
              </p>
              <p className="mt-2 text-muted-foreground">
                Disconnecting an account generally prevents future access or synchronization from that
                connection.
              </p>
              <p className="mt-2 text-muted-foreground">
                However, disconnecting a connection does not necessarily delete information previously
                imported into your Account.
              </p>
              <p className="mt-2 text-muted-foreground">
                Previously stored subscription information remains subject to the applicable retention and
                deletion provisions of this Privacy Policy.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where self-service disconnection is not available, you may contact us to request that the
                connection be removed.
              </p>
            </section>

            <section id="account-deletion">
              <h2 className="text-h2 font-semibold">25. Account Deletion</h2>
              <p className="mt-2 text-muted-foreground">
                Where the Service provides self-service account deletion, you may permanently delete your
                Account through the available Account settings.
              </p>
              <p className="mt-2 text-muted-foreground">Account deletion may result in permanent deletion of:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>your Account;</li>
                <li>subscription information;</li>
                <li>saved imports;</li>
                <li>insights;</li>
                <li>connected-account metadata;</li>
                <li>active sessions; and</li>
                <li>other information associated with your Account,</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                subject to information that we are legally required or permitted to retain.
              </p>
              <p className="mt-2 text-muted-foreground">
                Billing and payment records associated with Stripe checkouts — including the email address
                associated with a payment at the time it was made — are not deleted, and are retained for
                accounting, fraud-prevention, and legal purposes even after your Account is deleted.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where a connected financial or email account is deleted, we may take reasonable steps to revoke
                the associated connection or authorization where technically supported.
              </p>
              <p className="mt-2 text-muted-foreground">
                Account deletion may not immediately remove information held by independent Third-Party
                Services.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">26. Requests for Deletion</h2>
              <p className="mt-2 text-muted-foreground">
                If you cannot delete your Account through the Service, you may contact us using the privacy
                contact information below.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may need to verify your identity before processing a deletion request.
              </p>
              <p className="mt-2 text-muted-foreground">We may retain information where necessary for:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>legal compliance;</li>
                <li>security;</li>
                <li>fraud prevention;</li>
                <li>establishing or defending legal claims;</li>
                <li>accounting or tax obligations;</li>
                <li>backup systems;</li>
                <li>dispute resolution; or</li>
                <li>another lawful purpose.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where information is retained for one of these reasons, it will be handled in accordance with
                Applicable Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">27. Your Privacy Rights</h2>
              <p className="mt-2 text-muted-foreground">
                Depending on where you live and the Applicable Law, you may have rights to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>access your Personal Data;</li>
                <li>request correction of inaccurate information;</li>
                <li>request deletion;</li>
                <li>request a portable copy of your information;</li>
                <li>object to certain processing;</li>
                <li>restrict certain processing;</li>
                <li>withdraw consent where processing is based on consent;</li>
                <li>request information about how your data is used;</li>
                <li>lodge a complaint with a relevant regulator; and</li>
                <li>exercise other rights provided by Applicable Law.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You may also edit certain Account and subscription information directly through the Service.
                As noted in Section 10, the security-log category described there is not currently capable
                of being individually located, exported, or deleted, and requests concerning it are limited
                accordingly.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">28. Data Export</h2>
              <p className="mt-2 text-muted-foreground">
                Where supported, SubSentry may provide tools to export Account information.
              </p>
              <p className="mt-2 text-muted-foreground">
                If self-service export is not available, you may request an export by contacting us.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may require reasonable verification before providing personal information or an export.
              </p>
              <p className="mt-2 text-muted-foreground">
                We aim to respond to valid requests within the time required by Applicable Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">29. Children&apos;s Privacy</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is not intended for individuals who do not meet the minimum age requirement stated in
                the Terms of Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not knowingly collect Personal Data from individuals who are prohibited from using the
                Service under that age requirement.
              </p>
              <p className="mt-2 text-muted-foreground">
                If we learn that we have collected Personal Data from an individual who was not permitted to
                use the Service, we may take reasonable steps to delete that information, subject to Applicable
                Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">30. Data Security</h2>
              <p className="mt-2 text-muted-foreground">
                We take reasonable technical and organizational measures designed to protect information
                against unauthorized access, alteration, disclosure, destruction, or loss.
              </p>
              <p className="mt-2 text-muted-foreground">Depending on the implementation, these measures may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>password hashing;</li>
                <li>encryption of sensitive credentials and tokens;</li>
                <li>HTTPS;</li>
                <li>HSTS;</li>
                <li>secure cookies;</li>
                <li>Content Security Policy;</li>
                <li>security headers;</li>
                <li>origin checks for state-changing requests;</li>
                <li>rate limiting;</li>
                <li>login protection;</li>
                <li>CAPTCHA or automated-abuse prevention;</li>
                <li>signed webhook verification;</li>
                <li>access controls; and</li>
                <li>security monitoring and maintenance.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where implemented, sensitive connected-account tokens may be encrypted using AES-256-GCM or an
                equivalent appropriate encryption mechanism.
              </p>
              <p className="mt-2 text-muted-foreground">No method of transmission, storage, or security control is completely secure.</p>
              <p className="mt-2 text-muted-foreground">We cannot guarantee absolute security.</p>
              <p className="mt-2 text-muted-foreground">
                You are also responsible for maintaining the security of your Account credentials and devices.
              </p>
              <p className="mt-2 text-muted-foreground">As of the date of this Privacy Policy, SubSentry has not obtained certifications such as:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>SOC 2;</li>
                <li>ISO 27001; or</li>
                <li>other independent security certifications,</li>
              </ul>
              <p className="mt-3 text-muted-foreground">unless expressly stated otherwise.</p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">31. Security Incidents</h2>
              <p className="mt-2 text-muted-foreground">
                If we become aware of a security incident involving Personal Data, we will assess the incident
                and take reasonable steps appropriate to the circumstances.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where Applicable Law requires notification to affected individuals, regulators, or other
                parties, we will provide notifications within the time and manner required by law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">32. Cookies and Similar Technologies</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may use cookies or similar technologies that are necessary to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>maintain authentication;</li>
                <li>maintain security;</li>
                <li>preserve sessions;</li>
                <li>prevent abuse; or</li>
                <li>provide requested functionality.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where applicable, authentication cookies may be configured with security properties such as
                HttpOnly, Secure, and SameSite.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry does not currently use advertising trackers or advertising pixels as part of the
                Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                If analytics, advertising, or other non-essential tracking technologies are introduced in the
                future, this Privacy Policy and any required consent mechanisms may be updated accordingly.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">33. No Advertising Profile</h2>
              <p className="mt-2 text-muted-foreground">
                We do not build an advertising profile of you based on your use of SubSentry.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not use your subscription or financial information to target advertising to you.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not sell your subscription information, transaction information, or Account information
                to advertisers.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">34. Third-Party Websites and Services</h2>
              <p className="mt-2 text-muted-foreground">
                The Service may contain links to websites or services operated by third parties.
              </p>
              <p className="mt-2 text-muted-foreground">Examples may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>merchants;</li>
                <li>subscription providers;</li>
                <li>financial institutions;</li>
                <li>payment providers; or</li>
                <li>other external services.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                When you access a third-party website or service, that service&apos;s own privacy policy and
                terms may apply.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry is not responsible for the privacy practices of independent third parties.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should review the applicable third-party policies before providing information to them.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">35. Changes to This Privacy Policy</h2>
              <p className="mt-2 text-muted-foreground">We may update this Privacy Policy from time to time.</p>
              <p className="mt-2 text-muted-foreground">
                The &quot;Last updated&quot; date at the beginning of this Privacy Policy indicates when it was
                most recently revised.
              </p>
              <p className="mt-2 text-muted-foreground">For material changes, we may provide notice through:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>email;</li>
                <li>an in-Service notification;</li>
                <li>a notice displayed through the Service; or</li>
                <li>another reasonable method,</li>
              </ul>
              <p className="mt-3 text-muted-foreground">where required by Applicable Law.</p>
              <p className="mt-2 text-muted-foreground">
                If Applicable Law requires affirmative consent to a material change, we will seek that consent
                where required.
              </p>
              <p className="mt-2 text-muted-foreground">
                Your continued use of the Service following the effective date of an updated Privacy Policy
                constitutes acknowledgment of the updated policy only to the extent permitted by Applicable
                Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">36. Contact</h2>
              <p className="mt-2 text-muted-foreground">
                For privacy questions, complaints, requests, or concerns, contact:{" "}
                <a href="mailto:privacy@subsentry.app" className="text-foreground underline underline-offset-4">
                  privacy@subsentry.app
                </a>
              </p>
              <p className="mt-2 text-muted-foreground">
                For legal matters concerning the Service or its Terms, contact:{" "}
                <a href="mailto:legal@subsentry.app" className="text-foreground underline underline-offset-4">
                  legal@subsentry.app
                </a>
              </p>
              <p className="mt-2 text-muted-foreground">
                Additional operator, registered-office, and legal-entity information will be provided once the
                business is formally established and such information is applicable.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">37. Complaints and Regulatory Rights</h2>
              <p className="mt-2 text-muted-foreground">
                If you believe that your Personal Data has been handled improperly, you may contact us using
                the information above.
              </p>
              <p className="mt-2 text-muted-foreground">Nothing in this Privacy Policy prevents you from:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>contacting a data-protection authority;</li>
                <li>contacting a consumer-protection authority;</li>
                <li>exercising a statutory privacy right;</li>
                <li>making a complaint to a regulator; or</li>
                <li>pursuing another remedy available under Applicable Law.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where applicable, you may contact the data-protection supervisory authority in the jurisdiction
                in which you live, work, or believe an infringement occurred.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">38. No Absolute Guarantee</h2>
              <p className="mt-2 text-muted-foreground">
                Although we take reasonable measures to protect information, no online service can guarantee
                absolute security, uninterrupted availability, or complete protection against every possible
                security incident.
              </p>
              <p className="mt-2 text-muted-foreground">
                By using SubSentry, you acknowledge the inherent risks associated with transmitting and storing
                information online.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in this Section limits any legal obligation that cannot lawfully be limited.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">39. Data Minimization</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is intended to collect and process information reasonably necessary for the
                functionality being provided.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where possible, the Service is designed to avoid retaining unnecessary source information.
              </p>
              <p className="mt-2 text-muted-foreground">
                For example, where an import feature is designed to process raw transactions or email messages
                temporarily, the Service may retain only the subscription information you review and confirm
                rather than the complete underlying source.
              </p>
              <p className="mt-2 text-muted-foreground">
                Actual retention depends on the technical implementation of the applicable feature.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">40. No Sale or Unauthorized Disclosure</h2>
              <p className="mt-2 text-muted-foreground">
                Except as described in this Privacy Policy, we do not intentionally disclose your Personal Data
                to third parties.
              </p>
              <p className="mt-2 text-muted-foreground">We may disclose information where reasonably necessary to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>provide the Service;</li>
                <li>operate infrastructure;</li>
                <li>process payments;</li>
                <li>provide financial-data connections;</li>
                <li>provide AI functionality;</li>
                <li>deliver email;</li>
                <li>prevent fraud or abuse;</li>
                <li>maintain security;</li>
                <li>comply with legal obligations;</li>
                <li>respond to lawful requests;</li>
                <li>establish or defend legal claims; or</li>
                <li>protect the rights, property, or safety of Users, SubSentry, or others.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where disclosure is legally required, we may disclose the information necessary to comply with
                the applicable requirement.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">41. Business Transfers</h2>
              <p className="mt-2 text-muted-foreground">If SubSentry is involved in a:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>merger;</li>
                <li>acquisition;</li>
                <li>financing;</li>
                <li>restructuring;</li>
                <li>sale of assets;</li>
                <li>establishment of a legal entity;</li>
                <li>transfer of the Service; or</li>
                <li>similar transaction,</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Personal Data may be transferred as part of that transaction, subject to Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where required, we will provide appropriate notice or obtain required consent.
              </p>
              <p className="mt-2 text-muted-foreground">
                Any successor operator will be expected to handle Personal Data in accordance with applicable
                privacy obligations.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">42. International Users</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may be accessed by Users from different countries.
              </p>
              <p className="mt-2 text-muted-foreground">Privacy laws vary between jurisdictions.</p>
              <p className="mt-2 text-muted-foreground">Your rights and the obligations applicable to SubSentry may therefore depend on:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>your location;</li>
                <li>the location of our infrastructure;</li>
                <li>the location of our service providers;</li>
                <li>the nature of the processing; and</li>
                <li>Applicable Law.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Nothing in this Privacy Policy is intended to remove any mandatory privacy rights applicable to
                you.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">43. Accuracy of Personal Data</h2>
              <p className="mt-2 text-muted-foreground">
                We aim to maintain Personal Data that is reasonably accurate and appropriate for the purposes
                for which it is used.
              </p>
              <p className="mt-2 text-muted-foreground">
                You may correct certain information directly through your Account.
              </p>
              <p className="mt-2 text-muted-foreground">
                You may also contact us to request correction of inaccurate Personal Data.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may ask for reasonable information to verify the request before making changes.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">44. Data Processing and Automated Systems</h2>
              <p className="mt-2 text-muted-foreground">
                Some SubSentry functionality involves automated processing.
              </p>
              <p className="mt-2 text-muted-foreground">This may include:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>identifying recurring transactions;</li>
                <li>categorizing subscriptions;</li>
                <li>identifying potential duplicates;</li>
                <li>estimating renewal dates;</li>
                <li>calculating savings;</li>
                <li>generating insights; and</li>
                <li>processing information through AI Features.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">Automated processing may produce errors.</p>
              <p className="mt-2 text-muted-foreground">
                Unless expressly stated otherwise, these systems are intended to assist with organization and
                analysis rather than make legally binding decisions about you.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where Applicable Law grants you specific rights concerning automated decision-making or
                profiling, those rights remain unaffected.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">45. Relationship With the Terms of Service</h2>
              <p className="mt-2 text-muted-foreground">
                Your use of SubSentry is also governed by the{" "}
                <Link href="/terms" className="text-foreground underline underline-offset-4">
                  Terms of Service
                </Link>
                .
              </p>
              <p className="mt-2 text-muted-foreground">
                The Terms of Service establish the contractual rules governing your use of the Service.
              </p>
              <p className="mt-2 text-muted-foreground">This Privacy Policy explains how Personal Data is handled.</p>
              <p className="mt-2 text-muted-foreground">The documents should be read together.</p>
              <p className="mt-2 text-muted-foreground">
                If there is a conflict concerning mandatory privacy rights, Applicable Law will control.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">46. Acknowledgment</h2>
              <p className="mt-2 text-muted-foreground">
                By using SubSentry, you acknowledge that you have read and understood this Privacy Policy,
                including the provisions concerning:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>financial information;</li>
                <li>connected accounts;</li>
                <li>imports;</li>
                <li>AI processing;</li>
                <li>Third-Party Services;</li>
                <li>data retention;</li>
                <li>security;</li>
                <li>account deletion; and</li>
                <li>your privacy rights.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Nothing in this acknowledgment waives any privacy or data-protection right that Applicable Law
                does not permit you to waive.
              </p>
            </section>

            <section>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-h2 font-semibold">Important privacy notice</h2>
                <p className="mt-2 text-muted-foreground">SubSentry is an early-stage beta service.</p>
                <p className="mt-2 text-muted-foreground">
                  Depending on the features you use, SubSentry may process sensitive information relating to
                  your subscriptions, transactions, financial accounts, and connected services.
                </p>
                <p className="mt-2 text-muted-foreground">
                  You should understand the following before using the Service:
                </p>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                  <li>Financial-account connections are intended to be read-only.</li>
                  <li>SubSentry does not receive your bank password through supported OAuth connections.</li>
                  <li>
                    SubSentry does not use connected accounts to move money or make purchases unless expressly
                    stated for a future feature.
                  </li>
                  <li>
                    Imported financial or email information may be processed automatically to identify
                    subscription information.
                  </li>
                  <li>Automated detection may be inaccurate.</li>
                  <li>AI Features may produce inaccurate or incomplete results.</li>
                  <li>
                    Information may be processed by third-party providers such as financial-data providers,
                    payment processors, email providers, security providers, or AI providers when necessary to
                    provide requested functionality.
                  </li>
                  <li>
                    Disconnecting an integration does not necessarily delete information previously imported
                    into your Account.
                  </li>
                  <li>
                    Deleting your Account may permanently delete information stored by SubSentry, subject to
                    legally required retention.
                  </li>
                  <li>No online system is completely secure.</li>
                  <li>SubSentry does not sell your personal information or use it to build an advertising profile.</li>
                  <li>SubSentry has not obtained independent security certifications unless expressly stated otherwise.</li>
                  <li>SubSentry&apos;s legal entity and formal operator information will be updated once the business is formally established.</li>
                </ul>
                <p className="mt-3 text-muted-foreground">
                  By using SubSentry, you acknowledge these privacy and data-processing considerations, subject
                  to all rights and protections that cannot lawfully be excluded, restricted, or waived under
                  Applicable Law.
                </p>
              </div>
            </section>
          </div>
        </article>
      </main>
      <LandingFooter />
    </>
  );
}
