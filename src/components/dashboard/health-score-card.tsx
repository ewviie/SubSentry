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
      <Card className="h-full shadow-elevation-low">
        <CardContent className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
          <div className="relative shrink-0">
            <SentryRing className="-inset-3" />
            <HealthScoreGauge result={result} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Subscription health</p>
            <p className="mt-0.5 font-heading text-lg font-semibold">{result.rating}</p>
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
