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
const LAST_UPDATED = "August 16, 2026";

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

          <div className="mt-5 space-y-4 text-lg text-muted-foreground">
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of SubSentry
              (&quot;SubSentry,&quot; the &quot;Service,&quot; &quot;we,&quot; &quot;us,&quot; or
              &quot;our&quot;).
            </p>
            <p>
              SubSentry is currently operated as an early-stage online project and beta service by the person
              or persons responsible for operating the Service from time to time. The Service may be operated
              through one or more individuals, entities, or other lawful arrangements pending the formal
              establishment of the business.
            </p>
            <p>
              References to &quot;SubSentry,&quot; &quot;we,&quot; &quot;us,&quot; and &quot;our&quot; refer
              to the person or persons responsible for operating the Service from time to time, unless
              otherwise stated.
            </p>
            <p>These Terms do not themselves create or represent a separate legal entity.</p>
            <p>
              By creating an Account, accessing, or using the Service, you acknowledge that you have read and
              understood these Terms and agree to be bound by them to the extent permitted by Applicable Law.
            </p>
            <p>If you do not agree to these Terms, you must not access or use the Service.</p>
            <p>
              Nothing in these Terms is intended to exclude, restrict, waive, or limit any right, remedy,
              liability, warranty, consumer protection, statutory protection, or other protection that cannot
              lawfully be excluded, restricted, or limited under Applicable Law.
            </p>
            <p>
              Please read these Terms alongside our{" "}
              <Link href="/privacy" className="text-foreground underline underline-offset-4">
                Privacy Policy
              </Link>
              , which explains how information may be collected, used, processed, stored, disclosed,
              transferred, retained, and deleted.
            </p>
          </div>

          <div className="mt-10 space-y-10">
            <section>
              <h2 className="text-h2 font-semibold">1. Definitions</h2>
              <p className="mt-2 text-muted-foreground">For purposes of these Terms:</p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">&quot;Account&quot;</strong> means an account created
                  to access or use the Service.
                </li>
                <li>
                  <strong className="text-foreground">&quot;User,&quot; &quot;you,&quot; or
                  &quot;your&quot;</strong> means the individual or entity accessing or using the Service.
                </li>
                <li>
                  <strong className="text-foreground">&quot;User Content&quot;</strong> means information,
                  data, files, transaction records, subscription information, account information,
                  communications, and other materials that you submit, upload, import, connect, transmit, or
                  otherwise make available through the Service.
                </li>
                <li>
                  <strong className="text-foreground">&quot;Third-Party Service&quot;</strong> means any
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
              <h2 className="text-h2 font-semibold">2. The Service</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is designed to help Users organize, understand, and review recurring subscription
                expenses.
              </p>
              <p className="mt-2 text-muted-foreground">
                Depending on the features actually made available to you, SubSentry may provide functionality
                such as:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>organizing subscription information;</li>
                <li>importing transaction information;</li>
                <li>identifying potential recurring transactions;</li>
                <li>identifying potential duplicate or overlapping subscriptions;</li>
                <li>identifying subscriptions that may warrant review;</li>
                <li>analyzing recurring spending;</li>
                <li>identifying potential upcoming renewals;</li>
                <li>calculating spending totals;</li>
                <li>estimating potential savings;</li>
                <li>generating summaries and insights; and</li>
                <li>providing recommendations relating to subscription management.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Not every feature described above will necessarily be available at all times or to every User.
              </p>
              <p className="mt-2 text-muted-foreground">
                Features may be introduced, modified, restricted, replaced, suspended, or discontinued at any
                time, subject to Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not guarantee that any particular feature will remain available.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">3. Nature of the Service</h2>
              <p className="mt-2 text-muted-foreground">SubSentry is an information and organization service.</p>
              <p className="mt-2 text-muted-foreground">
                Unless expressly stated otherwise for a particular feature, SubSentry is not:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>a bank;</li>
                <li>a financial institution;</li>
                <li>a payment institution;</li>
                <li>an investment platform;</li>
                <li>a broker;</li>
                <li>a lender;</li>
                <li>an accounting service;</li>
                <li>a tax service;</li>
                <li>a legal service;</li>
                <li>a financial adviser;</li>
                <li>an investment adviser;</li>
                <li>a fiduciary; or</li>
                <li>another professional adviser.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">Unless expressly stated otherwise, SubSentry does not:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>hold or custody your money;</li>
                <li>operate a bank account for you;</li>
                <li>make investment decisions for you;</li>
                <li>provide professional financial, investment, tax, accounting, or legal advice;</li>
                <li>make payments on your behalf;</li>
                <li>guarantee cancellation of a subscription;</li>
                <li>guarantee that a merchant will process a cancellation;</li>
                <li>guarantee that a merchant will provide a refund;</li>
                <li>guarantee any particular savings;</li>
                <li>guarantee that a recommended alternative is suitable for you; or</li>
                <li>act as your agent or fiduciary.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where the Service provides cancellation information, links, instructions, or assistance, you
                remain responsible for determining whether and how to act.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">4. Beta Service</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry is currently provided as an early-stage beta service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Beta software may contain defects, errors, limitations, experimental functionality, and
                unexpected behavior.
              </p>
              <p className="mt-2 text-muted-foreground">Accordingly, the Service may experience:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>bugs;</li>
                <li>inaccurate results;</li>
                <li>incomplete information;</li>
                <li>failed imports;</li>
                <li>incorrect calculations;</li>
                <li>unavailable integrations;</li>
                <li>temporary outages;</li>
                <li>performance problems;</li>
                <li>security or reliability issues; and</li>
                <li>other unexpected behavior.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                The Service may be suspended, materially changed, or discontinued.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not guarantee that the beta Service will become a permanent commercial product or that
                any particular feature will remain available.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should maintain independent records of important financial, transaction, account, and
                subscription information. You should not use SubSentry as your sole or authoritative financial
                record.
              </p>
              <p className="mt-2 text-muted-foreground">
                As of the effective date above, all features of the Service are available without charge while
                it remains in beta. If we introduce a paid plan, payments for it will be processed by our
                third-party payment processor, and the price, billing frequency, and cancellation method for
                that plan will be disclosed to you before you are charged. We do not currently store your
                payment card details ourselves.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">5. Eligibility</h2>
              <p className="mt-2 text-muted-foreground">You may use the Service only if:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>you are at least 18 years old;</li>
                <li>you have the legal capacity required to enter into these Terms;</li>
                <li>you are legally permitted to use the Service; and</li>
                <li>your use complies with Applicable Law.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You must not create or use an Account if you are under 18 years of age.
              </p>
              <p className="mt-2 text-muted-foreground">You must not misrepresent your age or eligibility.</p>
              <p className="mt-2 text-muted-foreground">
                We do not verify your age or identity using government-issued identification or similar means.
                Creating and continuing to use an Account is your representation and attestation that you meet
                the eligibility requirements in this Section, and we are entitled to rely on that
                representation.
              </p>
              <p className="mt-2 text-muted-foreground">
                If you are using the Service on behalf of an entity, you represent that you are authorized to
                accept these Terms on that entity&apos;s behalf.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may refuse, suspend, or terminate an Account where reasonably necessary to enforce
                eligibility requirements, prevent abuse, protect the Service, or comply with Applicable Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">6. Accounts</h2>
              <p className="mt-2 text-muted-foreground">Certain features require an Account.</p>
              <p className="mt-2 text-muted-foreground">You agree to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>provide reasonably accurate information;</li>
                <li>keep Account information reasonably current;</li>
                <li>protect your login credentials;</li>
                <li>use reasonable security precautions;</li>
                <li>not knowingly permit unauthorized access;</li>
                <li>promptly notify us of suspected Account compromise; and</li>
                <li>cooperate with reasonable security measures.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You are responsible for activity conducted through your Account to the extent that such
                activity results from your actions, your failure to reasonably protect your credentials, or
                your authorization of another person&apos;s access.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in this Section imposes responsibility on you where Applicable Law provides otherwise.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">7. User Content</h2>
              <p className="mt-2 text-muted-foreground">
                You may provide or import information relating to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>subscriptions;</li>
                <li>merchants;</li>
                <li>transactions;</li>
                <li>prices;</li>
                <li>currencies;</li>
                <li>renewal dates;</li>
                <li>categories;</li>
                <li>financial information;</li>
                <li>supported account information;</li>
                <li>files; and</li>
                <li>other information relevant to the Service.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">You remain responsible for the information you provide.</p>
              <p className="mt-2 text-muted-foreground">
                You represent that you have the rights, permissions, authorizations, or other lawful basis
                necessary to provide information you submit or import.
              </p>
              <p className="mt-2 text-muted-foreground">
                To the extent you have ownership rights in User Content, you retain those rights.
              </p>
              <p className="mt-2 text-muted-foreground">
                You grant us a limited, non-exclusive right to host, store, transmit, process, analyze,
                display, and otherwise use User Content only as reasonably necessary to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>provide the Service;</li>
                <li>operate and maintain the Service;</li>
                <li>provide requested functionality;</li>
                <li>authenticate and secure Accounts;</li>
                <li>detect and prevent fraud and abuse;</li>
                <li>maintain Service security and reliability;</li>
                <li>troubleshoot and provide support;</li>
                <li>comply with Applicable Law; and</li>
                <li>perform purposes disclosed in our Privacy Policy.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where supported by our actual data practices and described in our Privacy Policy, we may also
                use information in aggregated or appropriately de-identified form to analyze usage patterns,
                monitor performance, improve functionality, develop features, and maintain the security and
                reliability of the Service, subject to Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                This license does not transfer ownership of your User Content to SubSentry.
              </p>
              <p className="mt-2 text-muted-foreground">
                Our processing of personal information is governed by our{" "}
                <Link href="/privacy" className="text-foreground underline underline-offset-4">
                  Privacy Policy
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">8. Accuracy of Information</h2>
              <p className="mt-2 text-muted-foreground">
                Information displayed through SubSentry may not always be accurate, complete, current, or
                reliable.
              </p>
              <p className="mt-2 text-muted-foreground">Information may originate from:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>you;</li>
                <li>imported files;</li>
                <li>Third-Party Services;</li>
                <li>automated processing;</li>
                <li>AI Features; or</li>
                <li>other sources.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Imported or automatically processed information may contain:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>incorrect merchant names;</li>
                <li>duplicate transactions;</li>
                <li>missing transactions;</li>
                <li>incorrect categories;</li>
                <li>incorrect dates;</li>
                <li>incorrect amounts;</li>
                <li>incorrect currencies;</li>
                <li>incomplete records; or</li>
                <li>other errors.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where an authoritative source exists, including a bank, card issuer, merchant, subscription
                provider, or financial institution, you should treat that source as authoritative rather than
                SubSentry.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should independently verify material information before relying on it or taking action.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">9. Connected Accounts and Third-Party Services</h2>
              <p className="mt-2 text-muted-foreground">
                Where supported, SubSentry may allow you to connect or import information from Third-Party
                Services.
              </p>
              <p className="mt-2 text-muted-foreground">
                You may connect only accounts, services, files, inboxes, or other resources that you own or
                are legally authorized to access.
              </p>
              <p className="mt-2 text-muted-foreground">
                Before connecting a Third-Party Service, you should review the permissions and disclosures
                presented to you.
              </p>
              <p className="mt-2 text-muted-foreground">
                Third-Party Services operate independently from SubSentry and may have separate:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>terms;</li>
                <li>privacy policies;</li>
                <li>security practices;</li>
                <li>fees;</li>
                <li>availability requirements;</li>
                <li>data-retention practices; and</li>
                <li>limitations.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We do not guarantee that any Third-Party Service will remain available, accurate, secure,
                compatible, or supported.
              </p>
              <p className="mt-2 text-muted-foreground">
                A Third-Party Service becoming unavailable may cause corresponding SubSentry functionality to
                become unavailable, delayed, or limited.
              </p>
              <p className="mt-2 text-muted-foreground">
                Disconnecting an integration may prevent future data access but may not automatically delete
                information previously imported into SubSentry.
              </p>
              <p className="mt-2 text-muted-foreground">
                Data deletion and retention are governed by our Privacy Policy and Applicable Law.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">10. Financial Information</h2>
              <p className="mt-2 text-muted-foreground">
                Some SubSentry features may involve information concerning transactions, subscriptions,
                financial accounts, or spending.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry does not independently guarantee the accuracy of information obtained from financial
                institutions, merchants, aggregators, or other data sources.
              </p>
              <p className="mt-2 text-muted-foreground">Financial information may be:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>delayed;</li>
                <li>incomplete;</li>
                <li>incorrectly categorized;</li>
                <li>duplicated;</li>
                <li>incorrectly attributed;</li>
                <li>unavailable; or</li>
                <li>otherwise inaccurate.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                SubSentry is not responsible for errors originating from a financial institution, merchant,
                data provider, aggregator, or other Third-Party Service, except to the extent Applicable Law
                imposes responsibility directly upon SubSentry.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should verify important information against the relevant authoritative source before
                taking action.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">11. Automated Detection</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may automatically analyze information to identify potential:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>recurring subscriptions;</li>
                <li>duplicate subscriptions;</li>
                <li>spending patterns;</li>
                <li>renewal patterns;</li>
                <li>merchant relationships;</li>
                <li>overlapping services;</li>
                <li>savings opportunities; and</li>
                <li>other patterns.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Automated analysis is probabilistic and may produce incorrect results.
              </p>
              <p className="mt-2 text-muted-foreground">For example, SubSentry may:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>identify a non-subscription transaction as recurring;</li>
                <li>fail to identify an actual subscription;</li>
                <li>identify the wrong merchant;</li>
                <li>group unrelated transactions;</li>
                <li>fail to group related transactions;</li>
                <li>estimate an incorrect renewal date; or</li>
                <li>calculate an incorrect amount.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Automated results are provided to assist your review, not replace it.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">12. Artificial Intelligence</h2>
              <p className="mt-2 text-muted-foreground">Certain features may use AI Features.</p>
              <p className="mt-2 text-muted-foreground">AI Features may assist with:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>classification;</li>
                <li>extraction;</li>
                <li>organization;</li>
                <li>summarization;</li>
                <li>explanations;</li>
                <li>pattern identification;</li>
                <li>recommendations; and</li>
                <li>other Service functionality.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                AI Features may rely on information provided by you, information obtained from Third-Party
                Services, and other information available to the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                AI-generated output may be inaccurate, incomplete, inconsistent, outdated, or unsuitable for
                your circumstances.
              </p>
              <p className="mt-2 text-muted-foreground">
                Output may vary depending on the information available at the time it is generated.
              </p>
              <p className="mt-2 text-muted-foreground">
                AI systems may generate output that appears confident despite containing errors.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should independently verify important information before relying upon AI-generated output.
              </p>
              <p className="mt-2 text-muted-foreground">
                AI-generated output does not constitute professional financial, investment, tax, accounting,
                legal, or other professional advice.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where a Third-Party Service provides AI processing, information may be processed by that
                provider as described in our Privacy Policy and applicable service disclosures.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">13. Recommendations and Savings Estimates</h2>
              <p className="mt-2 text-muted-foreground">
                SubSentry may provide recommendations, savings estimates, subscription-health scores, or other
                insights.
              </p>
              <p className="mt-2 text-muted-foreground">These are informational only.</p>
              <p className="mt-2 text-muted-foreground">
                A savings estimate is not a guarantee of actual savings.
              </p>
              <p className="mt-2 text-muted-foreground">Actual savings may differ because of:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>price changes;</li>
                <li>taxes;</li>
                <li>fees;</li>
                <li>merchant policies;</li>
                <li>billing dates;</li>
                <li>cancellation requirements;</li>
                <li>promotional pricing;</li>
                <li>exchange rates; or</li>
                <li>other circumstances.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                A recommendation does not mean that a particular action is suitable for you.
              </p>
              <p className="mt-2 text-muted-foreground">
                You are responsible for deciding whether to act on information provided by the Service.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">14. Subscription Cancellation</h2>
              <p className="mt-2 text-muted-foreground">
                Unless expressly stated otherwise for a particular feature, SubSentry does not guarantee that a
                subscription can be cancelled.
              </p>
              <p className="mt-2 text-muted-foreground">
                Merchants and subscription providers independently determine:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>whether cancellation is permitted;</li>
                <li>how cancellation must be requested;</li>
                <li>when cancellation becomes effective;</li>
                <li>whether additional verification is required;</li>
                <li>whether fees apply; and</li>
                <li>whether refunds are available.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                If SubSentry provides cancellation instructions, links, or assistance, you remain responsible
                for confirming that cancellation actually occurred.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should retain cancellation confirmations and other relevant records.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry is not responsible for a merchant&apos;s failure to receive, process, or honor a
                cancellation request, except to the extent Applicable Law provides otherwise.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">15. No Real-Time Monitoring</h2>
              <p className="mt-2 text-muted-foreground">
                Unless expressly stated otherwise, SubSentry does not guarantee real-time monitoring of:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>transactions;</li>
                <li>account balances;</li>
                <li>subscription renewals;</li>
                <li>merchant activity;</li>
                <li>billing events; or</li>
                <li>other financial events.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Information displayed through the Service may be delayed, incomplete, or unavailable.
              </p>
              <p className="mt-2 text-muted-foreground">
                You remain responsible for monitoring your financial accounts and subscription obligations
                directly with the relevant financial institution, merchant, or service provider.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where the Service sends renewal-reminder notifications, they are informational only and timed
                using UTC dates; because the Service does not store a per-user time zone, a reminder may not
                align with your local calendar day and should not be relied on as your sole or final warning
                before a renewal.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">16. User Responsibilities</h2>
              <p className="mt-2 text-muted-foreground">You agree to:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>use the Service lawfully;</li>
                <li>provide information you are authorized to provide;</li>
                <li>maintain reasonable Account security;</li>
                <li>connect only authorized accounts and services;</li>
                <li>review important automated results;</li>
                <li>independently verify important financial information;</li>
                <li>comply with Applicable Law;</li>
                <li>respect third-party rights; and</li>
                <li>maintain independent records of important information.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You remain responsible for decisions you make based on information provided through SubSentry.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">17. Prohibited Conduct</h2>
              <p className="mt-2 text-muted-foreground">You must not:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>use the Service for unlawful, fraudulent, deceptive, abusive, or malicious purposes;</li>
                <li>access another person&apos;s Account or information without authorization;</li>
                <li>
                  connect another person&apos;s financial account, inbox, files, or services without
                  authorization;
                </li>
                <li>impersonate another person or organization;</li>
                <li>circumvent authentication or access controls;</li>
                <li>bypass rate limits or security measures;</li>
                <li>probe or test the vulnerability of the Service without authorization;</li>
                <li>interfere with the Service or its infrastructure;</li>
                <li>introduce malware or malicious code;</li>
                <li>scrape or systematically extract information without permission;</li>
                <li>reverse engineer the Service except where Applicable Law expressly permits it;</li>
                <li>
                  attempt to obtain proprietary source code or algorithms except where legally permitted;
                </li>
                <li>abuse Account creation or beta resources;</li>
                <li>resell or sublicense the Service without permission;</li>
                <li>infringe third-party rights;</li>
                <li>facilitate fraud or unauthorized access; or</li>
                <li>assist another person in violating these Terms.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We may take reasonable measures to protect the Service, Users, and third parties, including
                restricting or suspending access where reasonably necessary.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">18. Intellectual Property</h2>
              <p className="mt-2 text-muted-foreground">
                The Service and its proprietary components, including software, source code, architecture,
                algorithms, designs, interfaces, branding, documentation, and visual elements, are owned by or
                licensed to the person or persons responsible for operating the Service, or are otherwise used
                with permission.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in these Terms transfers ownership of those rights to you.
              </p>
              <p className="mt-2 text-muted-foreground">
                Except for rights expressly granted under these Terms, no ownership rights are transferred to
                you.
              </p>
              <p className="mt-2 text-muted-foreground">
                Subject to these Terms, you receive a limited, personal, non-exclusive, non-transferable,
                non-sublicensable right to use the Service for its intended purpose.
              </p>
              <p className="mt-2 text-muted-foreground">
                You may not, except where expressly permitted by us or Applicable Law:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>copy;</li>
                <li>reproduce;</li>
                <li>distribute;</li>
                <li>modify;</li>
                <li>create derivative works;</li>
                <li>sell;</li>
                <li>sublicense;</li>
                <li>commercially exploit; or</li>
                <li>otherwise misuse</li>
              </ul>
              <p className="mt-3 text-muted-foreground">the Service or its proprietary components.</p>
              <p className="mt-2 text-muted-foreground">
                Third-party trademarks remain the property of their respective owners.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">19. Feedback</h2>
              <p className="mt-2 text-muted-foreground">
                If you voluntarily provide suggestions, ideas, recommendations, bug reports, or other feedback
                concerning SubSentry (&quot;Feedback&quot;), you grant us a non-exclusive, worldwide,
                royalty-free right to use, reproduce, modify, adapt, publish, distribute, and otherwise use
                that Feedback for lawful purposes without compensation or attribution, subject to Applicable
                Law.
              </p>
              <p className="mt-2 text-muted-foreground">This does not transfer ownership of your User Content.</p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">20. Service Changes</h2>
              <p className="mt-2 text-muted-foreground">
                Because SubSentry is a beta service, we may modify, update, suspend, restrict, replace, or
                discontinue features or portions of the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not guarantee that any particular feature, integration, data source, or functionality
                will remain available.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where reasonably practicable and required by Applicable Law, we may provide notice of material
                changes.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">21. Availability</h2>
              <p className="mt-2 text-muted-foreground">The Service may become unavailable because of:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>maintenance;</li>
                <li>infrastructure failures;</li>
                <li>Third-Party Service failures;</li>
                <li>telecommunications failures;</li>
                <li>internet disruptions;</li>
                <li>security incidents;</li>
                <li>software defects;</li>
                <li>upgrades;</li>
                <li>capacity limitations; or</li>
                <li>circumstances beyond our reasonable control.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                We will use reasonable efforts to restore material functionality where reasonably practicable.
              </p>
              <p className="mt-2 text-muted-foreground">
                We do not guarantee uninterrupted, continuous, timely, secure, or error-free operation.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">22. No Professional Advice</h2>
              <p className="mt-2 text-muted-foreground">
                Information provided through SubSentry is not professional advice.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry does not provide financial, investment, tax, accounting, legal, credit, fiduciary, or
                other professional advice.
              </p>
              <p className="mt-2 text-muted-foreground">
                You should seek appropriate professional advice where necessary.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">23. Disclaimer of Warranties</h2>
              <p className="mt-2 text-muted-foreground">
                To the maximum extent permitted by Applicable Law, the Service is provided &quot;AS IS&quot;
                and &quot;AS AVAILABLE.&quot;
              </p>
              <p className="mt-2 text-muted-foreground">
                To the maximum extent permitted by Applicable Law, we do not warrant or guarantee that:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>the Service will always be available;</li>
                <li>the Service will be uninterrupted;</li>
                <li>the Service will be error-free;</li>
                <li>information will always be accurate;</li>
                <li>information will always be complete or current;</li>
                <li>automated results will be accurate;</li>
                <li>AI output will be accurate;</li>
                <li>imported information will be complete;</li>
                <li>calculations will always be correct;</li>
                <li>recommendations will be suitable;</li>
                <li>savings estimates will be realized;</li>
                <li>cancellation assistance will result in cancellation;</li>
                <li>Third-Party Services will remain available; or</li>
                <li>defects will always be corrected.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Nothing in this Section excludes any warranty or statutory protection that cannot legally be
                excluded.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">24. Limitation of Liability</h2>
              <p className="mt-2 text-muted-foreground">
                To the maximum extent permitted by Applicable Law, SubSentry and the persons or entities
                involved in operating or providing the Service will not be liable for any indirect, incidental,
                special, consequential, exemplary, or punitive loss or damage arising out of or relating to the
                Service or these Terms, whether arising in contract, tort, negligence, statute, or otherwise.
              </p>
              <p className="mt-2 text-muted-foreground">This includes, to the maximum extent permitted by law:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>loss of profits;</li>
                <li>loss of revenue;</li>
                <li>loss of business opportunities;</li>
                <li>loss of anticipated savings;</li>
                <li>loss of goodwill;</li>
                <li>loss of reputation;</li>
                <li>loss of anticipated benefits;</li>
                <li>reliance upon automated results;</li>
                <li>reliance upon AI-generated output;</li>
                <li>inaccurate imported information;</li>
                <li>merchant actions;</li>
                <li>Third-Party Service failures;</li>
                <li>service interruptions; and</li>
                <li>loss or corruption of data.</li>
              </ul>

              <h3 className="mt-6 text-lg font-semibold text-foreground">Aggregate Liability Cap</h3>
              <p className="mt-2 text-muted-foreground">
                To the maximum extent permitted by Applicable Law, the total aggregate liability arising out of
                or relating to the Service or these Terms, collectively across all claims and not separately
                for each claim or incident, will not exceed the greater of:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>
                  the total amount you actually paid to SubSentry for the Service during the twelve months
                  preceding the event giving rise to the claim; or
                </li>
                <li>US$100.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                If you have paid nothing to SubSentry, the aggregate liability cap will be US$100, subject to
                Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                The limitations in this Section apply regardless of the legal theory asserted, including
                contract, tort, negligence, statutory liability, or otherwise, to the maximum extent permitted
                by law.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in this Section excludes, restricts, or limits liability that cannot lawfully be
                excluded, restricted, or limited.
              </p>
              <p className="mt-2 text-muted-foreground">
                If any portion of this Section is found unenforceable, it will apply to the maximum extent
                legally permitted and the remaining provisions will continue in effect.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">25. Risk Allocation</h2>
              <p className="mt-2 text-muted-foreground">
                You acknowledge that SubSentry is an early-stage beta service and that:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>automated results may contain errors;</li>
                <li>AI output may contain errors;</li>
                <li>imported information may be incomplete or inaccurate;</li>
                <li>Third-Party Services may fail;</li>
                <li>merchants may change prices or policies;</li>
                <li>cancellation requests may fail or be delayed;</li>
                <li>savings estimates may not be realized; and</li>
                <li>important information should be independently verified.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                These risks are material considerations in your decision to use the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in this Section excludes or restricts liability that cannot legally be excluded or
                restricted.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">26. Indemnification</h2>
              <p className="mt-2 text-muted-foreground">
                To the maximum extent permitted by Applicable Law, you agree to indemnify and hold harmless
                SubSentry and the persons or entities responsible for operating or providing the Service,
                together with their applicable service providers, licensors, contractors, contributors,
                officers, directors, and employees, from third-party claims, liabilities, damages, costs, and
                reasonable expenses arising directly from:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>your material violation of these Terms;</li>
                <li>your unlawful use of the Service;</li>
                <li>your unauthorized access to another person&apos;s account or information;</li>
                <li>your infringement of another person&apos;s rights; or</li>
                <li>User Content you provide without having the necessary rights or authorization.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You are not required to indemnify SubSentry to the extent the applicable claim results from
                conduct for which indemnification would be prohibited by Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                Where legally permitted, we will provide reasonable notice of an indemnified claim and
                reasonable cooperation in its defense.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">27. Suspension and Termination</h2>
              <p className="mt-2 text-muted-foreground">You may stop using the Service at any time.</p>
              <p className="mt-2 text-muted-foreground">
                Where available, you may request deletion of your Account through the Service or by contacting
                us.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may suspend or terminate access where reasonably necessary if:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>you materially violate these Terms;</li>
                <li>you engage in prohibited conduct;</li>
                <li>your use creates a material security, legal, or operational risk;</li>
                <li>we are required to do so by law;</li>
                <li>we reasonably believe your Account has been compromised;</li>
                <li>suspension is necessary to prevent fraud or abuse; or</li>
                <li>we discontinue the relevant Service.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where reasonably practicable and legally permitted, we may provide notice before termination.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may immediately suspend access where reasonably necessary to prevent fraud, unauthorized
                access, security incidents, unlawful activity, material harm, or significant operational risk.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">28. Effect of Termination</h2>
              <p className="mt-2 text-muted-foreground">
                Termination does not affect rights or obligations accrued before termination.
              </p>
              <p className="mt-2 text-muted-foreground">
                Termination may result in loss of access to information stored within your Account.
              </p>
              <p className="mt-2 text-muted-foreground">
                Provisions concerning intellectual property, User Content, disclaimers, liability limitations,
                indemnification, dispute resolution, and other provisions intended by their nature to survive
                termination will survive termination.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">29. Account Deletion and Data Retention</h2>
              <p className="mt-2 text-muted-foreground">
                Account deletion may result in loss of access to information stored through the Service.
              </p>
              <p className="mt-2 text-muted-foreground">
                Information will be handled in accordance with our{" "}
                <Link href="/privacy" className="text-foreground underline underline-offset-4">
                  Privacy Policy
                </Link>{" "}
                and Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                We may retain information where reasonably necessary or legally required for:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>legal compliance;</li>
                <li>security;</li>
                <li>fraud prevention;</li>
                <li>establishing or defending legal claims;</li>
                <li>backup and disaster recovery;</li>
                <li>legitimate operational purposes described in the Privacy Policy; or</li>
                <li>other purposes permitted or required by Applicable Law.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You should maintain independent copies of important financial and subscription records.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">30. Privacy</h2>
              <p className="mt-2 text-muted-foreground">
                Your use of SubSentry is also governed by our{" "}
                <Link href="/privacy" className="text-foreground underline underline-offset-4">
                  Privacy Policy
                </Link>
                .
              </p>
              <p className="mt-2 text-muted-foreground">
                The Privacy Policy explains how information may be collected, used, processed, stored,
                disclosed, transferred, retained, and deleted.
              </p>
              <p className="mt-2 text-muted-foreground">
                The Privacy Policy and these Terms should be read together.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in these Terms is intended to override mandatory privacy or data-protection rights.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">31. Electronic Acceptance</h2>
              <p className="mt-2 text-muted-foreground">
                By creating an Account, selecting an acceptance mechanism, or otherwise using the Service after
                being presented with these Terms where such conduct constitutes acceptance under Applicable
                Law, you agree to these Terms to the extent legally enforceable.
              </p>
              <p className="mt-2 text-muted-foreground">
                You consent to receiving electronic communications relating to:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>your Account;</li>
                <li>the Service;</li>
                <li>security;</li>
                <li>material changes;</li>
                <li>these Terms; and</li>
                <li>operational matters.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where Applicable Law requires a specific form of consent, we will use the legally required
                method.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">32. Changes to These Terms</h2>
              <p className="mt-2 text-muted-foreground">We may update these Terms from time to time.</p>
              <p className="mt-2 text-muted-foreground">
                The &quot;Last updated&quot; date will indicate when the Terms were most recently revised.
              </p>
              <p className="mt-2 text-muted-foreground">
                For material changes, we will provide reasonable notice where required by Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">Notice may be provided through:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>email;</li>
                <li>an in-Service notification;</li>
                <li>a notice on the Service; or</li>
                <li>another reasonable electronic method.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Where Applicable Law requires affirmative consent to a change, we will seek that consent.
              </p>
              <p className="mt-2 text-muted-foreground">
                Otherwise, updated Terms will become effective on the date stated in the applicable notice.
              </p>
              <p className="mt-2 text-muted-foreground">
                If you do not agree to updated Terms, you should stop using the Service and, where available,
                delete your Account.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">33. Governing Law and Jurisdiction</h2>
              <p className="mt-2 text-muted-foreground">
                These Terms are intended to operate subject to the laws applicable to the Service and the User.
              </p>
              <p className="mt-2 text-muted-foreground">
                No exclusive governing law or exclusive jurisdiction is designated by these interim beta Terms.
              </p>
              <p className="mt-2 text-muted-foreground">
                Any dispute arising out of or relating to the Service or these Terms will be subject to the
                jurisdiction and mandatory laws applicable to that dispute, including any mandatory
                consumer-protection, privacy, or other statutory rights applicable to the User.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in these Terms prevents a User from exercising any mandatory legal right or remedy
                available under Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                Once SubSentry is formally established through a legal entity and the appropriate contracting
                structure has been determined, these Terms may be amended to designate a specific governing law
                and jurisdiction.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">34. Dispute Resolution</h2>
              <p className="mt-2 text-muted-foreground">
                Before commencing formal proceedings, where permitted by Applicable Law, you agree to give
                SubSentry a reasonable opportunity to investigate and attempt to resolve the dispute.
              </p>
              <p className="mt-2 text-muted-foreground">
                Legal or general support inquiries may be directed to:{" "}
                <a href="mailto:legal@subsentry.app" className="text-foreground underline underline-offset-4">
                  legal@subsentry.app
                </a>
                .
              </p>
              <p className="mt-2 text-muted-foreground">Nothing in this Section prevents you from:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>contacting a regulator;</li>
                <li>contacting a consumer-protection authority;</li>
                <li>contacting a data-protection authority;</li>
                <li>exercising a statutory right; or</li>
                <li>bringing a claim where Applicable Law permits.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">35. Notices</h2>
              <p className="mt-2 text-muted-foreground">
                We may provide notices relating to the Service or these Terms through:
              </p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>email;</li>
                <li>in-Service notifications;</li>
                <li>notices displayed through the Service; or</li>
                <li>other reasonable electronic means.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                You are responsible for maintaining access to the email address associated with your Account.
              </p>
              <p className="mt-2 text-muted-foreground">
                Legal notices may be directed to:{" "}
                <a href="mailto:legal@subsentry.app" className="text-foreground underline underline-offset-4">
                  legal@subsentry.app
                </a>
                .
              </p>
              <p className="mt-2 text-muted-foreground">
                Additional operator and registered-office information will be provided once the business is
                formally established and such information is applicable.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">36. No Waiver</h2>
              <p className="mt-2 text-muted-foreground">
                Failure to enforce a provision of these Terms does not waive our right to enforce that
                provision later.
              </p>
              <p className="mt-2 text-muted-foreground">
                Any waiver must be legally effective and applies only to the specific circumstance for which it
                is given unless expressly stated otherwise.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">37. Severability</h2>
              <p className="mt-2 text-muted-foreground">
                If any provision of these Terms is determined to be unlawful, invalid, or unenforceable, it
                will be enforced to the maximum extent permitted by Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                If it cannot be enforced, it will be modified or severed only to the minimum extent necessary.
              </p>
              <p className="mt-2 text-muted-foreground">The remaining provisions will remain in effect.</p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">38. Assignment</h2>
              <p className="mt-2 text-muted-foreground">
                You may not assign or transfer your rights or obligations under these Terms without prior
                written consent, except where such restriction is prohibited by Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                SubSentry may assign or transfer its rights and obligations in connection with a merger,
                acquisition, restructuring, financing, sale of assets, establishment of a legal entity, or
                transfer of the Service, subject to Applicable Law.
              </p>
              <p className="mt-2 text-muted-foreground">
                Any permitted assignment does not reduce rights or protections that cannot lawfully be reduced.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">39. Entire Agreement</h2>
              <p className="mt-2 text-muted-foreground">
                These Terms, together with the Privacy Policy and any additional terms expressly presented for
                particular features, constitute the agreement governing your use of the Service, except where
                Applicable Law provides otherwise.
              </p>
              <p className="mt-2 text-muted-foreground">
                If additional feature-specific terms conflict with these Terms, those additional terms control
                only with respect to the applicable feature.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">40. No Partnership or Agency</h2>
              <p className="mt-2 text-muted-foreground">Your use of the Service does not create a:</p>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted-foreground">
                <li>partnership;</li>
                <li>joint venture;</li>
                <li>employment relationship;</li>
                <li>fiduciary relationship;</li>
                <li>franchise;</li>
                <li>agency relationship; or</li>
                <li>attorney-client relationship.</li>
              </ul>
              <p className="mt-3 text-muted-foreground">
                Unless expressly stated otherwise, SubSentry does not act as your agent, financial adviser,
                representative, or fiduciary.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">41. No Third-Party Beneficiaries</h2>
              <p className="mt-2 text-muted-foreground">
                Except where expressly stated or required by Applicable Law, these Terms do not create rights
                in any person who is not a party to the agreement.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">42. Interpretation</h2>
              <p className="mt-2 text-muted-foreground">
                Headings are for convenience only and do not affect interpretation.
              </p>
              <p className="mt-2 text-muted-foreground">
                The words &quot;including&quot; and &quot;includes&quot; mean &quot;including without
                limitation&quot; unless Applicable Law requires otherwise.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">43. Contact</h2>
              <p className="mt-2 text-muted-foreground">
                For questions, complaints, legal concerns, or requests relating to these Terms:{" "}
                <a href="mailto:legal@subsentry.app" className="text-foreground underline underline-offset-4">
                  legal@subsentry.app
                </a>
              </p>
              <p className="mt-2 text-muted-foreground">
                For privacy-related requests, please refer to our{" "}
                <Link href="/privacy" className="text-foreground underline underline-offset-4">
                  Privacy Policy
                </Link>{" "}
                and the privacy contact information provided there.
              </p>
            </section>

            <section>
              <h2 className="text-h2 font-semibold">44. Acknowledgment</h2>
              <p className="mt-2 text-muted-foreground">
                By using SubSentry, you acknowledge that you have read and understood these Terms, including
                the beta-service limitations, automated-processing limitations, AI limitations, disclaimers,
                and liability limitations contained in them.
              </p>
              <p className="mt-2 text-muted-foreground">
                Nothing in this acknowledgment waives a right or protection that Applicable Law does not permit
                you to waive.
              </p>
            </section>

            <section>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-h2 font-semibold">Important beta notice</h2>
                <p className="mt-2 text-muted-foreground">SubSentry is an early-stage beta service.</p>
                <p className="mt-2 text-muted-foreground">
                  Information displayed or generated by SubSentry — including subscription information,
                  transaction information, merchant information, renewal dates, calculations, savings
                  estimates, recommendations, automated classifications, and AI-generated output — may contain
                  errors or omissions.
                </p>
                <p className="mt-2 text-muted-foreground">
                  You should independently verify important information against the relevant bank, card
                  issuer, merchant, subscription provider, financial institution, or other authoritative source
                  before relying upon it or taking action.
                </p>
                <p className="mt-2 text-muted-foreground">
                  SubSentry does not guarantee that any displayed subscription, transaction, merchant, renewal
                  date, savings amount, recommendation, cancellation status, or other result is accurate.
                </p>
                <p className="mt-2 text-muted-foreground">
                  SubSentry does not guarantee real-time monitoring of your financial accounts, transactions,
                  subscriptions, or renewals unless expressly stated for a particular feature.
                </p>
                <p className="mt-2 text-muted-foreground">
                  SubSentry is not a substitute for your bank, card issuer, merchant, subscription provider, or
                  other authoritative financial records.
                </p>
                <p className="mt-2 text-muted-foreground">
                  By using SubSentry, you acknowledge these limitations and agree to use the Service
                  accordingly, subject to all rights and protections that cannot lawfully be excluded,
                  restricted, or waived.
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
