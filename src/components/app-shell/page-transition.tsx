"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

// Opacity-only, no y-shift: a translate on route change would visually
// compete with each page's own entrance animations (FadeInSection,
// StaggerSection) and risks a layout-shift-like jank between differently
// sized pages. This is purely "the old page is gone, the new one is here,"
// fast enough to read as instant, not as a loading transition.
//
// mode="wait" is the part that actually delivers that: AnimatePresence
// defaults to mode="sync", which runs the exiting and entering pages'
// animations at the same time while BOTH are still mounted in normal
// document flow (neither is positioned absolutely). Between pages as
// differently sized as Dashboard and Analytics or Subscriptions, that meant
// a real, visible jump: the incoming page's height added onto the outgoing
// one's for the ~120ms both existed at once, not just a soft crossfade.
// "wait" fully removes the old page before the new one mounts, so there's
// never a moment where two pages' worth of layout exist together.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait" initial={false}>
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
