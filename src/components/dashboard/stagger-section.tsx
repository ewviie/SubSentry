"use client";

import { motion } from "framer-motion";
import { revealViewport, staggerContainer } from "@/lib/motion";

// Sibling to FadeInSection for grids whose children should reveal one after
// another instead of fading in as a single block — same "Server Component
// can't use motion.div directly" reason FadeInSection exists. Children (e.g.
// StatCard) opt into the stagger by using `fadeInUp` as their own variants.
export function StaggerSection({
  children,
  className,
  staggerChildren,
}: {
  children: React.ReactNode;
  className?: string;
  staggerChildren?: number;
}) {
  return (
    <motion.div
      variants={staggerContainer(staggerChildren)}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      className={className}
    >
      {children}
    </motion.div>
  );
}
