import Link from "next/link";
import type { Route } from "next";
import { Sparkles, ShieldCheck, TrendingUp, CalendarClock, AlertTriangle, Gauge, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AllSubscriptionsList } from "@/components/dashboard/all-subscriptions-list";
import { HealthScoreActionsToggle } from "@/components/dashboard/insights/health-score-actions-toggle";
import { UpgradeCard, UpgradeInline } from "@/components/billing/upgrade-prompt";
import { isBetaAllAccess } from "@/lib/billing/plan";
import { formatCents } from "@/lib/subscriptions/money";
import { getSavingsPriority, PRIORITY_LABEL, PRIORITY_BADGE_VARIANT, splitSavingsRecommendationsByPlan } from "@/lib/subscriptions/savings";
import { computeBiggestOpportunity, type BiggestOpportunity } from "@/lib/insights-engine/biggest-opportunity";
import { cn } from "@/lib/utils";
import type { EngineOutput, HealthDimensionStatus, HealthDimensionResult } from "@/lib/insights-engine";
import type { Subscription } from "@/lib/db/schema";
import type { ComputedInsight } from "@/lib/subscriptions/insights";

// One file, several small presentational panels, kept together since each
// is a thin render over a single slice of EngineOutput with no shared state,
// avoiding per-component import/boilerplate overhead for what are
// otherwise ~20-40 line components.
//
// The former PremiumLocked (a single terse "X is a Pro feature. Upgrade to
// unlock this insight." line) is retired in favor of billing/upgrade-prompt.tsx's
// shared UpgradeCard — same "one consistent upgrade component" this
// monetization pass asks for everywhere else a gate renders (Health Score
// breakdown below, Analytics, subscription detail). isBetaAllAccess() is
// read directly here (safe — see plan.ts's own comment on why it's free of
// server-only imports) rather than threaded down as another prop through
// every one of this file's already-long prop lists.

export function QuickWinsCard({ output }: { output: EngineOutput }) {
  if (output.quickWins.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald" aria-hidden="true" />
          Quick wins
        </CardTitle>
        <CardDescription>The most actionable things worth reviewing right now.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {output.quickWins.map((win) => (
          <div key={win.ruleId} className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{win.title}</p>
                <p className="text-muted-foreground">{win.description}</p>
              </div>
              {win.monthlySavingsCents ? (
                <Badge className="shrink-0 bg-emerald text-emerald-foreground">{formatCents(win.monthlySavingsCents, win.currency)}/mo</Badge>
              ) : null}
            </div>
            {/* Same "one clear next click" pattern SavingsOpportunitiesCard
                already uses: only rendered when this finding actually
                points at a specific subscription (some health-rule findings,
                e.g. a renewal spike, are account-wide and have none). */}
            {win.subscriptionIds[0] ? (
              <Button size="sm" variant="outline" className="w-fit" render={<Link href={`/subscriptions/${win.subscriptionIds[0]}`} />} nativeButton={false}>
                Review
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PositiveHabitsCard({ output }: { output: EngineOutput }) {
  if (output.positive.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald" aria-hidden="true" />
          Positive financial habits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {output.positive.map((p) => (
          <p key={p.ruleId} className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{p.title}.</span> {p.description}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

// Used to be two side-by-side cards (a 4-stat forecast grid, and a plain
// "Upcoming renewals" list right next to it) that both led with the exact
// same fact: the forecast's "Next renewal" stat and the list's first row
// were always the same subscription and date. One merged card: a compact
// stat strip for the three numbers the list itself can't show (a 30-day
// total, which month is busiest, which single payment is biggest), then the
// actual chronological list right below it, so the list *is* the answer to
// "what's renewing next" instead of restating it as a fourth stat above it.
export function RenewalForecastCard({
  output,
  renewals,
  insights,
}: {
  output: EngineOutput;
  renewals: Subscription[];
  insights: ComputedInsight[];
}) {
  const { renewalForecast: f } = output;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-chart-4" aria-hidden="true" />
          Renewals
        </CardTitle>
      </CardHeader>
      {/* space-y-2 here, not the usual space-y-4. The stat strip below
          already has its own pb-4 separating its numbers from the divider
          line; stacking a second full 16px gap on top of that (before the
          list's own row padding even starts) made the gap under the divider
          roughly 2.5x the gap between the list's own rows, which read as
          uneven rather than as intentional breathing room. */}
      <CardContent className="space-y-2">
        {/* grid-cols-3 with no responsive override squeezed each stat into
            ~120px on a phone-width screen. "Biggest payment" wrapped to two
            lines while its neighbors didn't, so the three columns landed at
            different heights and the whole strip read as misaligned. One
            column below sm, 3-across once there's actually room. */}
        <div className="grid grid-cols-1 gap-3 border-b border-border pb-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Due in 30 days</p>
            <p className="font-mono font-medium tabular-nums">{formatCents(f.totalDueNext30DaysCents, f.currency ?? undefined)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Busiest month</p>
            <p className="font-medium">{f.busiestPeriod ? f.busiestPeriod.monthLabel : "None"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Biggest payment</p>
            <p className="font-medium">{f.largestUpcomingPayment ? f.largestUpcomingPayment.name : "None"}</p>
          </div>
        </div>
        {/* The dashboard's one "what's coming up" list — see
            all-subscriptions-list.tsx's own comment for why this replaced a
            second, separately-styled RenewalsList that used to sit right
            here rendering an overlapping set of subscriptions a second time. */}
        <AllSubscriptionsList
          subscriptions={renewals}
          insights={insights}
          emptyTitle="Nothing renewing soon"
          emptyDescription="Nothing renews in the next 30 days."
        />
      </CardContent>
    </Card>
  );
}

// North Star Part 9: a single, committed answer to "what's my biggest
// opportunity," distinct from Savings opportunities/Quick wins' ranked
// lists just below it: this is the one thing to look at if a user reads
// nothing else on the page. See computeBiggestOpportunity's own header
// comment for the exact ranking (confirmed saving > cash-flow risk >
// reviewable saving > highest-cost subscription). Every candidate there is
// read from `output`, not recomputed, so this can never disagree with what
// the rest of the dashboard already says about the same fact.
//
// The card's own chrome (border/glow/ring), not just the dollar figure, is
// tone-aware. The emerald "this matters, and it's a win" glow SavingsCard's
// hasSavings state uses is only earned by amountTone: "positive" (a
// confirmed saving). Raised in local-council review (Maintainability lens):
// the first version of this fix only recolored the number, leaving the
// glowing emerald frame around a cash-flow warning or a plain "here's your
// biggest expense" fact: exactly the "real money read as a win" conflation
// this whole card exists to avoid, just moved from the number to the frame
// around it.
const OPPORTUNITY_CHROME: Record<BiggestOpportunity["amountTone"], string> = {
  positive: "relative overflow-hidden border-emerald/30 shadow-elevation-glow ring-1 ring-emerald/20",
  neutral: "relative overflow-hidden shadow-elevation-low",
};

export function BiggestOpportunityCard({ output }: { output: EngineOutput }) {
  const opportunity = computeBiggestOpportunity(output);
  if (!opportunity) return null;
  return (
    <Card className={OPPORTUNITY_CHROME[opportunity.amountTone]}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Target
            className={cn("size-4", opportunity.amountTone === "positive" ? "text-emerald" : "text-muted-foreground")}
            aria-hidden="true"
          />
          Your biggest opportunity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-heading text-xl font-semibold">{opportunity.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{opportunity.description}</p>
          </div>
          {/* 0 only for the (currently unreachable, since renewal_risk always
              sets a real renewalForecast total) defensive case: guarded
              anyway rather than ever rendering "$0.00" as if it meant
              something. */}
          {opportunity.amountCents > 0 ? (
            <p
              className={cn(
                "shrink-0 font-mono text-2xl font-semibold tabular-nums",
                opportunity.amountTone === "positive" ? "text-emerald" : "text-foreground",
              )}
            >
              {formatCents(opportunity.amountCents, opportunity.currency)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">{opportunity.amountLabel}</span>
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Why we&apos;re showing this:</span> {opportunity.whyShown}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          render={<Link href={opportunity.actionHref as Route} />}
          nativeButton={false}
        >
          {opportunity.actionLabel} →
        </Button>
      </CardContent>
    </Card>
  );
}

export function SavingsOpportunitiesCard({
  output,
  isPremium,
  upgradeUrl,
}: {
  output: EngineOutput;
  isPremium: boolean;
  upgradeUrl: string | null;
}) {
  if (output.savingsForecast.recommendations.length === 0) return null;
  // monthlySavingsCents/yearlySavingsCents sum every confirmed-duplicate
  // recommendation's own (currency-correct) figure — see
  // computeTotalPotentialSavingsMonthlyCents. Labeling the sum itself
  // assumes all confirmed duplicates share one currency, true for the
  // overwhelming common case (this app's own duplicate detection compares
  // same-service subscriptions, which are almost always billed the same
  // way); a portfolio with confirmed duplicates in two different
  // currencies simultaneously is a known, narrower edge case this total
  // doesn't separately disclose.
  const savingsCurrency = output.savingsForecast.recommendations.find((r) => r.type === "duplicate")?.currency;
  // Monetization Council P0: every confirmed duplicate always stays fully
  // visible (see splitSavingsRecommendationsByPlan's own comment — that
  // promise is never behind a paywall anywhere in this app); only
  // review-tier findings beyond the first are withheld from a free-plan
  // caller, and only ever behind a real, checkable count + dollar total,
  // never a vague "upgrade for more."
  const { visible, teased } = splitSavingsRecommendationsByPlan(output.savingsForecast.recommendations, isPremium);
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Savings opportunities</CardTitle>
        <CardDescription>
          {/* Only counts confirmed duplicate matches (deterministic
              name-matching, never a guessed percentage). The list below can
              include category-concentration items ("N active streaming
              subscriptions") that are worth a look but aren't credited with
              a dollar figure the app can't back up. Saying "potential" here
              without qualifying it reads as if this total covers every item
              listed below it, including the $0-confidence ones. It doesn't. */}
          {formatCents(output.savingsForecast.monthlySavingsCents, savingsCurrency)}/mo · {formatCents(output.savingsForecast.yearlySavingsCents, savingsCurrency)}/yr
          from confirmed duplicates
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {visible.slice(0, 4).map((rec) => (
          // Used to be one row (title ... button) with the title truncated
          // to make room, fine at 2-up, but 3-up (see the grid this renders
          // in) narrowed the column enough that real titles like "3 active
          // other subscriptions" clipped mid-word. Wrapping instead of
          // truncating, with the button on its own line, is exactly the
          // pattern SavingsRecommendationCard already uses on /savings for
          // this same content: no cut-off text at any column width.
          <div key={rec.id} className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span>{rec.title}</span>
              <Badge variant={PRIORITY_BADGE_VARIANT[getSavingsPriority(rec)]} className="shrink-0">
                {PRIORITY_LABEL[getSavingsPriority(rec)]}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              render={<Link href={`/subscriptions/${rec.targetSubscriptionId}`} />}
              nativeButton={false}
            >
              {rec.actionLabel}
            </Button>
          </div>
        ))}
        {teased ? (
          <p className="text-sm text-muted-foreground">
            +{teased.count} more opportunit{teased.count === 1 ? "y" : "ies"}
            {teased.totalCents !== null ? `, worth an estimated ${formatCents(teased.totalCents, teased.currency ?? undefined)}` : ""}.{" "}
            <UpgradeInline label="See them with Pro" beta={isBetaAllAccess()} upgradeUrl={upgradeUrl} />
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Status dot color/label pairs. Color alone never carries the meaning
// (see InsightsSection's identical "text + color, never color alone"
// convention elsewhere on this dashboard); the word is always visible too.
// Keyed by HealthDimensionStatus itself (not a bare `string`), same
// exhaustiveness pattern rules/health.ts's `dimension satisfies
// HealthDimensionKey` already uses — a future addition to that union
// without a matching entry here is now a compile error, not a runtime
// crash on first render (release-review finding #10).
const DIMENSION_STATUS_STYLE: Record<HealthDimensionStatus, { dot: string; label: string }> = {
  good: { dot: "bg-emerald", label: "Good" },
  watch: { dot: "bg-chart-4", label: "Worth a look" },
  attention: { dot: "bg-destructive", label: "Needs attention" },
  // Zero rules in this dimension had enough evidence to form an opinion
  // (e.g. one brand-new subscription): a neutral gray, not a false "good".
  unknown: { dot: "bg-muted-foreground/40", label: "Not enough data" },
};

// Exported for insight-panels.test.ts, same "plain function, no
// component-test harness" reasoning as review-table.tsx's
// isPreselectedByDefault. The exhaustive Record type above already
// guarantees every real HealthDimensionStatus has an entry — this fallback
// is defense against a value reaching here some way the type system can't
// see (e.g. serialized across a server/client boundary), so a render never
// throws on a missing style.
export function styleForDimensionStatus(status: HealthDimensionStatus): { dot: string; label: string } {
  return DIMENSION_STATUS_STYLE[status] ?? DIMENSION_STATUS_STYLE.unknown;
}

// Grammatical "a, b, and c" join for the collapsed unknown-dimensions row
// below — there are only ever 5 dimensions total (DIMENSION_ORDER in
// health-score.ts), so no truncation/"and N more" cap is needed the way
// rules/health.ts's own formatNameList needs one for subscription names.
// Exported for insight-panels.test.ts, same "plain function, no
// component-test harness" reasoning as styleForDimensionStatus above.
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Exported for insight-panels.test.ts, same "plain function, no
// component-test harness" reasoning as styleForDimensionStatus/joinLabels
// above. The dimension most responsible for the score being what it is —
// not an arbitrary first one — is what a free-plan caller sees in place of
// the full breakdown (Premium). Reads only already-computed dimension
// scores; no Health Score math changes here.
export function worstKnownDimension(dimensions: HealthDimensionResult[]): HealthDimensionResult | null {
  const known = dimensions.filter((d) => d.status !== "unknown");
  if (known.length === 0) return null;
  return [...known].sort((a, b) => a.score - b.score)[0];
}

export function ScoreBreakdownCard({
  output,
  isPremium,
  upgradeUrl,
}: {
  output: EngineOutput;
  isPremium: boolean;
  upgradeUrl: string | null;
}) {
  if (!output.healthScore) return null;
  const { dimensions, confidence } = output.healthScore;

  // Monetization Council P0: "gate Health Score dimension breakdown by
  // plan." The overall score + rating are shown to every plan, unconditionally,
  // elsewhere (OverviewPanel's own gauge) — never gated. What's Premium-only
  // is the full per-dimension depth below; a free-plan caller still gets one
  // real, specific reason (the single dimension most responsible for the
  // score), never just a bare number with no explanation at all.
  if (!isPremium) {
    const worst = worstKnownDimension(dimensions);
    const style = worst ? styleForDimensionStatus(worst.status) : null;
    return (
      <UpgradeCard
        icon={Gauge}
        title="How your Health score was calculated"
        description="Your overall score already reflects all 5 factors — Pro shows the full breakdown behind it."
        beta={isBetaAllAccess()}
        upgradeUrl={upgradeUrl}
        preview={
          <div className="space-y-3">
            {/* Real value, not a locked box with nothing in it: names every
                dimension the score is actually built from (DIMENSION_ORDER
                in health-score.ts — not invented for this preview), plus
                the one dimension most responsible for the current score in
                full, unchanged from before this pass. */}
            <p className="text-xs text-muted-foreground">
              Built from {dimensions.map((d) => d.label).join(" · ")}.
            </p>
            {worst && style ? (
              <div className="flex items-start gap-2.5 text-sm">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-medium">{worst.label}</span>
                    <span className="text-xs text-muted-foreground">({style.label})</span>
                  </div>
                  <p className="text-muted-foreground">{worst.summary}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not enough data yet to say what&apos;s affecting your score.</p>
            )}
          </div>
        }
      />
    );
  }
  // UI audit finding #4: a thin/new account (e.g. one subscription with no
  // price history) can leave several dimensions with zero contributing
  // rules at once (growth needs 2+ active subscriptions to have an
  // opinion, renewal needs 3+ — see rules/health.ts) — every one of them
  // "unknown", every one rendering its own full row with the exact same
  // generic summary text ("Not enough data to say anything specific
  // yet."), verbatim, repeated. That read as padding, not information.
  // Dimensions with real evidence still get their own row, unchanged; the
  // "unknown" ones collapse into a single line naming all of them, so
  // nothing shown is lost, it's just not restated N times. Health-score
  // math (health-score.ts) is untouched — this only changes how the same
  // `dimensions` data is presented.
  const knownDimensions = dimensions.filter((d) => d.status !== "unknown");
  const unknownDimensions = dimensions.filter((d) => d.status === "unknown");
  // Audit fix #6: recommendedAction used to render inline under every
  // dimension that had one — up to 5 extra full sentences, unfolded by
  // default, on top of the 5 summary lines. The summary line (what's true)
  // is the actual methodology explanation and stays inline; the action line
  // (what to do about it) is real but secondary — collected here and handed
  // to HealthScoreActionsToggle so it's one opt-in disclosure instead of a
  // wall of always-visible advice. See that component's own comment for why
  // this is a small dedicated client component rather than "use client" on
  // this whole file.
  const recommendedActions: { label: string; action: string }[] = [];
  for (const d of knownDimensions) {
    if (d.recommendedAction) recommendedActions.push({ label: d.label, action: d.recommendedAction });
  }
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
          How your Health score was calculated
        </CardTitle>
        {/* Only shown for medium/low. High confidence needs no caveat (see
            health-score.ts's computeConfidence). Never invents a "we've
            been watching for months" claim; just an honest read of how much
            data actually backs this score. */}
        {confidence.level !== "high" ? (
          <CardDescription>
            Confidence: {confidence.level === "medium" ? "Medium" : "Low"}. {confidence.reason}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {knownDimensions.map((dimension) => {
          const style = styleForDimensionStatus(dimension.status);
          return (
            <div key={dimension.key} className="flex items-start gap-2.5 text-sm">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium">{dimension.label}</span>
                  <span className="text-xs text-muted-foreground">({style.label})</span>
                </div>
                <p className="text-muted-foreground">{dimension.summary}</p>
              </div>
            </div>
          );
        })}
        {unknownDimensions.length > 0 ? (
          <div className="flex items-start gap-2.5 text-sm">
            <span
              className={`mt-1.5 size-2 shrink-0 rounded-full ${DIMENSION_STATUS_STYLE.unknown.dot}`}
              aria-hidden="true"
            />
            <p className="min-w-0 text-muted-foreground">
              <span className="font-medium text-foreground">{joinLabels(unknownDimensions.map((d) => d.label))}</span>{" "}
              {unknownDimensions.length === 1 ? "doesn't" : "don't"} have enough data yet to say anything specific.
            </p>
          </div>
        ) : null}
        <HealthScoreActionsToggle actions={recommendedActions} />
      </CardContent>
    </Card>
  );
}

// UI audit finding #5: this used to render as "Optimization score: N/100" —
// a second bare "/100" grade on the same page as the overview panel's
// Health ring. Sizing it smaller (text-3xl vs Health's larger treatment)
// and adding a "separate from Health" caveat, both already tried, weren't
// enough — a normal user scanning the page still sees two "N/100" numerals
// and has no reason to know one is the primary signal and the other a
// narrower supporting one. The two are genuinely different metrics (Health:
// 5-dimension weighted wellness read; this: unrealized-savings dollars as a
// % of spend — see optimization-score.ts), not a case for merging them into
// one number — a full visual merge of these two cards was tried and
// reverted before. The fix is to stop presenting this as a second score at
// all: dollars lead (the actionable fact), and the underlying score value
// is still shown, just reframed as "% of spend recoverable" prose rather
// than a bare "/100" that echoes Health's own grammar. No calculation
// changed — optimization-score.ts's `score` is still 100 minus the
// unrealized/annual-spend ratio; only which of its two existing outputs is
// the visual headline changed.
export function UnrealizedSavingsCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) {
    return (
      <UpgradeCard
        icon={Gauge}
        title="Unrealized savings"
        description="See how much you could potentially save across your subscriptions, combining confirmed duplicates with estimated optimizations."
        beta={isBetaAllAccess()}
        upgradeUrl={upgradeUrl}
      />
    );
  }
  if (!output.optimizationScore) return null;
  const { score, unrealizedYearlySavingsCents } = output.optimizationScore;
  const unrecoveredPct = 100 - score;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle>Unrealized savings</CardTitle>
        <CardDescription>
          A narrower, dollar-specific signal than your Health score above — confirmed duplicates plus estimated
          optimizations, as a share of current spend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* font-financial/text-2xl/text-emerald matches every other real $
            savings figure on this dashboard (see OverviewPanel's own
            savings callout) — this card now reads as "a savings figure,"
            not "a second score," on first glance. */}
        <p className="font-financial text-2xl font-semibold text-emerald">
          {formatCents(unrealizedYearlySavingsCents, output.stats.currency ?? undefined)}/yr
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          identified: confirmed duplicates (Savings opportunities) plus estimates from Optimization recommendations
          below — {unrecoveredPct}% of your current spend still unrecovered.
          {/* This now folds in every optimization-category rule's
              monthlySavingsCents (see engine.ts), not just confirmed
              duplicates, so it can no longer read 0%-unrecovered "nothing
              found" while Optimization recommendations still shows a real
              dollar figure underneath it. Savings opportunities above stays
              duplicates-only on purpose (see its own comment); this card is
              the one place the two signals are meant to combine. */}
        </p>
        {/* This card's "confirmed duplicates" half only shows its biggest
            few on the dashboard (Savings opportunities above); /savings has
            the full, ranked list plus each one's own Review link. A number
            with no way to see the findings behind it is exactly the
            "here's something, figure out what to do" gap this pass is
            about closing. */}
        <Link href="/savings" className="mt-2 inline-block text-xs font-medium text-foreground hover:underline">
          View savings →
        </Link>
      </CardContent>
    </Card>
  );
}

export function AiRecommendationsCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) {
    return (
      <UpgradeCard
        icon={Sparkles}
        title="Optimization recommendations"
        description="See which subscriptions could be reduced or replaced, with an estimated dollar figure behind each one."
        beta={isBetaAllAccess()}
        upgradeUrl={upgradeUrl}
      />
    );
  }
  const suggestions = output.premiumInsights.filter((r) => r.category === "optimization");
  if (suggestions.length === 0) return null;
  return (
    <Card size="sm" className="shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-ai" aria-hidden="true" />
          Optimization recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map((s) => (
          <div key={s.ruleId} className="space-y-1.5 text-sm">
            <p>
              <span className="font-medium">{s.title}.</span>{" "}
              <span className="text-muted-foreground">{s.description}</span>
            </p>
            {/* Same "one clear next click" pattern QuickWinsCard/
                SavingsOpportunitiesCard already use. This rule (annual-plan
                savings) names every monthly subscription it summed, not one
                specific culprit, so subscriptionIds[0] — the same
                first-of-the-list convention those other cards fall back to
                for a multi-subscription finding — is a representative
                starting point to review, not "the" one responsible. */}
            {s.subscriptionIds[0] ? (
              <Button size="sm" variant="outline" className="w-fit" render={<Link href={`/subscriptions/${s.subscriptionIds[0]}`} />} nativeButton={false}>
                Review
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function RiskAlertsCard({ output, isPremium, upgradeUrl }: { output: EngineOutput; isPremium: boolean; upgradeUrl: string | null }) {
  if (!isPremium) {
    return (
      <UpgradeCard
        icon={AlertTriangle}
        title="Risk alerts"
        description="Spot spending concentration, unusually large renewal clusters, and other risks before they cost you."
        beta={isBetaAllAccess()}
        upgradeUrl={upgradeUrl}
      />
    );
  }
  const risks = output.premiumInsights.filter((r) => r.category === "usage");
  if (risks.length === 0) return null;
  return (
    <Card size="sm" className="border-destructive/30 shadow-elevation-low">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          Risk alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {risks.map((r) => (
          <div key={r.ruleId} className="space-y-1.5 text-sm">
            <div>
              <p className="font-medium">{r.title}</p>
              <p className="text-muted-foreground">{r.description}</p>
            </div>
            {/* premium.risk_rapid_growth is account-wide (empty
                subscriptionIds — see its own comment in premium.ts): no
                single subscription is responsible, so no button, rather
                than pointing "Review" at an arbitrary one. Every other risk
                rule here does name at least one real subscription. */}
            {r.subscriptionIds[0] ? (
              <Button size="sm" variant="outline" className="w-fit" render={<Link href={`/subscriptions/${r.subscriptionIds[0]}`} />} nativeButton={false}>
                Review
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
