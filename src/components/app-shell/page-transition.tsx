"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

// Opacity-only, no y-shift: a translate on route change would visually
// compete with each page's own entrance animations (FadeInSection,
// StaggerSection) and risks a layout-shift-like jank between differently
// sized pages. This is purely "the old page is gone, the new one is here"
// — fast enough to read as instant, not as a loading transition.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12, ease: "easeInOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
