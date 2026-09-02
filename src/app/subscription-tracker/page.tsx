import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CreditCard, MessageSquare, Upload } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { Breadcrumbs } from "@/components/marketing/breadcrumbs";
import { TrustSection } from "@/components/landing/trust-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { LandingFooter } from "@/components/landing/landing-footer";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { absoluteUrl } from "@/lib/seo";

// canonical/openGraph.images resolved via absoluteUrl(), not bare relative
// strings. This page calls getSession() below (to redirect an
// already-logged-in visitor to /dashboard, same as the homepage), which
// makes it dynamically rendered; metadataBase resolution doesn't apply to
// a dynamic route's relative metadata fields. See lib/seo.ts.
export const metadata: Metadata = {
  title: "Subscription Tracker: Track Every Recurring Charge",
  description:
    "A subscription tracker that doesn't need your bank login. Add subscriptions by typing them in plain English, see monthly and annual totals, and catch duplicates, free during the beta.",
  alternates: { canonical: absoluteUrl("/subscription-tracker") ?? "/subscription-tracker" },
  openGraph: {
    title: "Subscription Tracker: Track Every Recurring Charge | SubSentry",
    description: "Track what you're actually paying for, no bank connection required.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
    type: "website",
  },
  // Without its own `twitter` block, this page fell back to the root
  // layout's generic title/description pair (layout.tsx's SITE_TITLE/
  // SITE_DESCRIPTION) on Twitter/X specifically, while openGraph above (Facebook,
  // LinkedIn, Slack, iMessage…) already correctly showed this page's own
  // title/description. Next only inherits fields a page doesn't set
  // itself, it doesn't derive `twitter` from a sibling `openGraph`. Mirrors
  // openGraph's values, same as the homepage's metadata already does.
  twitter: {
    card: "summary",
    title: "Subscription Tracker: Track Every Recurring Charge | SubSentry",
    description: "Track what you're actually paying for, no bank connection required.",
    images: [absoluteUrl("/logo-mark.png") ?? "/logo-mark.png"],
  },
};

// Distinct from "/" on purpose: the homepage pitches the whole product,
// this page answers the specific query "subscription tracker": what one
// is, how this one specifically works, and why it doesn't ask for a bank
// login. Shares real components (TrustSection, FinalCtaSection) rather than
// re-describing the same trust/CTA copy a second time; everything else here
// is unique to this page.
const TRACKING_METHODS = [
  {
    icon: MessageSquare,
    title: "Type it in plain English",
    description: "“Netflix £10.99 monthly” is enough. The AI parser reads the amount, currency, and billing cycle, then you confirm before anything saves.",
  },
  {
    icon: Upload,
    title: "Import a bank CSV or Apple export",
    description: "Upload a CSV exported from your bank, or the data export Apple gives you from Apple ID → Data & Privacy. Nothing is stored beyond what's needed to detect subscriptions.",
  },
  {
    icon: CreditCard,
    title: "Add it by hand",
    description: "A plain form with name, amount, billing cycle, and category. No AI step required if you'd rather not use it.",
  },
];

const FAQS = [
  {
    question: "What is a subscription tracker?",
    answer:
      "A subscription tracker is a tool that keeps a running record of your recurring charges (streaming, software, memberships) so you can see the total cost and catch anything you're paying for but no longer use.",
  },
  {
    question: "Do I have to connect my bank account?",
    answer:
      "No. SubSentry doesn't link to your bank or card by default. You add subscriptions yourself, by typing them, importing a CSV, or entering them by hand, so your account credentials never leave your control.",
  },
  {
    question: "Can I import subscriptions I already have?",
    answer:
      "Yes. Upload a bank statement CSV or an Apple Data & Privacy export and SubSentry detects recurring charges from it, then shows you exactly what it found before adding anything.",
  },
  {
    question: "How does SubSentry calculate monthly vs. annual cost?",
    answer:
      "Every subscription is normalized to a monthly figure regardless of its billing cycle. Yearly, quarterly, and weekly charges are converted using the same math, so totals and comparisons are apples-to-apples.",
  },
  // ASO/SEO pass: distinct phrasing from the homepage's own new "How much
  // can SubSentry actually save me?" FAQ (faq-data.ts) — this page's own
  // angle ("tracking alone often finds it"), not a copy-pasted duplicate of
  // the same question on two pages.
  {
    question: "Will tracking my subscriptions actually save me money?",
    answer:
      "Often, yes, just from the tracking itself: most of what people find are subscriptions they forgot they had, or the same kind of service paid for twice. SubSentry surfaces both automatically, real duplicate matches and subscriptions you haven't looked at in months, each with the dollar amount attached, never a guessed percentage.",
  },
];

export default async function SubscriptionTrackerPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const structuredData = {
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <MarketingNav />
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Subscription Tracker" }]} />
      <main id="main-content">
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-display">
              A subscription tracker that doesn&apos;t need your bank login.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground">
              Type what you&apos;re paying for, import a statement, or add it by hand. SubSentry keeps the
              running total, flags overlaps, and never asks for account credentials to do it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" render={<Link href="/signup" />} nativeButton={false}>
                Start free
              </Button>
              <Button size="lg" variant="outline" render={<Link href="/guides/how-to-find-forgotten-subscriptions" />} nativeButton={false}>
                Find forgotten subscriptions first
              </Button>
            </div>
          </div>

          <div className="mx-auto mt-14 max-w-4xl overflow-hidden rounded-xl border border-border/60 shadow-elevation-medium">
            <Image
              src="/dashboard-screenshot-v2.jpg"
              alt="SubSentry dashboard showing monthly spend of £107.96 across 4 active subscriptions, an 84/100 subscription health score, and the biggest cost-saving opportunity"
              width={1512}
              height={794}
              className="w-full"
              sizes="(min-width: 1024px) 60vw, 100vw"
            />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-h2 font-semibold">What a subscription tracker actually does</h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Subscriptions renew quietly, in small amounts, on different days of the month, which is exactly
            why they&apos;re easy to lose track of. A tracker&apos;s job is narrow but real: hold one list of everything
            recurring, show what it adds up to monthly and per year, and surface the ones worth a second look
            (duplicates, price hikes, things you forgot you signed up for).
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-h2 font-semibold">Three ways to add what you&apos;re paying for</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {TRACKING_METHODS.map((method) => (
              <div key={method.title}>
                <div className="flex size-9 items-center justify-center rounded-full bg-ai-muted text-ai">
                  <method.icon className="size-4" aria-hidden="true" />
                </div>
                <h3 className="mt-3 font-heading text-base font-medium">{method.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{method.description}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-sm text-muted-foreground">
            Not sure what you&apos;re already paying for? Start with our{" "}
            <Link href="/guides/how-to-find-forgotten-subscriptions" className="font-medium text-foreground underline underline-offset-4">
              guide to finding forgotten subscriptions
            </Link>
            , or add up what you find with the{" "}
            <Link href="/subscription-cost-calculator" className="font-medium text-foreground underline underline-offset-4">
              free subscription cost calculator
            </Link>
            , no signup required for either.
          </p>
        </section>

        <TrustSection />

        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 className="text-h2 font-semibold">Questions about tracking subscriptions</h2>
          <Accordion className="mt-8">
            {FAQS.map((faq) => (
              <AccordionItem key={faq.question} value={faq.question}>
                <AccordionTrigger className="text-base">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <FinalCtaSection />
      </main>
      <LandingFooter />
    </>
  );
}
