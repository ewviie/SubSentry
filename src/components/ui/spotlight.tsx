"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Adapted from the Aceternity UI "Spotlight" pattern (21st.dev, @manuarora700):
// same ellipse/blur geometry, but recolored to pull from our design tokens
// via `currentColor` (set a `text-*` utility on the consumer) instead of a
// hardcoded fill, and animated through Framer Motion so it automatically
// respects the app's global `reducedMotion="user"` setting rather than a
// raw CSS keyframe that would bypass it.
export function Spotlight({ className }: { className?: string }) {
  return (
    <motion.svg
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.2, ease: "easeOut" }}
      className={cn("pointer-events-none absolute z-0 h-[169%] w-[138%] lg:w-[84%]", className)}
      viewBox="0 0 3787 2842"
      fill="none"
      aria-hidden="true"
    >
      <g filter="url(#spotlight-blur)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill="currentColor"
        />
      </g>
      <defs>
        <filter
          id="spotlight-blur"
          x="0.860352"
          y="0.838989"
          width="3785.16"
          height="2840.26"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur" />
        </filter>
      </defs>
    </motion.svg>
  );
}
