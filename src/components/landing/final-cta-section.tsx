"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { SentryRing } from "@/components/ui/sentry-ring";
import { FREE_PLAN_SUBSCRIPTION_LIMIT } from "@/lib/billing/plan";
import { fadeInUp, liftOnHover, pressScale, revealViewport, springSnappy, staggerContainer } from "@/lib/motion";

export function FinalCtaSection() {
  return (
    <section className="border-t border-border/60">
      <motion.div
        variants={staggerContainer(0.08)}
        initial="hidden"
        whileInView="visible"
        viewport={revealViewport}
        className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-20 text-center sm:px-6 sm:py-28"
      >
        <motion.span
          variants={fadeInUp}
          aria-hidden="true"
          className="relative flex size-12 items-center justify-center"
        >
          <SentryRing />
          <Image src="/logo-mark.png" alt="" width={48} height={48} className="size-full rounded-full object-cover" />
        </motion.span>
        <motion.h2 variants={fadeInUp} className="max-w-lg text-balance text-h2 font-semibold">
          Start tracking what you&apos;re actually paying for.
        </motion.h2>
        <motion.p variants={fadeInUp} className="max-w-md text-muted-foreground">
          Free for up to {FREE_PLAN_SUBSCRIPTION_LIMIT} subscriptions. No card required to start.
        </motion.p>
        <motion.div variants={fadeInUp} whileHover={liftOnHover} whileTap={pressScale} transition={springSnappy}>
          <Button size="lg" render={<Link href="/signup" />} nativeButton={false}>
            Start free
          </Button>
        </motion.div>
      </motion.div>
    </section>
  );
}
