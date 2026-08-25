"use client";

import { motion } from "framer-motion";
import { fadeInUp, liftOnHover, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Thin client boundary so StatCard (rendered from Server Component pages
// with a raw icon COMPONENT prop, a function reference, which can't cross
// the server/client boundary) can stay a Server Component itself. Only the
// already-rendered `children` element crosses the boundary here, which RSC
// allows.
export function MotionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  // Several of the panels this now wraps (QuickWinsCard, RiskAlertsCard,
  // PositiveHabitsCard, ...) legitimately render null when there's nothing
  // to show for that account. Rendering an empty h-full div in their place
  // would still claim a column in whatever grid this sits inside, visually
  // skewing the other cards' widths for content that isn't actually there.
  if (children === null || children === undefined) return null;
  return (
    <motion.div variants={fadeInUp} whileHover={liftOnHover} transition={springSnappy} className={cn("h-full", className)}>
      {children}
    </motion.div>
  );
}
