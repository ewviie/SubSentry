"use client";

import { motion } from "framer-motion";
import { Copy, LayoutDashboard, PieChart, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { fadeInUp, liftOnHover, revealViewport, springSnappy, staggerContainer } from "@/lib/motion";

const FEATURES = [
  {
    icon: Sparkles,
    title: "Add subscriptions by typing them",
    description:
      "“Netflix £10.99 monthly” is enough. The AI parser extracts the amount, currency, and billing cycle, then you confirm before anything is saved.",
    accent: "bg-ai-muted text-ai",
    span: "sm:col-span-2",
  },
  {
    icon: Copy,
    title: "Catch duplicates and overlap",
    description: "Two streaming services covering the same shows? SubSentry flags it before the next renewal.",
    accent: "bg-chart-2/10 text-chart-2",
    span: "",
  },
  {
    icon: PieChart,
    title: "See spend by category",
    description: "Software, streaming, fitness, and more: one glance at where the money actually goes each month.",
    accent: "bg-gold-muted text-gold",
    span: "",
  },
  {
    icon: LayoutDashboard,
    title: "A dashboard that answers one question",
    description: "“What am I paying for right now?” Monthly and annual totals, upcoming renewals, and nothing you don't need.",
    accent: "bg-chart-4/10 text-chart-4",
    span: "sm:col-span-2",
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

      <motion.div
        variants={staggerContainer(0.08)}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
        className="mt-12 grid gap-4 sm:grid-cols-2"
      >
        {FEATURES.map((feature) => (
          <motion.div key={feature.title} variants={fadeInUp} className={feature.span}>
            <motion.div
              whileHover={liftOnHover}
              transition={springSnappy}
              className="h-full"
            >
              <Card className="h-full shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium">
                <CardContent className="flex h-full flex-col gap-3 pt-6">
                  <div className={`flex size-9 items-center justify-center rounded-full ${feature.accent}`}>
                    <feature.icon className="size-4" aria-hidden="true" />
                  </div>
                  <p className="font-heading text-lg font-medium">{feature.title}</p>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
