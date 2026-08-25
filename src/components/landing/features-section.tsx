"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeInUp, revealViewport, staggerContainer } from "@/lib/motion";

// Replaces the old icon-card grid: an icon and a sentence don't prove a
// product exists or works. A real screenshot does. This is an actual
// dashboard render: a real test account with real subscriptions entered,
// screenshotted directly from the running app (see the commit that added
// this file for exactly how), not a mockup, not a Figma comp. Every
// number in it (the $146.97, the 83/100 health score, the insight text)
// is the app's own deterministic engine computing real input, the same
// "never fabricate a number" rule the product itself follows applied to
// its own marketing.
const POINTS = [
  {
    title: "Add subscriptions by typing them",
    description:
      "“Netflix £10.99 monthly” is enough. The AI parser extracts the amount, currency, and billing cycle, then you confirm before anything is saved.",
  },
  {
    title: "Catch duplicates and overlap",
    description: "Two streaming services covering the same shows? SubSentry flags it before the next renewal.",
  },
  {
    title: "See spend by category",
    description: "Software, streaming, fitness, and more: one glance at where the money actually goes each month.",
  },
  {
    title: "A dashboard that answers one question",
    description: "“What am I paying for right now?” Monthly and annual totals, upcoming renewals, and nothing you don't need.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <motion.div
        variants={fadeInUp}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
        className="mx-auto max-w-2xl text-center"
      >
        <h2 className="text-h2 font-semibold">Built to answer one question</h2>
        <p className="mt-3 text-lg text-muted-foreground">
          Not a budgeting app. Not a bank aggregator. Just a clear answer to
          what you&apos;re actually paying for.
        </p>
      </motion.div>

      <div className="mt-12 grid items-center gap-10 lg:grid-cols-5 lg:gap-12">
        <motion.div
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="lg:col-span-3"
        >
          <div className="overflow-hidden rounded-xl border border-border/60 shadow-elevation-medium">
            <Image
              src="/dashboard-screenshot.jpg"
              alt="SubSentry dashboard showing monthly spend of $146.97 across 6 active subscriptions, an 83/100 subscription health score, and real cost-saving insights"
              width={1456}
              height={821}
              className="w-full"
              sizes="(min-width: 1024px) 60vw, 100vw"
            />
          </div>
        </motion.div>

        <motion.div
          variants={staggerContainer(0.08)}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="space-y-6 lg:col-span-2"
        >
          {POINTS.map((point) => (
            <motion.div key={point.title} variants={fadeInUp}>
              {/* Was a <p>: visually a sub-point already, but semantically
                  invisible as a heading, leaving this H2's section with no
                  H3s under it at all. Tailwind Preflight zeroes default
                  heading margins, so this is a pure semantics fix: pixel-
                  identical, real heading hierarchy for once. */}
              <h3 className="font-heading text-base font-medium">{point.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{point.description}</p>
            </motion.div>
          ))}
          {/* The one homepage → SEO-page link: contextual, not a nav item,
              for the reader who wants more depth on tracking specifically
              before signing up. */}
          <motion.div variants={fadeInUp}>
            <Link href="/subscription-tracker" className="text-sm font-medium text-foreground underline underline-offset-4">
              More on how subscription tracking works →
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
