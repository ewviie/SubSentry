import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDashboardData } from "@/lib/subscriptions/queries";
import { FREE_PLAN_SUBSCRIPTION_LIMIT, getUpgradeUrl, isBetaAllAccess, shouldShowSubscriptionLimitBanner } from "@/lib/billing/plan";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SubscriptionsExplorer } from "@/components/subscriptions/subscriptions-explorer";
import { UpgradeLimitBanner } from "@/components/billing/upgrade-prompt";
import { computeInsights } from "@/lib/subscriptions/insights";
import { formatCents } from "@/lib/subscriptions/money";

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const insights = computeInsights(data.subscriptions);
  const isPremium = await resolveHasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);
  // Section 9 of the monetization pass: progressive limit awareness, not a
  // number that only ever appears as a hard block. Starts one below the
  // real limit ("4 of 5") rather than from zero — showing this from the
  // very first subscription would just be nagging (section 17's "do not
  // over-gate"), not a genuine approaching-limit signal. Never rendered at
  // all once isPremium is true, the same guard every other gate in this
  // pass uses — including for a real beta user, whose resolveHasPaidAccess
  // already resolves true (see plan.ts), so this never incorrectly nags
  // someone who actually has full access right now.

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
          {/* Free-tier data export, not a Premium feature — see
              lib/subscriptions/export.ts's own comment. Icon-only rather
              than a third full-width button in this same row: the two
              primary actions (Import/Add) are what this page exists to
              drive, and a plain data-export utility shouldn't compete with
              them for width on a narrow screen. Only shown once there's
              something to export. */}
          {data.subscriptions.length > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    // eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download from an API route, not a page to client-side-navigate to
                    render={<a href="/api/subscriptions/export" />}
                    nativeButton={false}
                    aria-label="Export subscriptions as CSV"
                  >
                    <Download className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent>Export as CSV</TooltipContent>
            </Tooltip>
          ) : null}
          <Button variant="outline" render={<Link href="/subscriptions/import" />} nativeButton={false}>
            Import subscriptions
          </Button>
          <Button render={<Link href="/subscriptions/new" />} nativeButton={false}>
            Add subscription
          </Button>
        </div>
      </div>

      {shouldShowSubscriptionLimitBanner(isPremium, data.activeCount) ? (
        <UpgradeLimitBanner
          className="mt-4"
          current={data.activeCount}
          limit={FREE_PLAN_SUBSCRIPTION_LIMIT}
          beta={isBetaAllAccess()}
          upgradeUrl={upgradeUrl}
        />
      ) : null}

      <div className="mt-6">
        <SubscriptionsExplorer subscriptions={data.subscriptions} insights={insights} />
      </div>
    </div>
  );
}
