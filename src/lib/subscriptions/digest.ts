import type { Subscription, SubscriptionPriceHistory, Notification } from "@/lib/db/schema";
import { monthlyCents, splitByPrimaryCurrency } from "./money";
import { daysUntilRenewal } from "./filters";
import { computeCreepingCostTrailing12Months } from "./price-history";

// "Your week with SubSentry" — Watchdog phase rework. Previously this
// re-derived "what's new" from subscriptions/priceHistory/savingsRecommendations
// independently of the notification center, which risked the two surfaces
// disagreeing about what actually counts as new, and (worse) meant a quiet
// week with zero real findings still "justified" sending purely because
// monthlyCents was nonzero — exactly the "here are the same things you
// already saw" spam this phase was told to avoid. Now the digest is built
// directly from this user's own notifications created since their last
// digest (see notifications/queries.ts's own listNotificationsSince) —
// the same persisted, deduped record the bell/notification center already
// show, so "new since last time" can never drift between the two, and a
// week with nothing new genuinely has nothing to report.
//
// upcomingRenewalsCount/creepingCost are the two exceptions, computed
// directly from subscriptions/priceHistory rather than from notifications
// — deliberately: upcoming renewals are routine, expected information (the
// brief's own instruction: they belong in the calendar/dashboard/digest,
// not the notification feed at all), and creeping cost is a standing
// figure, not a "new event." Both are genuinely useful digest content even
// in a week with zero new notifications, but neither alone makes a digest
// worth sending (see isDigestWorthSending below) — a routine renewal list
// repeated every week with nothing else would be exactly the "same things
// you already saw" spam this phase warns against.
export interface WeeklyDigestSummary {
  monthlyCents: number;
  currency: string | null;
  upcomingRenewalsCount: number;
  creepingCostAnnualDeltaCents: number | null;
  creepingCostCurrency: string | null;
  newNotificationCounts: Partial<Record<Notification["type"], number>>;
  totalNewNotifications: number;
  // The single most-worth-mentioning new item this week, or null when
  // there's nothing new — the highest-severity, highest-impact notification
  // among the ones counted above (warning before info, then real dollar
  // impact) — never a second, digest-specific "what matters most"
  // heuristic layered on top of what the notification center already
  // decided was worth flagging.
  topPriorityNotification: { title: string; body: string } | null;
}

const UPCOMING_RENEWAL_WINDOW_DAYS = 7;
const SEVERITY_RANK: Record<Notification["severity"], number> = { warning: 1, info: 0 };

export function computeWeeklyDigestSummary(
  subscriptions: Subscription[],
  priceHistoryBySubscriptionId: Map<string, SubscriptionPriceHistory[]>,
  newNotifications: Notification[],
  now: Date = new Date(),
): WeeklyDigestSummary {
  const active = subscriptions.filter((s) => s.status === "active");
  const { currency, included: primaryActive } = splitByPrimaryCurrency(active);
  const monthlyTotal = primaryActive.reduce((sum, s) => sum + monthlyCents(s.amountCents, s.billingCycle), 0);

  const upcomingRenewalsCount = active.filter((s) => {
    const days = daysUntilRenewal(s);
    return days >= 0 && days <= UPCOMING_RENEWAL_WINDOW_DAYS;
  }).length;

  const creepingCost = computeCreepingCostTrailing12Months(subscriptions, priceHistoryBySubscriptionId, now);

  const newNotificationCounts: WeeklyDigestSummary["newNotificationCounts"] = {};
  for (const n of newNotifications) {
    newNotificationCounts[n.type] = (newNotificationCounts[n.type] ?? 0) + 1;
  }

  const topPriority = [...newNotifications].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (b.impactCents ?? 0) - (a.impactCents ?? 0),
  )[0];

  return {
    monthlyCents: monthlyTotal,
    currency,
    upcomingRenewalsCount,
    creepingCostAnnualDeltaCents: creepingCost?.annualDeltaCents ?? null,
    creepingCostCurrency: creepingCost?.currency ?? null,
    newNotificationCounts,
    totalNewNotifications: newNotifications.length,
    topPriorityNotification: topPriority ? { title: topPriority.title, body: topPriority.body } : null,
  };
}

// Watchdog phase: "if there is nothing genuinely useful/new, don't send" —
// the bar is now strictly "at least one real notification since the last
// digest," not "has any recurring spend" (the old, much looser bar this
// replaced). monthlyCents/upcomingRenewalsCount/creepingCost are still
// shown in a digest that IS sent, but none of them alone justifies sending
// one — a routine renewal list or an unchanging spend total, repeated
// every week with nothing else, is exactly the "here's what you already
// saw" spam this phase was told to avoid.
export function isDigestWorthSending(summary: WeeklyDigestSummary): boolean {
  return summary.totalNewNotifications > 0;
}
