import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LandingNav } from "@/components/landing/landing-nav";
import { ScrollProgress } from "@/components/landing/scroll-progress";
import { HeroSection } from "@/components/landing/hero-section";
import { TrustSection } from "@/components/landing/trust-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FaqSection } from "@/components/landing/faq-section";
import { FAQS } from "@/components/landing/faq-data";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { isBetaAllAccess } from "@/lib/billing/plan";
import { absoluteUrl } from "@/lib/seo";

// Previously unset — this page inherited the root layout's bare
// "SubSentry" / "AI-powered subscription management" fallback verbatim,
// the exact "generic title on the most important page" gap a crawler (and
// a search-results snippet) sees first. Distinct on purpose from
// /subscription-tracker's own title ("Subscription Tracker — Track Every
// Recurring Charge") and the guide's ("How to Find Forgotten
// Subscriptions...") — this is the brand entry point pitching the whole
// product, not a second page competing for either of those two pages' own
// primary keyword. Copy pulled directly from the real, visible hero
// copy (hero-section.tsx) rather than written separately for search
// engines — nothing here promises something the page above it doesn't
// already say.
//
// canonical/openGraph/twitter images are resolved to absolute URLs
// explicitly via absoluteUrl(), not left as bare relative strings for the
// root layout's metadataBase to resolve — verified empirically that
// Next's own metadataBase resolution doesn't apply on this page (it's
// dynamically rendered, see getSession() below; every statically-rendered
// page in this app resolves fine, this one and every other dynamic one
// doesn't). See lib/seo.ts's own comment for the full story.
//
// title is `{ absolute }`, not a plain string — root layout.tsx's
// title.template ("%s | SubSentry") never applies to app/page.tsx in the
// first place: it's a documented Next.js limitation (title.template only
// applies to a *child* segment's title, and the homepage is the same
// terminating segment the template is declared alongside, not a child of
// it — see vercel/next.js issues #46859 and #60666). A plain string title
// here would just render with no " | SubSentry" suffix at all; `absolute`
// says explicitly "this is the whole title, don't try to template it,"
// and puts the brand name first the way a homepage's own title
// conventionally does (every other page's title puts it last, via the
// template, once it reaches a descendant segment where the template does
// apply).
export const metadata: Metadata = {
  title: { absolute: "SubSentry — AI Subscription Tracker & Spend Manager" },
  description:
    "Type a subscription in plain English or add it by hand. SubSentry tracks the spend, flags overlaps and overdue renewals, and shows what you're really paying for — no bank connection required.",
  alternates: { canonical: absoluteUrl("/") ?? "/" },
  openGraph: {
    title: "SubSentry — AI Subscription Tracker & Spend Manager",
    description: "Know exactly what you're paying for, with no bank connection required.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "SubSentry — AI Subscription Tracker & Spend Manager",
    description: "Know exactly what you're paying for, with no bank connection required.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
  },
};

export default async function Home() {
  // Same authoritative check used by (auth)/layout.tsx — a logged-in visitor
  // landing on the marketing page gets sent straight to the product instead
  // of a "start free" pitch for something they already have.
  const session = await getSession();
  if (session) redirect("/dashboard");

  // Pricing stays fully built (see pricing-section.tsx) — just not rendered
  // during the free beta. Flip isBetaAllAccess() off in lib/billing/plan.ts
  // and this section reappears with no other change needed.
  const showPricing = !isBetaAllAccess();

  // Deliberately minimal — name/description/category only. No
  // aggregateRating, no review count, no offers/price block: this app has
  // no real reviews to cite and pricing is hidden during the beta (see
  // showPricing above), so none of those fields have real data to back
  // them. Fabricating any of that to make the rich-result snippet look
  // more complete would violate this app's own "never fabricate a number"
  // principle applied to itself.
  // Same NEXT_PUBLIC_APP_URL gate as metadataBase/sitemap.ts/robots.ts — an
  // absolute `url` field pointing at localhost would be worse than omitting
  // it, so it's only added once a real domain exists to put there.
  const homeUrl = absoluteUrl("/");
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SubSentry",
    description: "AI-powered subscription management — track what you're actually paying for.",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    ...(homeUrl ? { url: homeUrl } : {}),
  };

  // Built from the exact FAQS array faq-section.tsx renders into the visible
  // accordion — never authored separately, so this can't drift into
  // structured data that promises answers the page doesn't actually show.
  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <>
      {/* JSON-LD, not a visible element — safe to inline directly since
          these are fixed, server-constructed objects with no user input,
          not a place a CSP nonce is needed the way a real <script> would
          otherwise require. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }} />
      <ScrollProgress />
      <LandingNav />
      <main id="main-content">
        <HeroSection />
        <TrustSection />
        <FeaturesSection />
        <HowItWorksSection />
        {showPricing ? <PricingSection /> : null}
        <FaqSection />
        <FinalCtaSection />
      </main>
      <LandingFooter />
    </>
  );
}
