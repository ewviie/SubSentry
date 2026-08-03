"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PiggyBank, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { fadeInUp, liftOnHover, springSnappy } from "@/lib/motion";
import type { ComputedInsight } from "@/lib/subscriptions/insights";

// The primary hero anchor. Two genuinely different states rather than one
// component forcing a number where there isn't one: when real duplicate
// subscriptions are flagged, the potential yearly savings gets the gold
// "this matters" treatment; when the account is already clean, that's a
// real, positive fact too — showing it instead of hiding an empty state
// keeps the card honest for the common case where there's nothing to save.
export function SavingsCard({
  potentialYearlySavingsCents,
  duplicateInsights,
}: {
  potentialYearlySavingsCents: number;
  duplicateInsights: ComputedInsight[];
}) {
  const hasSavings = potentialYearlySavingsCents > 0;
  const firstDuplicateSubscriptionId = duplicateInsights[0]?.subscriptionIds[1];

  return (
    <motion.div variants={fadeInUp} whileHover={liftOnHover} transition={springSnappy} className="h-full">
      <Card
        className={
          hasSavings
            ? "relative h-full overflow-hidden border-gold/30 shadow-elevation-glow ring-1 ring-gold/20"
            : "h-full shadow-elevation-low"
        }
      >
        <CardContent className="flex h-full flex-col gap-4 pt-6">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className={
                hasSavings
                  ? "flex size-9 items-center justify-center rounded-full bg-gold-muted text-gold"
                  : "flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"
              }
            >
              {hasSavings ? <PiggyBank className="size-4.5" /> : <ShieldCheck className="size-4.5" />}
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {hasSavings ? "Potential yearly savings" : "Duplicate check"}
            </p>
          </div>

          {hasSavings ? (
            <>
              <p className="font-mono text-4xl font-semibold tabular-nums text-gold">
                <CountUp value={potentialYearlySavingsCents} format="currency" />
              </p>
              <p className="text-sm text-muted-foreground">
                {duplicateInsights.length === 1
                  ? "1 likely duplicate is flagged below — canceling it gets you this back."
                  : `${duplicateInsights.length} likely duplicates are flagged below — canceling them gets you this back.`}
              </p>
              {firstDuplicateSubscriptionId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-auto w-fit"
                  render={<Link href={`/subscriptions/${firstDuplicateSubscriptionId}`} />}
                  nativeButton={false}
                >
                  Review the first one
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-2xl font-semibold">No duplicates found</p>
              <p className="text-sm text-muted-foreground">
                Nothing here looks redundant — you&apos;re not paying twice for the same thing.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
