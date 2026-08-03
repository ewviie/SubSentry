import Link from "next/link";
import { DollarSign, Layers, PiggyBank, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { StatCard } from "@/components/dashboard/stat-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { SubscriptionsExplorer } from "@/components/subscriptions/subscriptions-explorer";
import { computeInsights, computePotentialSavingsMonthlyCents } from "@/lib/subscriptions/insights";

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const insights = computeInsights(data.subscriptions);
  const potentialSavingsMonthlyCents = computePotentialSavingsMonthlyCents(insights);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-heading text-h1 font-semibold">Subscriptions</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link href="/subscriptions/import" />} nativeButton={false}>
            Import subscriptions
          </Button>
          <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
            Add subscription
          </Button>
        </div>
      </div>

      {data.subscriptions.length > 0 ? (
        <StaggerSection className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={DollarSign} label="Monthly spend">
            <CountUp value={data.monthlyTotalCents} format="currency" />
          </StatCard>
          <StatCard icon={TrendingUp} label="Yearly spend">
            <CountUp value={data.annualTotalCents} format="currency" />
          </StatCard>
          <StatCard icon={Layers} label="Active subscriptions">
            <CountUp value={data.activeCount} format="integer" />
          </StatCard>
          <StatCard
            icon={PiggyBank}
            label="Potential savings"
            accentClassName={potentialSavingsMonthlyCents > 0 ? "bg-gold-muted text-gold" : undefined}
          >
            <span className={potentialSavingsMonthlyCents > 0 ? "text-gold" : undefined}>
              <CountUp value={potentialSavingsMonthlyCents * 12} format="currency" />
            </span>
          </StatCard>
        </StaggerSection>
      ) : null}

      <div className="mt-8">
        <SubscriptionsExplorer subscriptions={data.subscriptions} insights={insights} />
      </div>
    </div>
  );
}
