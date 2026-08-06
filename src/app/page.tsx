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
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { isBetaAllAccess } from "@/lib/billing/plan";

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
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "SubSentry",
    description: "AI-powered subscription management — track what you're actually paying for.",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
  };

  return (
    <>
      {/* JSON-LD, not a visible element — safe to inline directly since
          this is a fixed, server-constructed object with no user input,
          not a place a CSP nonce is needed the way a real <script> would
          otherwise require. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
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
