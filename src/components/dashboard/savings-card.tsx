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
// subscriptions are flagged, the potential yearly savings gets the emerald
// "this matters" treatment; when the account is already clean, that's a
// real, positive fact too — showing it instead of hiding an empty state
// keeps the card honest for the common case where there's nothing to save.
//
// Scope is stated in the label itself, not just implied by the subtext
// below it — this is the single most prominent number on the dashboard,
// and further down the page Optimization score reports a genuinely larger
// total (this figure plus estimated optimizations like switching to annual
// billing — see engine.ts's totalUnrealizedMonthlyCents). Both numbers are
// correct; they answer different questions. Without "from confirmed
// duplicates" on the biggest, first-seen number, a user who reads only
// this card walks away thinking it's the complete picture, then hits a
// bigger, unexplained number scrolling further down. "Confirmed" (not
// "likely") to match the exact wording Savings opportunities and
// Optimization score already use below for this same deterministic,
// non-fuzzy-AI-guessed match — not a new term, reused on purpose.
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
      {/* size="sm" — matches the compact footprint the stat-card row above
          it already uses (see stat-card.tsx); this card previously ran
          noticeably taller than its neighbors with no extra information to
          show for it. Icon circle/glyph sized down to that same row's
          default (non-emphasis) treatment for the same reason. */}
      <Card
        size="sm"
        className={
          hasSavings
            ? "relative h-full overflow-hidden border-emerald/30 shadow-elevation-glow ring-1 ring-emerald/20"
            : "h-full shadow-elevation-low"
        }
      >
        <CardContent className="flex h-full flex-col justify-center gap-3">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className={
                hasSavings
                  ? "flex size-8 items-center justify-center rounded-full bg-emerald-muted text-emerald"
                  : "flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
              }
            >
              {hasSavings ? <PiggyBank className="size-4" /> : <ShieldCheck className="size-4" />}
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {hasSavings ? "Yearly savings from confirmed duplicates" : "Duplicate check"}
            </p>
          </div>

          {hasSavings ? (
            <>
              <p className="font-mono text-4xl font-semibold tabular-nums text-emerald">
                <CountUp value={potentialYearlySavingsCents} format="currency" />
              </p>
              <p className="text-sm text-muted-foreground">
                {duplicateInsights.length === 1
                  ? "1 confirmed duplicate is flagged below. Canceling it gets you this back."
                  : `${duplicateInsights.length} confirmed duplicates are flagged below. Canceling them gets you this back.`}
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
                Nothing here looks redundant. You&apos;re not paying twice for the same thing.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
