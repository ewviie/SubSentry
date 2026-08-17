"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { HealthScoreGauge } from "@/components/dashboard/health-score-gauge";
import { SentryRing } from "@/components/ui/sentry-ring";
import { fadeInUp, liftOnHover, springSnappy } from "@/lib/motion";
import type { HealthScoreResult } from "@/lib/insights-engine";

// The one place on the dashboard the signature ring motif reappears — this
// is literally "SubSentry watching over your subscriptions," so the ring
// carries real meaning here rather than being decoration repeated for its
// own sake, unlike the rest of the dashboard where it doesn't show up.
export function HealthScoreCard({ result }: { result: HealthScoreResult }) {
  return (
    <motion.div variants={fadeInUp} whileHover={liftOnHover} transition={springSnappy} className="h-full">
      {/* size="sm" + a smaller gauge — matches the compact footprint the
          stat-card row above it already uses (see stat-card.tsx); this
          card previously ran noticeably taller than its neighbors with no
          extra information to show for it. */}
      <Card size="sm" className="h-full shadow-elevation-low">
        {/* sm:flex-row-reverse + sm:flex-1 on the gauge's wrapper: text
            keeps its natural width on the left, and the gauge is centered
            within whatever space is left over to the right of it (not just
            gap-spaced from the text) — the actual gap now flexes with the
            card's width instead of being a fixed value. */}
        <CardContent className="flex h-full flex-col items-center justify-center gap-6 text-center sm:flex-row-reverse sm:items-center sm:justify-start sm:gap-6 sm:text-left">
          <div className="flex items-center justify-center sm:flex-1">
            <div className="relative shrink-0">
              <SentryRing className="-inset-3" />
              <HealthScoreGauge result={result} size={88} />
            </div>
          </div>
          <div className="min-w-0 shrink-0">
            <p className="text-sm font-medium text-muted-foreground">Subscription health</p>
            <p className="mt-0.5 font-heading text-lg font-semibold">{result.rating}</p>
            {/* Honest data-availability caveat, not false precision — see
                health-score.ts's computeConfidence. Only shown when it's
                not "high," same threshold ScoreBreakdownCard's fuller
                explanation uses further down the dashboard. */}
            {result.confidence.level !== "high" ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {result.confidence.level === "medium" ? "Medium" : "Low"} confidence — {result.confidence.reason}
              </p>
            ) : null}
            <ul className="mt-2 space-y-1">
              {result.breakdown.slice(0, 3).map((entry) => (
                <li className="flex items-baseline gap-1.5 text-xs" key={entry.label}>
                  <span
                    className={
                      entry.delta > 0
                        ? "shrink-0 font-mono font-medium text-emerald"
                        : entry.delta < 0
                          ? "shrink-0 font-mono font-medium text-destructive"
                          : "shrink-0 font-mono font-medium text-muted-foreground"
                    }
                  >
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                  </span>
                  <span className="text-muted-foreground">{entry.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
