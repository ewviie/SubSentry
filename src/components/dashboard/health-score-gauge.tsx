"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { HealthScoreResult } from "@/lib/insights-engine";
import { springSmooth } from "@/lib/motion";
import { CountUp } from "@/components/ui/count-up";

// Tier color is deliberately restrained to three meanings, reusing colors
// that already carry that meaning elsewhere in the app rather than
// inventing a fourth ambiguous hue: emerald is reserved for the genuine
// success case (matches how it's used for savings/premium everywhere
// else), destructive matches how overdue renewals are already flagged,
// and the middle ground stays neutral rather than an arbitrary amber.
function tierColor(score: number): { stroke: string; text: string } {
  if (score >= 90) return { stroke: "stroke-emerald", text: "text-emerald" };
  if (score >= 50) return { stroke: "stroke-foreground/70", text: "text-foreground" };
  return { stroke: "stroke-destructive", text: "text-destructive" };
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
  const { stroke, text } = tierColor(result.score);

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
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-mono text-2xl font-semibold tabular-nums", text)}>
          <CountUp value={result.score} format="integer" />
        </span>
        <span className="text-[0.65rem] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}
