import type { Subscription } from "@/lib/db/schema";
import type { ComputedInsight } from "./insights";

// Every filter here reads either a real stored field or a set already
// computed by computeInsights() — nothing here invents a signal that isn't
// backed by real data. "Needs review" and "Duplicate" deliberately don't
// introduce a new persisted field (e.g. a "reviewed" flag): they're always
// re-derived from the subscription's current state, so they can never go
// stale or lie about what's actually true right now.

export function getDuplicateFlaggedIds(insights: ComputedInsight[]): Set<string> {
  const ids = new Set<string>();
  for (const insight of insights) {
    if (insight.type === "possible_overlap" && insight.potentialSavingsMonthlyCents !== undefined) {
      insight.subscriptionIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

export function getHighCostFlaggedIds(insights: ComputedInsight[]): Set<string> {
  const ids = new Set<string>();
  for (const insight of insights) {
    if (insight.type === "high_yearly_spend") {
      insight.subscriptionIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

// Matches the same "Action needed" vs "Worth noting" split already shown in
// InsightsSection — needs-review is the warning-severity subset (overdue
// renewals, likely duplicates), not every info-level observation.
export function getNeedsReviewIds(insights: ComputedInsight[]): Set<string> {
  const ids = new Set<string>();
  for (const insight of insights) {
    if (insight.severity === "warning") {
      insight.subscriptionIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

export function isRecentlyAdded(subscription: Subscription, withinDays = 7): boolean {
  const ageMs = Date.now() - subscription.createdAt.getTime();
  return ageMs >= 0 && ageMs <= withinDays * 86_400_000;
}

// Same 30-day window the dashboard's "Upcoming renewals" card already uses.
export function isUpcomingRenewal(subscription: Subscription, withinDays = 30): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
  return subscription.nextRenewalDate >= today && subscription.nextRenewalDate <= cutoff;
}

export function daysUntilRenewal(subscription: Subscription): number {
  const today = new Date().toISOString().slice(0, 10);
  const msPerDay = 86_400_000;
  const renewal = new Date(`${subscription.nextRenewalDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((renewal - todayMs) / msPerDay);
}
