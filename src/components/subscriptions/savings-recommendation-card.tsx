"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, CircleHelp, Copy, Layers, Coins, X } from "lucide-react";
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
import { fadeInUp, fadeQuick, liftOnHover, springSnappy } from "@/lib/motion";

const TYPE_ICON = { duplicate: Copy, functional_overlap: Layers, small_subscriptions: Coins } as const;

export function SavingsRecommendationCard({ recommendation }: { recommendation: SavingsRecommendation }) {
  const [dismissed, setDismissed] = useState(false);
  const Icon = TYPE_ICON[recommendation.type];
  const hasSavings = recommendation.monthlySavingsCents > 0;
  const priority = getSavingsPriority(recommendation);

  // Optimistic: the card collapses immediately (see the AnimatePresence
  // exit below), same instant-feedback pattern the rest of this app's
  // status changes already use, not a spinner-then-collapse. The PATCH
  // itself used to not exist at all — "Dismiss" only ever set this
  // component's own local state, so the exact same finding came back on
  // the very next page load with no record it had ever been dismissed
  // (see schema.ts's dismissedSavingsRecommendations comment). If the
  // request actually fails, the card comes back and says so, rather than
  // leaving the user believing a dismiss that silently didn't save.
  async function handleDismiss() {
    setDismissed(true);
    try {
      const res = await fetch("/api/savings/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendationId: recommendation.id }),
      });
      if (!res.ok) {
        setDismissed(false);
        toast.error("Couldn't dismiss that. Try again.");
      }
    } catch {
      setDismissed(false);
      toast.error("Couldn't dismiss that. Try again.");
    }
  }

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          variants={fadeInUp}
          whileHover={liftOnHover}
          exit={{ opacity: 0, height: 0, marginTop: 0, transition: fadeQuick }}
          transition={springSnappy}
          style={{ overflow: "hidden" }}
        >
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
                  {/* Audit fix #7: this used to be a second, redundant
                      colored badge — the priority badge already flags this
                      as "High impact"/etc, so a same-weight pill repeating
                      the dollar figure read as two badges competing for the
                      same glance. Same "money as plain emphasized text, not
                      a badge" convention BiggestOpportunityCard/OverviewPanel
                      already use elsewhere on this dashboard — kept, not
                      dropped, since this is the only place on this row the
                      actual $ figure appears (the description sentence never
                      states it). */}
                  {hasSavings ? (
                    <span className="text-sm font-semibold text-emerald">
                      {formatCents(recommendation.monthlySavingsCents, recommendation.currency)}/mo
                    </span>
                  ) : null}
                  {/* Same plain-text-plus-icon treatment subscription-row.tsx
                      already uses for a secondary qualifier ("Possible
                      duplicate", "High cost") rather than a third colored
                      badge — evidenceTier is already computed (see
                      savings.ts's own comment on getSavingsPriority), just
                      not shown explicitly before now. "Confirmed" only ever
                      applies to a deterministic name match (this card's
                      "duplicate" type); functional_overlap/small_subscriptions
                      are real signal but never provably redundant, which the
                      description's own wording ("look like", "review
                      whether you need") already hedges — this makes that
                      same distinction glanceable without reading the
                      sentence. */}
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {recommendation.evidenceTier === "confirmed" ? (
                      <>
                        <CircleCheck className="size-3" aria-hidden="true" />
                        Confirmed match
                      </>
                    ) : (
                      <>
                        <CircleHelp className="size-3" aria-hidden="true" />
                        Possible match
                      </>
                    )}
                  </span>
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
                  <Button variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={handleDismiss}>
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
