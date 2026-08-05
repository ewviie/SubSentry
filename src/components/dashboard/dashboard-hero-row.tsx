"use client";

import { motion } from "framer-motion";
import { SavingsCard } from "@/components/dashboard/savings-card";
import { HealthScoreCard } from "@/components/dashboard/health-score-card";
import { revealViewport, staggerContainer } from "@/lib/motion";
import type { ComputedInsight } from "@/lib/subscriptions/insights";
import type { HealthScoreResult } from "@/lib/insights-engine";

export function DashboardHeroRow({
  potentialYearlySavingsCents,
  duplicateInsights,
  healthScore,
}: {
  potentialYearlySavingsCents: number;
  duplicateInsights: ComputedInsight[];
  healthScore: HealthScoreResult | null;
}) {
  return (
    <motion.div
      variants={staggerContainer(0.1)}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      className="grid gap-4 lg:grid-cols-[1.3fr_1fr]"
    >
      <SavingsCard
        potentialYearlySavingsCents={potentialYearlySavingsCents}
        duplicateInsights={duplicateInsights}
      />
      {healthScore ? <HealthScoreCard result={healthScore} /> : null}
    </motion.div>
  );
}
