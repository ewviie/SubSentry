import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import {
  computeSavingsRecommendations,
  computeTotalPotentialSavingsMonthlyCents,
  computeRealizedSavings,
} from "@/lib/subscriptions/savings";
import { getDismissedRecommendationIds } from "@/lib/subscriptions/dismissed-recommendations";
import { formatCents } from "@/lib/subscriptions/money";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionCard } from "@/components/dashboard/motion-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { SavingsRecommendationCard } from "@/components/subscriptions/savings-recommendation-card";
import { PiggyBank, ShieldCheck, CheckCircle2, EyeOff } from "lucide-react";

export default async function SavingsPage() {
  const user = await requireUser();
  // Independent reads, fetched in parallel — same reasoning every other
  // Promise.all in this app gives (see subscriptions/[id]/page.tsx's own
  // comment): neither depends on the other's result.
  const [subscriptions, dismissedIds] = await Promise.all([
    listSubscriptions(user.id),
    getDismissedRecommendationIds(user.id),
  ]);
  const allRecommendations = computeSavingsRecommendations(subscriptions);
  // Dismissal is scoped to this page's own review list, not the underlying
  // detection — see schema.ts's own comment on dismissedSavingsRecommendations
  // for why the dashboard's health score/Savings opportunities/Biggest
  // opportunity cards deliberately keep reading the unfiltered set. The
  // dollar total directly above this list, though, is computed from the
  // same filtered set the list itself shows: leaving it unfiltered would
  // show a "$X potential" figure right above a list that no longer
  // contains whatever the figure is counting, on this one page where both
  // are visible together.
  const recommendations = allRecommendations.filter((r) => !dismissedIds.has(r.id));
  const totalMonthlyCents = computeTotalPotentialSavingsMonthlyCents(recommendations);
  const realized = computeRealizedSavings(subscriptions);

  return (
    <div className="max-w-3xl">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/35" />
        Take action
      </p>
      <h1 className="font-heading text-h1 font-semibold">Smart Savings</h1>
      <p className="mt-1 text-muted-foreground">
        Real opportunities found in your own subscriptions. Never a guessed percentage.
      </p>

      {/* Realized savings, distinct from the "potential" section below on
          purpose, both in data source and in wording: this is what you've
          actually canceled, not a detected opportunity. Never labeled
          "confirmed": that word is already claimed by "confirmed
          duplicates" elsewhere on this page/dashboard (a different concept:
          a deterministic name match, not a completed action), and reusing
          it here would conflate the two. Shown whenever there's history,
          independent of whether there's anything to flag right now. A
          clean account with zero current opportunities can still have real
          past savings to show. */}
      {realized.canceledCount > 0 ? (
        <MotionCard className="mt-6">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-full bg-emerald-muted text-emerald">
                <CheckCircle2 className="size-4.5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Money saved so far</p>
                {/* monthlyCents/yearlyCents are null when canceled
                    subscriptions span more than one currency, currency is
                    unvalidated free text on this schema, so summing raw cents
                    across two of them would produce a number wearing a real
                    one's formatting (see computeRealizedSavings' own comment,
                    same rule money.ts's sumMonthlyCentsIfSingleCurrency
                    already enforces elsewhere). An honest gap, not a wrong
                    number: still names the real, currency-independent count. */}
                {realized.monthlyCents !== null && realized.yearlyCents !== null ? (
                  <>
                    <p className="font-financial text-2xl leading-none font-semibold text-emerald">
                      {formatCents(realized.monthlyCents, realized.currency ?? undefined)}/mo
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {realized.canceledCount === 1
                        ? "From 1 subscription you've canceled here"
                        : `From ${realized.canceledCount} subscriptions you've canceled here`}
                      , that&apos;s {formatCents(realized.yearlyCents, realized.currency ?? undefined)}/yr. This reflects each
                      subscription&apos;s current details. Editing or deleting a canceled one changes this total too.
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {realized.canceledCount === 1
                      ? "1 subscription canceled here"
                      : `${realized.canceledCount} subscriptions canceled here`}
                    , spanning more than one currency, so they can&apos;t be honestly added into one total.
                  </p>
                )}
              </div>
            </div>
          </div>
        </MotionCard>
      ) : null}

      {recommendations.length === 0 ? (
        // Two genuinely different honest states, not one generic "nothing
        // here": "we looked and found nothing" vs. "we found things and you
        // dismissed all of them" are different facts, and collapsing them
        // into the same "Nothing to flag" copy would misreport the second
        // one as the first.
        allRecommendations.length > 0 ? (
          <EmptyState
            className="mt-6"
            icon={EyeOff}
            title="You've dismissed everything found here"
            description="Nothing left to review right now — dismissed findings don't come back on their own."
          />
        ) : (
          <EmptyState
            className="mt-6"
            icon={ShieldCheck}
            title="Nothing to flag right now"
            description="No likely duplicates or overlapping categories were found in your active subscriptions."
          />
        )
      ) : (
        <>
          {totalMonthlyCents > 0 ? (
            <MotionCard className="mt-6">
              <div className="rounded-xl border border-emerald/30 bg-emerald-muted/40 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-full bg-emerald-muted text-emerald">
                    <PiggyBank className="size-4.5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Potential savings from duplicates</p>
                    <p className="font-financial text-2xl leading-none font-semibold text-emerald">
                      {formatCents(totalMonthlyCents)}/mo
                    </p>
                  </div>
                </div>
              </div>
            </MotionCard>
          ) : null}

          <StaggerSection className="mt-6 space-y-3" staggerChildren={0.05}>
            {recommendations.map((recommendation) => (
              <SavingsRecommendationCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </StaggerSection>
        </>
      )}
    </div>
  );
}
