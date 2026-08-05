"use client";

import { motion } from "framer-motion";
import { EyeOff, Lock, ShieldCheck } from "lucide-react";
import { fadeInUp, revealViewport, staggerContainer } from "@/lib/motion";

const SIGNALS = [
  {
    icon: Lock,
    title: "Passwords hashed with Argon2id",
    description: "The password-hashing algorithm recommended for new systems. Never stored or logged in readable form.",
  },
  {
    icon: EyeOff,
    title: "Sessions never stored in readable form",
    description: "Your browser holds an opaque token; only its one-way hash ever touches the database.",
  },
  {
    icon: ShieldCheck,
    title: "We never sell your data",
    description: "No advertising trackers, no analytics resale, no exceptions.",
  },
];

export function TrustSection() {
  return (
    <section aria-labelledby="trust-heading" className="border-y border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        {/* Visually-hidden — the 3 signal cards below are self-explanatory
            at a glance, but a screen-reader's heading outline otherwise
            skips straight from the hero's h1 to Features' h2 with this
            whole section unlabeled. */}
        <h2 id="trust-heading" className="sr-only">
          Why you can trust SubSentry
        </h2>
        <motion.div
          variants={staggerContainer(0.1)}
          initial="hidden"
          whileInView="visible"
          viewport={revealViewport}
          className="grid gap-8 sm:grid-cols-3"
        >
          {SIGNALS.map((signal) => (
            <motion.div key={signal.title} variants={fadeInUp} className="flex flex-col items-start gap-2">
              <div className="flex size-9 items-center justify-center rounded-full bg-background text-foreground ring-1 ring-border">
                <signal.icon className="size-4" aria-hidden="true" />
              </div>
              <p className="text-sm font-medium">{signal.title}</p>
              <p className="text-sm text-muted-foreground">{signal.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
