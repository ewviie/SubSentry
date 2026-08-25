import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { Button } from "@/components/ui/button";
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
        <div>
          <h1 className="font-heading text-h1 font-semibold">Subscriptions</h1>
          {/* One line, not the two-card stat grid this used to be
              (Monthly spend / Active subscriptions, each its own bordered
              box with an icon badge). Both numbers already have a real
              home — the dashboard's own Financial Overview panel, one
              click away — and this page's actual job is search, filter,
              and act on the list below it, not restate the dashboard's
              headline figures a second time before you even reach the
              search bar. Especially costly on mobile: two full-width
              stacked cards used to push the search/filter UI below the
              fold on a phone screen. */}
          {data.subscriptions.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCents(data.monthlyTotalCents, data.currency)}/mo · {data.activeCount - data.otherCurrencyActiveCount} active
              subscription{data.activeCount - data.otherCurrencyActiveCount === 1 ? "" : "s"}
              {/* Same disclosure as the dashboard's own overview panel —
                  see its comment. */}
              {data.otherCurrencyActiveCount > 0
                ? ` (+${data.otherCurrencyActiveCount} in other currencies)`
                : ""}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" render={<Link href="/subscriptions/import" />} nativeButton={false}>
            Import subscriptions
          </Button>
          <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
            Add subscription
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <SubscriptionsExplorer subscriptions={data.subscriptions} insights={insights} />
      </div>
    </div>
  );
}
