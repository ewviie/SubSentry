"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { DollarSign, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { CategorySpendBar } from "@/components/dashboard/category-spend-bar";
import { CountUp } from "@/components/ui/count-up";
import { Spotlight } from "@/components/ui/spotlight";
import { SentryRing } from "@/components/ui/sentry-ring";
import { isBetaAllAccess } from "@/lib/billing/plan";
import { fadeInUp, liftOnHover, pressScale, scaleIn, springSmooth, springSnappy, staggerContainer } from "@/lib/motion";

// Representative sample data for the preview panel, not a real account's
// numbers — built from the exact same components the real dashboard uses
// (StatCard, CategorySpendBar), so this is an honest preview of the actual
// product rather than a mocked-up image standing in for it.
const sampleCategoryEntries = [
  { category: "software" as const, monthlyCents: 4899 },
  { category: "streaming" as const, monthlyCents: 3247 },
  { category: "fitness" as const, monthlyCents: 4400 },
];

const headlineWords = "Know exactly what you're paying for.".split(" ");

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Dark-mode-only glow: on the near-white light background this would
          either vanish or read as murky, so light mode stays clean instead
          of forcing an effect that only works on a dark canvas. */}
      <Spotlight className="left-1/2 top-[-12rem] hidden -translate-x-1/2 text-foreground/[0.07] dark:block" />

      <div className="relative z-10 mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-32">
        <motion.div
          variants={staggerContainer(0.09)}
          initial="hidden"
          animate="visible"
        >
          <motion.p
            variants={fadeInUp}
            className="inline-flex items-center gap-1.5 rounded-full bg-ai-muted px-3 py-1 text-xs font-medium text-ai"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI-powered subscription tracking
          </motion.p>

          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-display">
            {headlineWords.map((word, i) => (
              <span key={word} className="inline-block overflow-hidden pb-1 align-bottom">
                <motion.span variants={fadeInUp} className="inline-block">
                  {word}
                  {i < headlineWords.length - 1 ? " " : ""}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p variants={fadeInUp} className="mt-5 max-w-lg text-lg text-muted-foreground">
            Type a subscription in plain English, or add it by hand. SubSentry
            tracks the spend, flags the overlaps and overdue renewals, and
            tells you where your money is actually going, with no bank
            connection required.
          </motion.p>

          <motion.div variants={fadeInUp} className="mt-8 flex flex-wrap items-center gap-3">
            <motion.div whileHover={liftOnHover} whileTap={pressScale} transition={springSnappy} className="inline-block">
              <Button size="lg" render={<Link href="/signup" />} nativeButton={false}>
                Start free
              </Button>
            </motion.div>
            <motion.div whileHover={liftOnHover} whileTap={pressScale} transition={springSnappy} className="inline-block">
              <Button size="lg" variant="outline" render={<a href="#how-it-works" />} nativeButton={false}>
                See how it works
              </Button>
            </motion.div>
          </motion.div>

          <motion.p variants={fadeInUp} className="mt-4 text-sm text-muted-foreground">
            {isBetaAllAccess() ? "Free during the beta. No card required." : "Free to start. No card required."}
          </motion.p>
        </motion.div>

        <motion.div
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          whileHover={{ y: -6 }}
          transition={springSmooth}
          aria-hidden="true"
          className="relative rounded-2xl border border-border bg-card p-3 shadow-elevation-medium ring-1 ring-foreground/5 sm:p-4"
        >
          {/* Large-scale instance of the same signature ring used on the
              brand mark — radiating from behind the live dashboard preview,
              tying "SubSentry is watching your spend" to the actual proof
              rather than to decoration. */}
          <SentryRing className="-inset-16 sm:-inset-24" />
          <div className="flex items-center gap-1.5 px-1 pb-3">
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          </div>
          <div className="space-y-3">
            <StatCard
              icon={DollarSign}
              label="Monthly spend"
              accentClassName="bg-emerald-muted text-emerald"
              caption="Across 7 active subscriptions"
              emphasis
            >
              <CountUp value={12546} format="currency" />
            </StatCard>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-3 text-sm font-medium">Spend by category</p>
              <CategorySpendBar entries={sampleCategoryEntries} />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
