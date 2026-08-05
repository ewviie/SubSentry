"use client";

import { motion } from "framer-motion";
import { fadeInUp, revealViewport, staggerContainer } from "@/lib/motion";

const STEPS = [
  {
    title: "Add what you're paying for",
    description: "Type it in plain English, or fill in the details yourself: name, amount, billing cycle, category.",
  },
  {
    title: "See it laid out clearly",
    description: "Monthly and annual totals, upcoming renewals, and spend broken down by category, updated the moment you add something.",
  },
  {
    title: "Act on what it finds",
    description: "Duplicate services, subscriptions renewing this week, categories eating more than expected: surfaced automatically, not buried in a spreadsheet.",
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="border-y border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <motion.div
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="mx-auto max-w-2xl text-center"
        >
          <h2 className="text-h2 font-semibold">How it works</h2>
        </motion.div>

        <motion.ol
          variants={staggerContainer(0.12)}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="mt-12 grid gap-8 sm:grid-cols-3"
        >
          {STEPS.map((step, i) => {
            const isPayoff = i === STEPS.length - 1;
            return (
            <motion.li key={step.title} variants={fadeInUp} className="relative">
              {/* Emerald is reserved for the payoff step — the moment SubSentry
                  actually surfaces something for you — rather than spent on
                  every number, so it reads as a deliberate beat, not a
                  repeated bullet-point color. */}
              <span
                aria-hidden="true"
                className={
                  isPayoff
                    ? "flex size-9 items-center justify-center rounded-full bg-emerald-muted font-mono text-sm font-semibold text-emerald"
                    : "flex size-9 items-center justify-center rounded-full bg-secondary font-mono text-sm font-semibold text-secondary-foreground"
                }
              >
                {i + 1}
              </span>
              <p className="mt-4 font-heading text-lg font-medium">{step.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{step.description}</p>
            </motion.li>
            );
          })}
        </motion.ol>
      </div>
    </section>
  );
}
