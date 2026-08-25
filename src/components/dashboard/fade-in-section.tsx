"use client";

import { motion } from "framer-motion";
import { fadeInUp, revealViewport } from "@/lib/motion";

// A self-contained scroll reveal for sections that don't need per-child
// stagger. page.tsx is a Server Component and can't use motion.div
// directly, so this is the shared entry point instead of each section
// growing its own one-off "use client" wrapper.
export function FadeInSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      className={className}
    >
      {children}
    </motion.div>
  );
}
