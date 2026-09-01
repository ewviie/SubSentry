import type { Subscription } from "@/lib/db/schema";
import { daysUntilRenewal } from "./filters";

// Product-value pass: the Renewal Calendar's data layer. Reuses
// daysUntilRenewal (filters.ts) — the exact same "days until renewal"
// figure the dashboard's upcoming-renewals list and the renewal-reminder
// email already compute — so this view can never disagree with either
// about when something actually renews.
export type RenewalBucketKey = "overdue" | "this_week" | "this_month" | "later";

export interface RenewalBucket {
  key: RenewalBucketKey;
  label: string;
  subscriptions: (Subscription & { daysUntil: number })[];
}

const BUCKET_LABELS: Record<RenewalBucketKey, string> = {
  overdue: "Overdue",
  this_week: "This week",
  this_month: "This month",
  later: "Later",
};

function bucketFor(days: number): RenewalBucketKey {
  if (days < 0) return "overdue";
  if (days <= 7) return "this_week";
  if (days <= 30) return "this_month";
  return "later";
}

// Active subscriptions only, within `horizonDays` of today (default 90 —
// "genuinely useful" per the brief means a real planning horizon, not just
// the dashboard's existing 30-day list repeated). Grouped into buckets a
// user can actually act on at a glance, each internally sorted soonest
// first — the same ordering listSubscriptions/getDashboardData's own
// upcomingRenewals already use.
export function groupRenewalsByProximity(subscriptions: Subscription[], horizonDays = 90): RenewalBucket[] {
  const withDays = subscriptions
    .filter((s) => s.status === "active")
    .map((s) => ({ ...s, daysUntil: daysUntilRenewal(s) }))
    .filter((s) => s.daysUntil <= horizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);

  const buckets = new Map<RenewalBucketKey, (Subscription & { daysUntil: number })[]>();
  for (const s of withDays) {
    const key = bucketFor(s.daysUntil);
    const existing = buckets.get(key);
    if (existing) existing.push(s);
    else buckets.set(key, [s]);
  }

  return (["overdue", "this_week", "this_month", "later"] as const)
    .filter((key) => buckets.has(key))
    .map((key) => ({ key, label: BUCKET_LABELS[key], subscriptions: buckets.get(key)! }));
}
