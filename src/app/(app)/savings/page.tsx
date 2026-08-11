import { requireUser } from "@/lib/auth/session";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { computeSavingsRecommendations, computeTotalPotentialSavingsMonthlyCents } from "@/lib/subscriptions/savings";
import { formatCents } from "@/lib/subscriptions/money";
import { EmptyState } from "@/components/ui/empty-state";
import { SavingsRecommendationCard } from "@/components/subscriptions/savings-recommendation-card";
import { PiggyBank, ShieldCheck } from "lucide-react";

export default async function SavingsPage() {
  const user = await requireUser();
  const subscriptions = await listSubscriptions(user.id);
  const recommendations = computeSavingsRecommendations(subscriptions);
  const totalMonthlyCents = computeTotalPotentialSavingsMonthlyCents(recommendations);

  return (
    <div className="max-w-3xl">
      <h1 className="font-heading text-h1 font-semibold">Smart Savings</h1>
      <p className="mt-1 text-muted-foreground">
        Real opportunities found in your own subscriptions — never a guessed percentage.
      </p>

      {recommendations.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={ShieldCheck}
          title="Nothing to flag right now"
          description="No likely duplicates or overlapping categories were found in your active subscriptions."
        />
      ) : (
        <>
          {totalMonthlyCents > 0 ? (
            <div className="mt-6 rounded-xl border border-emerald/30 bg-emerald-muted/40 p-4">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-emerald-muted text-emerald">
                  <PiggyBank className="size-4.5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Potential savings from duplicates</p>
                  <p className="font-mono text-2xl font-semibold tabular-nums text-emerald">
                    {formatCents(totalMonthlyCents)}/mo
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            {recommendations.map((recommendation) => (
              <SavingsRecommendationCard key={recommendation.id} recommendation={recommendation} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
