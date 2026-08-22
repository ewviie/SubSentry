import Link from "next/link";
import { DollarSign, Layers } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { StatCard } from "@/components/dashboard/stat-card";
import { StaggerSection } from "@/components/dashboard/stagger-section";
import { SubscriptionsExplorer } from "@/components/subscriptions/subscriptions-explorer";
import { computeInsights } from "@/lib/subscriptions/insights";
import { formatCents } from "@/lib/subscriptions/money";

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const insights = computeInsights(data.subscriptions);

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
        <StaggerSection className="mt-6 grid gap-4 sm:grid-cols-2">
          <StatCard
            icon={DollarSign}
            label="Monthly spend"
            caption={`${formatCents(data.annualTotalCents)}/yr`}
          >
            <CountUp value={data.monthlyTotalCents} format="currency" />
          </StatCard>
          <StatCard icon={Layers} label="Active subscriptions">
            <CountUp value={data.activeCount} format="integer" />
          </StatCard>
        </StaggerSection>
      ) : null}

      <div className="mt-8">
        <SubscriptionsExplorer subscriptions={data.subscriptions} insights={insights} />
      </div>
    </div>
  );
}
