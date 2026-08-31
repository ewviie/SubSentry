"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, isBetaAllAccess } from "@/lib/billing/plan";
import { PRO_MONTHLY_PRICE, PRO_FEATURES } from "@/lib/billing/pro-features";
import { fadeInUp, liftOnHover, revealViewport, springSnappy, staggerContainer } from "@/lib/motion";

// The one, permanent pricing component — not a beta-only stand-in. Both
// tiers render unconditionally, always side by side: there is never a state
// where a visitor sees only one card. isBetaAllAccess() only ever changes
// the Pro card's price framing and CTA copy below, never which cards exist
// or what either one lists. When the beta ends, this same component reverts
// to plain paid messaging with no structural change required anywhere else.
const TIERS = [
  {
    name: "SubSentry Free",
    price: "£0",
    cadence: "/month",
    description: "Everything you need to see what you're actually paying for.",
    features: [
      `Up to ${FREE_PLAN_SUBSCRIPTION_LIMIT} active subscriptions`,
      "AI quick-add — 5/day",
      "Spend insights and category breakdown",
      "Dashboard with monthly and annual costs",
      "Every confirmed duplicate",
    ],
    cta: "Start free",
    popular: false,
  },
  {
    name: "SubSentry Pro",
    price: PRO_MONTHLY_PRICE,
    cadence: "/month",
    description: "Everything. One subscription.",
    // PRO_FEATURES (lib/billing/pro-features.ts) is the same shared list
    // Settings and this list both read from — no separate copy to drift.
    features: PRO_FEATURES,
    cta: "Upgrade to Pro",
    popular: true,
  },
];

export function PricingSection() {
  const beta = isBetaAllAccess();

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <motion.div
        variants={fadeInUp}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
        className="mx-auto max-w-2xl text-center"
      >
        <h2 className="text-h2 font-semibold">Know what you&apos;re paying for. Then do something about it.</h2>
        <p className="mt-3 text-lg text-muted-foreground">Free gives you the essentials. Pro finds the opportunities hiding underneath.</p>
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
                "popular". The badge lives in normal flow here rather than
                floating via absolute positioning over the card, so it can
                never collide with card content or get clipped by the
                card's own overflow-hidden corner mask at any zoom level. */}
            <div className="mb-3 flex h-5 items-center justify-center">
              {tier.popular ? (
                <Badge className="bg-emerald text-emerald-foreground uppercase tracking-wide">Most popular</Badge>
              ) : null}
            </div>
            <Card
              className={
                tier.popular
                  ? "flex grow flex-col border-emerald/40 shadow-elevation-glow ring-1 ring-emerald/30 transition-shadow duration-200"
                  : "flex grow flex-col shadow-elevation-low transition-shadow duration-200 hover:shadow-elevation-medium"
              }
            >
              <CardHeader>
                <p className="font-heading text-lg font-medium">{tier.name}</p>
                <p className="text-sm text-muted-foreground">{tier.description}</p>
                <p className="mt-2">
                  <span className="font-mono text-3xl font-semibold tabular-nums">{tier.price}</span>
                  <span className="text-sm text-muted-foreground">{tier.cadence}</span>
                </p>
              </CardHeader>
              <CardContent className="flex grow flex-col space-y-4">
                <ul className="space-y-2 text-sm">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* Grows to push the CTA block to the same baseline in both
                    cards regardless of feature-list length. */}
                <div className="grow" />

                {/* Beta pricing psychology, Pro card only: the real price
                    stays visible and honest (£4.99/month, never hidden or
                    replaced), with "free during beta" as the qualifier
                    underneath it — the same hierarchy a premium SaaS uses
                    for an introductory offer, not a discount, countdown, or
                    scarcity claim. No card is ever taken because none is
                    ever required during the beta. Once isBetaAllAccess()
                    goes false, this whole block disappears and the tier's
                    plain `cta` below takes over with zero other changes. */}
                {tier.popular && beta ? (
                  <div className="space-y-1 border-t border-border pt-4">
                    <p className="text-sm font-medium text-emerald">Free during beta</p>
                    <p className="text-xs text-muted-foreground">
                      £0 today · {tier.price}
                      {tier.cadence} after beta
                    </p>
                    <p className="text-xs text-muted-foreground">No card required.</p>
                    <Button className="mt-3 w-full" render={<Link href="/signup" />} nativeButton={false}>
                      Get Pro — Free During Beta
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="w-full"
                    variant={tier.popular ? "default" : "outline"}
                    render={<Link href="/signup" />}
                    nativeButton={false}
                  >
                    {tier.cta}
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
