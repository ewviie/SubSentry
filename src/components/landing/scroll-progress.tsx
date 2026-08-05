"use client";

import { motion, useScroll, useSpring } from "framer-motion";

// A thin, scroll-linked indicator of how far down the page you are. Bound
// directly to the user's own scroll input (not an autoplaying animation),
// so it stays legible and low-key under reduced-motion rather than needing
// to be suppressed by it.
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 300, damping: 40, restDelta: 0.001 });

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-emerald"
    />
  );
}
