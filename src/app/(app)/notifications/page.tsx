import { Bell } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listSubscriptions, getAllPriceHistoryForUser } from "@/lib/subscriptions/queries";
import { getDismissedRecommendationIds } from "@/lib/subscriptions/dismissed-recommendations";
import { computeSavingsRecommendations } from "@/lib/subscriptions/savings";
import { syncNotifications, listNotifications, FREE_NOTIFICATION_HISTORY_LIMIT } from "@/lib/notifications/queries";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { getUpgradeUrl, isBetaAllAccess } from "@/lib/billing/plan";
import { SectionHeading } from "@/components/dashboard/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationList } from "@/components/notifications/notification-list";
import { UpgradeInline } from "@/components/billing/upgrade-prompt";

export default async function NotificationsPage() {
  const user = await requireUser();
  const isPremium = await resolveHasPaidAccess(user.plan);
  const upgradeUrl = isPremium ? null : getUpgradeUrl(user.id);

  const [subscriptions, priceHistoryBySubscriptionId, dismissedRecommendationIds] = await Promise.all([
    listSubscriptions(user.id),
    getAllPriceHistoryForUser(user.id),
    getDismissedRecommendationIds(user.id),
  ]);
  // Same recommendations dashboard/page.tsx's own syncNotifications call
  // uses — computed once here too (this page's own request, not shared
  // across requests) rather than imported from a cache, since
  // computeSavingsRecommendations is cheap, deterministic, and this page has
  // no other reason to depend on the dashboard having rendered first.
  //
  // Watchdog phase, reversing this file's own earlier stance: dismissal IS
  // now threaded into notification generation (dismissedRecommendationIds
  // below) — see generate.ts's own GenerateNotificationsInput comment for
  // the full reasoning. dismissedSavingsRecommendations still only ever
  // hides a finding from /savings' own review list and this notification
  // center, never from the dashboard's or /savings' own dollar totals
  // (those keep reading the unfiltered set, unchanged).
  const savingsRecommendations = computeSavingsRecommendations(subscriptions);

  await syncNotifications(user.id, {
    subscriptions,
    priceHistoryBySubscriptionId,
    savingsRecommendations,
    isPremium,
    dismissedRecommendationIds,
  });

  const notifications = await listNotifications(user.id, { isPremium });
  const cappedForFree = !isPremium && notifications.length >= FREE_NOTIFICATION_HISTORY_LIMIT;

  return (
    <div className="max-w-2xl">
      <SectionHeading
        as="h1"
        eyebrow="Stay ahead"
        title="Notifications"
        description="Everything SubSentry has found, in one place — real data, never a fabricated alert."
      />

      {notifications.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Bell}
          title="Nothing to flag right now"
          description="Renewals, price changes, and savings opportunities will show up here as SubSentry finds them."
        />
      ) : (
        <div className="mt-6">
          <NotificationList initialNotifications={notifications} />
          {cappedForFree ? (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Showing your most recent {FREE_NOTIFICATION_HISTORY_LIMIT}. <UpgradeInline label="See full history with Pro" beta={isBetaAllAccess()} upgradeUrl={upgradeUrl} />
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
