"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Layers, Coins, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/subscriptions/money";
import {
  getSavingsPriority,
  PRIORITY_LABEL,
  PRIORITY_BADGE_VARIANT,
  type SavingsRecommendation,
} from "@/lib/subscriptions/savings";
import { fadeQuick } from "@/lib/motion";

const TYPE_ICON = { duplicate: Copy, functional_overlap: Layers, small_subscriptions: Coins } as const;

export function SavingsRecommendationCard({ recommendation }: { recommendation: SavingsRecommendation }) {
  const [dismissed, setDismissed] = useState(false);
  const Icon = TYPE_ICON[recommendation.type];
  const hasSavings = recommendation.monthlySavingsCents > 0;
  const priority = getSavingsPriority(recommendation);

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div exit={{ opacity: 0, height: 0, marginTop: 0 }} transition={fadeQuick} style={{ overflow: "hidden" }}>
          <Card className={hasSavings ? "border-emerald/30 shadow-elevation-low ring-1 ring-emerald/10" : "shadow-elevation-low"}>
            <CardContent className="flex items-start gap-4">
              <div
                className={
                  hasSavings
                    ? "flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-muted text-emerald"
                    : "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                }
              >
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{recommendation.title}</p>
                  <Badge variant={PRIORITY_BADGE_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>
                  {hasSavings ? (
                    <Badge className="bg-emerald text-emerald-foreground">
                      {formatCents(recommendation.monthlySavingsCents)}/mo
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">{recommendation.description}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    render={<Link href={`/subscriptions/${recommendation.targetSubscriptionId}`} />}
                    nativeButton={false}
                  >
                    {recommendation.actionLabel}
                  </Button>
                  <Button variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={() => setDismissed(true)}>
                    <X className="size-3.5" aria-hidden="true" />
                    Dismiss
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
