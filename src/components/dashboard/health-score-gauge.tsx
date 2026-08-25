"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { HealthScoreResult, HealthRating } from "@/lib/insights-engine";
import { springSmooth } from "@/lib/motion";
import { CountUp } from "@/components/ui/count-up";

// Tier color is deliberately restrained to three meanings, reusing colors
// that already carry that meaning elsewhere in the app rather than
// inventing a fourth ambiguous hue: emerald is reserved for the genuine
// success case (matches how it's used for savings/premium everywhere
// else), destructive matches how overdue renewals are already flagged,
// and the middle ground stays neutral rather than an arbitrary amber.
//
// Derived from `rating`, not a second copy of health-score.ts's own score
// thresholds. This component used to re-derive its own 90/50 cutoffs
// independently, which drifted out of sync the moment health-score.ts's
// bands were recalibrated (Phase 7.2). One source of truth for "what score
// counts as which tier" now lives only in health-score.ts.
function tierColor(rating: HealthRating): { stroke: string; text: string } {
  if (rating === "Excellent" || rating === "Very Good") return { stroke: "stroke-emerald", text: "text-emerald" };
  if (rating === "Needs Attention") return { stroke: "stroke-destructive", text: "text-destructive" };
  return { stroke: "stroke-foreground/70", text: "text-foreground" };
}

export function HealthScoreGauge({
  result,
  size = 112,
}: {
  result: HealthScoreResult;
  size?: number;
}) {
  const prefersReducedMotion = useReducedMotion();
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - result.score / 100);
  const { stroke, text } = tierColor(result.rating);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Health score: ${result.score} out of 100, ${result.rating}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={stroke}
          style={{ strokeDasharray: circumference }}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={prefersReducedMotion ? { duration: 0 } : { ...springSmooth, delay: 0.15 }}
        />
      </svg>
      {/* Both the score and "/100" scale with `size` (instead of a fixed
          text-2xl) and stay visible at every size, including the compact
          52px overview-panel.tsx uses. "/100" scales down as a genuinely
          smaller secondary label rather than being dropped, with a floor
          (8px) below which it'd stop being legible at all. The score stays
          the visual focus throughout: it's always sized well above "/100",
          never just a slightly-bigger sibling. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn("font-mono leading-none font-semibold tabular-nums", text)}
          style={{ fontSize: size * 0.29 }}
        >
          <CountUp value={result.score} format="integer" />
        </span>
        <span className="text-muted-foreground" style={{ fontSize: Math.max(8, size * 0.11), lineHeight: 1 }}>
          /100
        </span>
      </div>
    </div>
  );
}
