"use client";

import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { HealthScoreGauge } from "@/components/dashboard/health-score-gauge";
import { SentryRing } from "@/components/ui/sentry-ring";
import { fadeInUp, liftOnHover, springSnappy } from "@/lib/motion";
import type { HealthScoreResult } from "@/lib/subscriptions/insights";

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
            <p className="mt-0.5 font-heading text-lg font-semibold">{result.label}</p>
            <ul className="mt-2 space-y-1">
              {result.factors.map((factor) => (
                <li className="flex items-center gap-1.5 text-xs text-muted-foreground" key={factor.label}>
                  {factor.passed ? (
                    <Check className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
                  ) : (
                    <X className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                  )}
                  <span className={factor.passed ? "" : "text-foreground"}>{factor.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
