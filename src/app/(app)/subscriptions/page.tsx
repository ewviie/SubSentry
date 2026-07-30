import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { formatCents } from "@/lib/subscriptions/money";
import { Button } from "@/components/ui/button";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Subscriptions</h1>
          {data.subscriptions.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {data.activeCount} active ·{" "}
              <span className="font-mono tabular-nums">{formatCents(data.monthlyTotalCents)}</span>/mo
            </p>
          ) : null}
        </div>
        <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
          Add subscription
        </Button>
      </div>

      <SubscriptionsTable subscriptions={data.subscriptions} />
    </div>
  );
}
