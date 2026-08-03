"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FREE_PLAN_SUBSCRIPTION_LIMIT } from "@/lib/billing/plan";
import { fadeInUp, liftOnHover, revealViewport, springSnappy, staggerContainer } from "@/lib/motion";

const TIERS = [
  {
    name: "Free",
    price: "Free",
    cadence: "",
    description: `Track up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions.`,
    features: [
      `Up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions`,
      "AI quick-add (demo or live)",
      "Deterministic spend insights",
      "Dashboard + category breakdown",
    ],
    cta: "Start free",
    popular: false,
  },
  {
    name: "Pro",
    price: "£4.99",
    cadence: "/mo",
    description: "Unlimited subscriptions, same clarity.",
    features: [
      "Unlimited active subscriptions",
      "Everything in Free",
      "Priority support",
    ],
    cta: "Upgrade to Pro",
    popular: true,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <motion.div
        variants={fadeInUp}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
        className="mx-auto max-w-2xl text-center"
      >
        <h2 className="text-h2 font-semibold">Simple, honest pricing</h2>
        <p className="mt-3 text-lg text-muted-foreground">
          Start free. Upgrade only if you actually need it.
        </p>
      </motion.div>

      <motion.div
        variants={staggerContainer(0.1)}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
        className="mx-auto mt-12 grid max-w-2xl gap-6 sm:grid-cols-2"
      >
        {TIERS.map((tier) => (
          <motion.div
            key={tier.name}
            variants={fadeInUp}
            whileHover={liftOnHover}
            transition={springSnappy}
            className="flex flex-col"
          >
            {/* Reserved badge row, rendered (empty) for every tier so card
                tops stay aligned in the grid regardless of which tier is
                "popular" — the badge lives in normal flow here rather than
                floating via absolute positioning over the card, so it can
                never collide with card content or get clipped by the
                card's own overflow-hidden corner mask at any zoom level. */}
            <div className="mb-3 flex h-5 items-center justify-center">
              {tier.popular ? (
                <Badge className="bg-gold text-gold-foreground">Most popular</Badge>
              ) : null}
            </div>
            <Card
              className={
                tier.popular
                  ? "border-gold/40 shadow-elevation-glow ring-1 ring-gold/30 transition-shadow duration-200"
                  : "shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium"
              }
            >
              <CardHeader>
                <p className="font-heading text-lg font-medium">{tier.name}</p>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
                <p className="mt-2">
                  <span className="font-mono text-3xl font-semibold tabular-nums">{tier.price}</span>
                  {tier.cadence ? (
                    <span className="text-sm text-muted-foreground">{tier.cadence}</span>
                  ) : null}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={tier.popular ? "default" : "outline"}
                  render={<Link href="/signup" />}
                  nativeButton={false}
                >
                  {tier.cta}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
