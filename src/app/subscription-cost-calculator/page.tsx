import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { LandingFooter } from "@/components/landing/landing-footer";
import { CostCalculator } from "@/components/subscription-cost-calculator/calculator";
import { absoluteUrl } from "@/lib/seo";

// canonical/openGraph.images resolved via absoluteUrl() — see
// subscription-tracker/page.tsx's identical comment.
//
// force-dynamic — required for a correct per-request CSP nonce on this
// page's scripts. See terms/page.tsx's identical export for the full
// explanation. This page in particular has a genuinely interactive
// client component (CostCalculator below) that silently never hydrated
// under static rendering — every script on the page was blocked by CSP,
// not just next-themes'; the calculator looked normal but typing into it
// did nothing, confirmed against a real production build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subscription Cost Calculator — See Your Real Monthly & Yearly Total",
  description:
    "Add your subscriptions and see the real monthly and yearly total instantly. Free, no signup, nothing saved — runs entirely in your browser.",
  alternates: { canonical: absoluteUrl("/subscription-cost-calculator") ?? "/subscription-cost-calculator" },
  openGraph: {
    title: "Subscription Cost Calculator | SubSentry",
    description: "See your real monthly and yearly subscription total. Free, no signup, nothing saved.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
    type: "website",
  },
  // See subscription-tracker/page.tsx's identical comment — without this,
  // Twitter/X specifically fell back to the root layout's generic title/
  // description instead of this page's own, while openGraph already had it
  // right.
  twitter: {
    card: "summary",
    title: "Subscription Cost Calculator | SubSentry",
    description: "See your real monthly and yearly subscription total. Free, no signup, nothing saved.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
  },
};

export default function SubscriptionCostCalculatorPage() {
  return (
    <>
      <MarketingNav />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Cost Calculator" }]} />
      <main id="main-content">
        <section className="mx-auto max-w-2xl px-4 pb-4 pt-4 text-center sm:px-6">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-display">
            What are your subscriptions really costing you?
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Add each one below. Nothing is saved or sent anywhere — this runs entirely in your browser, no
            account required.
          </p>
        </section>

        <section className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
          <CostCalculator />
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
