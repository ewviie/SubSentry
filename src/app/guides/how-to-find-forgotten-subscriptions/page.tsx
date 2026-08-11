import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { LandingFooter } from "@/components/landing/landing-footer";
import { Button } from "@/components/ui/button";
import { absoluteUrl } from "@/lib/seo";

// canonical/openGraph.images resolved via absoluteUrl() — see
// subscription-tracker/page.tsx's identical comment.
//
// force-dynamic — required for a correct per-request CSP nonce on this
// page's scripts. See terms/page.tsx's identical export for the full
// explanation (statically-cached HTML can't carry a matching nonce for
// any individual visitor's own fresh header nonce, so the browser
// silently blocks every script and the page never hydrates). This page
// used to render statically (no session check of its own); force-dynamic
// overrides that now that static rendering has been shown to break it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How to Find Forgotten Subscriptions (Without a Bank-Linked App)",
  description:
    "A practical, step-by-step way to find every recurring charge you're paying for — bank statements, email receipts, and app-store purchase history — plus how to decide what to cancel.",
  alternates: { canonical: absoluteUrl("/guides/how-to-find-forgotten-subscriptions") ?? "/guides/how-to-find-forgotten-subscriptions" },
  openGraph: {
    title: "How to Find Forgotten Subscriptions | SubSentry",
    description: "A practical, step-by-step method — no bank-linked app required.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
    type: "article",
  },
  // See subscription-tracker/page.tsx's identical comment — without this,
  // Twitter/X specifically fell back to the root layout's generic title/
  // description instead of this page's own, while openGraph already had it
  // right.
  twitter: {
    card: "summary",
    title: "How to Find Forgotten Subscriptions | SubSentry",
    description: "A practical, step-by-step method — no bank-linked app required.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
  },
};

// Genuinely useful without ever signing up — the brief's own instruction.
// The SubSentry mention is one paragraph near the end, not a rewrite of the
// method into a pitch. Real Article schema since this really is one: a
// dated, authored explainer, not a product page dressed up as an article.
const PUBLISHED = "2026-08-07";

const STEPS = [
  {
    title: "1. Read your last 2–3 bank and card statements line by line",
    body: "Recurring charges are usually small and easy to skim past — $4.99, $12.99, $19.99 — and they often show up under a payment processor's name rather than the service's ('PADDLE.NET*', 'APPLE.COM/BILL'), which is exactly why they go unnoticed. Highlight anything that repeats month to month, even if the exact amount shifts slightly (usage-based tiers, currency conversion).",
  },
  {
    title: "2. Search your email for \"receipt\", \"renewal\", and \"your subscription\"",
    body: "Most services email a receipt on every renewal. Searching your inbox for those words (and \"invoice\", \"payment confirmation\") surfaces charges that don't clearly identify themselves on a bank statement — a free trial that converted to paid is a common one to catch this way.",
  },
  {
    title: "3. Check Apple and Google's own subscription lists",
    body: "iPhone: Settings → your name → Subscriptions. Android: Google Play → Payments & subscriptions → Subscriptions. This catches app-based subscriptions that never touch your bank statement directly because they're billed through the app store instead.",
  },
  {
    title: "4. List everything you find in one place, with its billing cycle",
    body: "A charge's sticker price is misleading on its own — $89.99/year and $8.99/month look different but cost almost the same. Converting everything to a monthly figure (or use a calculator that does it for you) is what makes the total spend, and any single overpriced outlier, actually visible.",
  },
  {
    title: "5. For each one, decide: keep, downgrade, or cancel",
    body: "A charge earns its place by being used, not by being forgotten about. If you can't remember the last time you opened it, that's usually the answer. For the ones you keep, note the renewal date somewhere you'll actually see it before it bills again.",
  },
];

export default function ForgottenSubscriptionsGuidePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "How to Find Forgotten Subscriptions",
    description: metadata.description,
    datePublished: PUBLISHED,
    dateModified: PUBLISHED,
    author: { "@type": "Organization", name: "SubSentry" },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <MarketingNav />
      {/* No "Guides" middle crumb — there's no guides index page yet, and a
          breadcrumb pointing somewhere that isn't actually a guides hub
          would be the exact "misleading structured data" this pass was
          told to avoid. Two levels, both real. */}
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Find Forgotten Subscriptions" }]} />
      <main id="main-content">
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-display">
            How to find forgotten subscriptions
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            You don&apos;t need to link a bank account to find every recurring charge you&apos;re paying for.
            This is the manual method — five steps, no app required — plus where an app actually saves you
            time afterward.
          </p>

          <div className="mt-10 space-y-8">
            {STEPS.map((step) => (
              <section key={step.title}>
                <h2 className="text-h2 font-semibold">{step.title}</h2>
                <p className="mt-2 text-muted-foreground">{step.body}</p>
              </section>
            ))}
          </div>

          <section className="mt-12 rounded-xl border border-border bg-card p-6">
            <h2 className="font-heading text-lg font-semibold">Once you&apos;ve found them</h2>
            <p className="mt-2 text-muted-foreground">
              The hard part usually isn&apos;t finding them once — it&apos;s remembering to check again next
              month. SubSentry keeps the list you just built, adds up the monthly and annual totals
              automatically, and flags likely duplicates the next time you add something. You can also just{" "}
              <Link href="/subscription-cost-calculator" className="font-medium text-foreground underline underline-offset-4">
                total up what you found
              </Link>{" "}
              without signing up for anything.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button render={<Link href="/signup" />} nativeButton={false}>
                Start tracking for free
              </Button>
              <Button variant="outline" render={<Link href="/subscription-tracker" />} nativeButton={false}>
                See how the tracker works
              </Button>
            </div>
          </section>
        </article>
      </main>
      <LandingFooter />
    </>
  );
}
