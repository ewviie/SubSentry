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

// Takes just the one field it needs (not the full Subscription) — widened
// from a full-Subscription param specifically so renewal-reminders.ts's
// cron job (which selects a lean, join-friendly column set, not a full
// subscription row — see that file's own comment on why) can call this
// same function instead of re-deriving "days until renewal" a second way.
// Every existing caller passing a full Subscription still satisfies this.
export function daysUntilRenewal(subscription: Pick<Subscription, "nextRenewalDate">): number {
  const today = new Date().toISOString().slice(0, 10);
  const msPerDay = 86_400_000;
  const renewal = new Date(`${subscription.nextRenewalDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  return Math.round((renewal - todayMs) / msPerDay);
}

// Shared by renewal-reminders.ts's cron job and its own tests — a RANGE,
// not an exact "days until renewal === 3" match. A daily job that only
// fires on the exact day-3 mark has no recovery if that one run is missed
// (deployment, transient failure): the next day's run would see
// daysUntilRenewal() === 2 and, with an exact match, silently never send
// anything for that renewal at all. The range tolerates a missed run
// while renewal_reminders' unique (subscriptionId, renewalDate) constraint
// still guarantees exactly one email per renewal event regardless of
// which day inside the window actually sends it — see that table's own
// schema comment. Email copy always uses the real daysUntilRenewal()
// value ("renews in 2 days"), never a hardcoded "3 days", so a late
// catch-up still reads correctly to the recipient.
export const REMINDER_WINDOW_MIN_DAYS = 1;
export const REMINDER_WINDOW_MAX_DAYS = 3;

// Product-value pass: the customizable lead-time options a user can choose
// in Settings (users.renewalReminderLeadDays), replacing the previously-
// fixed REMINDER_WINDOW_MAX_DAYS=3 for how far ahead the reminder email
// fires. Mirrored exactly by the DB check constraint on that column
// (schema.ts) — this array is the one place both the API route's Zod schema
// and the settings UI's <select> options read from, so the three can never
// drift out of agreement about what's a valid choice.
export const RENEWAL_REMINDER_LEAD_DAYS_OPTIONS = [1, 3, 7, 14, 30] as const;
