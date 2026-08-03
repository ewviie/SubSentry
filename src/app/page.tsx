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

export default async function Home() {
  // Same authoritative check used by (auth)/layout.tsx — a logged-in visitor
  // landing on the marketing page gets sent straight to the product instead
  // of a "start free" pitch for something they already have.
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <>
      <ScrollProgress />
      <LandingNav />
      <main id="main-content">
        <HeroSection />
        <TrustSection />
        <FeaturesSection />
        <HowItWorksSection />
        <PricingSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <LandingFooter />
    </>
  );
}
