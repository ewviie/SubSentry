"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { PiggyBank, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { SentryRing } from "@/components/ui/sentry-ring";
import { HealthScoreGauge } from "@/components/dashboard/health-score-gauge";
import { formatCents } from "@/lib/subscriptions/money";
import { fadeInUp } from "@/lib/motion";
import type { ComputedInsight } from "@/lib/subscriptions/insights";
import type { HealthScoreResult } from "@/lib/insights-engine";

// Replaces what used to be four separate bordered boxes stacked on top of
// each other (SavingsCard, HealthScoreCard, then a 2-up StatCard row) with
// one composed panel: a dominant "monthly spend" figure on the left, the
// health ring underneath it as supporting context, and the savings callout
// as its own zone on the right rather than a fourth stacked card repeating
// the same border/shadow chrome.
//
// Sizing pass: monthly spend first shipped at --text-display (3.25rem),
// bigger than the page's own "Welcome" H1 (text-h1, 2.5rem), which read as
// the dashboard's own metrics outranking the page title instead of
// supporting it. text-h1 itself would still tie it; landing one full step
// below (text-4xl, 2.25rem) keeps it the clear visual anchor of this panel.
// font-financial, semibold, and being the first thing in the card is
// already enough to read as "the number," without competing with the
// actual page heading above it. Card/gap padding tightened a step
// throughout for the same "premium and dense, not spacious for its own
// sake" reason; see dashboard/page.tsx's own comment for the matching
// page-level rhythm pass.
//
// `highlight` (the same emerald-glow treatment Card already uses for
// upgrade prompts) is applied to the whole panel, not just the savings
// corner of it, when there's a real confirmed duplicate to act on. The
// entire hero becomes the signal instead of one small badge inside it.
export function OverviewPanel({
  monthlyTotalCents,
  annualTotalCents,
  currency,
  otherCurrencyActiveCount,
  activeCount,
  potentialYearlySavingsCents,
  duplicateInsights,
  healthScore,
}: {
  monthlyTotalCents: number;
  annualTotalCents: number;
  // What monthlyTotalCents/annualTotalCents are actually denominated in —
  // see queries.ts's getDashboardData/money.ts's splitByPrimaryCurrency.
  // Always passed explicitly: formatCents/CountUp's "usd" default is a
  // fallback for genuinely unknown currency, not a safe assumption for an
  // account whose subscriptions might really be priced in EUR, GBP, or
  // anything else — the two totals above would otherwise render with the
  // wrong currency symbol for any non-USD account.
  currency: string;
  // How many active subscriptions exist in some other currency and are
  // therefore NOT part of the two totals above — see this same field on
  // DashboardData. 0 for the common single-currency case.
  otherCurrencyActiveCount: number;
  activeCount: number;
  potentialYearlySavingsCents: number;
  duplicateInsights: ComputedInsight[];
  healthScore: HealthScoreResult | null;
}) {
  const hasSavings = potentialYearlySavingsCents > 0;
  const firstDuplicateSubscriptionId = duplicateInsights[0]?.subscriptionIds[1];

  // Launch-readiness audit finding #7: whileInView (scroll-observer
  // triggered) on the very first thing the dashboard renders, already on
  // screen at mount, meant the observer's async callback — not the actual
  // paint — decided when this became visible. animate fires on mount
  // instead; same fadeInUp motion, no observer round-trip.
  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="visible">
      <Card highlight={hasSavings} className="p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:gap-8">
          {/* Left: the number this whole page exists to answer. */}
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Monthly spend</p>
              <p className="mt-1.5 font-financial text-4xl leading-none font-semibold">
                <CountUp value={monthlyTotalCents} format="currency" currency={currency} duration={0.9} animateOnMount={false} />
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Across {activeCount - otherCurrencyActiveCount} active subscription
                {activeCount - otherCurrencyActiveCount === 1 ? "" : "s"} · {formatCents(annualTotalCents, currency)}/yr
              </p>
              {/* Only the real, if uncommon, case of a mixed-currency
                  account: this app has no exchange-rate source (see
                  splitByPrimaryCurrency's own comment), so those
                  subscriptions are named as excluded rather than silently
                  missing from a total that would otherwise understate real
                  spend with no visible explanation. */}
              {otherCurrencyActiveCount > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {otherCurrencyActiveCount} more active subscription{otherCurrencyActiveCount === 1 ? "" : "s"} in a
                  different currency, not included above.
                </p>
              ) : null}
            </div>

            {healthScore ? (
              <div className="flex items-center gap-3 border-t border-border pt-5">
                <div className="relative shrink-0">
                  <SentryRing className="-inset-1.5" />
                  <HealthScoreGauge result={healthScore} size={52} />
                </div>
                <div className="min-w-0">
                  <p className="font-heading text-sm font-semibold">{healthScore.rating}</p>
                  <p className="text-xs text-muted-foreground">Subscription health</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right: the savings callout, its own zone rather than a fourth
              stacked card repeating the same chrome. */}
          <div className="flex flex-col justify-center gap-2 border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
            <div className="flex items-center gap-2">
              <div
                aria-hidden="true"
                className={
                  hasSavings
                    ? "flex size-7 items-center justify-center rounded-full bg-emerald-muted text-emerald"
                    : "flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
                }
              >
                {hasSavings ? <PiggyBank className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
              </div>
              <p className="text-sm font-medium text-muted-foreground">
                {hasSavings ? "Yearly savings from confirmed duplicates" : "Duplicate check"}
              </p>
            </div>

            {hasSavings ? (
              <>
                <p className="font-financial text-2xl leading-none font-semibold text-emerald">
                  <CountUp value={potentialYearlySavingsCents} format="currency" currency={currency} animateOnMount={false} />
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
                    className="mt-1 w-fit"
                    render={<Link href={`/subscriptions/${firstDuplicateSubscriptionId}`} />}
                    nativeButton={false}
                  >
                    Review the first one
                  </Button>
                ) : null}
              </>
            ) : (
              // Deliberately lighter than the hasSavings branch above: a
              // real dollar figure earns font-financial text-2xl. "Nothing
              // to report" doesn't, and used to borrow that same bold
              // treatment (text-lg font-semibold) for a non-finding, which
              // read as if this zone always had something worth announcing.
              <p className="text-sm text-muted-foreground">
                Nothing here looks redundant. You&apos;re not paying twice for the same thing.
              </p>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
