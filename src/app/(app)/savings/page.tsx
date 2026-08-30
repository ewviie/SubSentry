import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import {
  computeSavingsRecommendations,
  computeTotalPotentialSavingsMonthlyCents,
  computeRealizedSavings,
  splitSavingsRecommendationsByPlan,
} from "@/lib/subscriptions/savings";
import { getDismissedRecommendationIds } from "@/lib/subscriptions/dismissed-recommendations";
import { formatCents } from "@/lib/subscriptions/money";
import { getUpgradeUrl, isBetaAllAccess } from "@/lib/billing/plan";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { EmptyState } from "@/components/ui/empty-state";
import { MotionCard } from "@/components/dashboard/motion-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { SavingsRecommendationCard } from "@/components/subscriptions/savings-recommendation-card";
import { UpgradeInline } from "@/components/billing/upgrade-prompt";
import { PiggyBank, ShieldCheck, CheckCircle2, EyeOff, Lock } from "lucide-react";

export default async function SavingsPage() {
  const user = await requireUser();
  const isPremium = await resolveHasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);
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
  // Monetization Council P0: "gate savings-opportunity list depth by plan."
  // Every confirmed duplicate always stays fully visible here too, on the
  // same principle SavingsOpportunitiesCard's own comment documents — this
  // page's real total above (totalMonthlyCents) is entirely confirmed-
  // duplicate-derived, so gating never makes that number and this list
  // disagree with each other.
  const { visible: visibleRecommendations, teased } = splitSavingsRecommendationsByPlan(recommendations, isPremium);

  return (
    <div className="max-w-3xl">
      <SectionHeading
        as="h1"
        eyebrow="Take action"
        title="Smart Savings"
        description="Real opportunities found in your own subscriptions. Never a guessed percentage."
      />

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
            {visibleRecommendations.map((recommendation) => (
              <SavingsRecommendationCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </StaggerSection>

          {/* Only ever describes review-tier findings (functional overlap,
              small-subscriptions clusters) beyond the one already shown in
              full above — confirmed duplicates are never withheld, see
              splitSavingsRecommendationsByPlan's own comment. Always a real,
              checkable count and dollar figure, never a vague "there's
              more" with nothing behind it. */}
          {teased ? (
            <MotionCard className="mt-3">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Lock className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    +{teased.count} more opportunit{teased.count === 1 ? "y" : "ies"} found
                    {teased.totalCents !== null
                      ? `, worth an estimated ${formatCents(teased.totalCents, teased.currency ?? undefined)}`
                      : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <UpgradeInline label="See the full list with Pro" beta={isBetaAllAccess()} upgradeUrl={upgradeUrl} />
                  </p>
                </div>
              </div>
            </MotionCard>
          ) : null}
        </>
      )}
    </div>
  );
}
