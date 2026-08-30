"use client";

import { motion } from "framer-motion";
import { staggerContainer } from "@/lib/motion";

// Sibling to FadeInSection for grids whose children should reveal one after
// another instead of fading in as a single block, same "Server Component
// can't use motion.div directly" reason FadeInSection exists. Children (e.g.
// StatCard) opt into the stagger by using `fadeInUp` as their own variants.
//
// Launch-readiness audit finding #7: this used to trigger via
// `whileInView`/`viewport={revealViewport}` — a scroll-intersection
// observer, meant for content a user scrolls down to. Every real usage of
// this component (dashboard/savings/analytics/settings sections, the
// import wizard's source picker) is the page's own primary content,
// already on screen at mount with nothing to scroll past to reach it. An
// IntersectionObserver callback is still inherently async relative to the
// initial paint, so that mismatch was the actual mechanism behind the
// "near-empty content" flash on every navigation. `animate` triggers the
// same variants/stagger/transition on mount instead — no observer
// round-trip, same visual motion.
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
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  );
}
