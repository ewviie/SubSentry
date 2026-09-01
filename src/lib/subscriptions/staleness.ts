import type { Subscription } from "@/lib/db/schema";

// Product-value pass: "You haven't reviewed this in N days." lastReviewedAt
// (schema.ts) is only ever set by a real, deliberate signal — a GET of this
// subscription's own detail page — never fabricated or inferred from an
// unrelated write. See schema.ts's own comment on the column for why this
// deliberately does NOT reuse updatedAt (a system-driven write, e.g. an
// import-confirmed price reconciliation, would misreport a human review
// that never happened).
//
// A subscription that has never been reviewed (lastReviewedAt is null —
// every subscription created before this column shipped, or one nobody has
// opened since) falls back to createdAt: the honest floor is "at least
// this long since anyone looked," not "unknown, so never flag it," which
// would silently exempt every legacy subscription from ever being called
// stale.
const STALE_THRESHOLD_DAYS = 120; // ~4 months — long enough that a normal
// once-a-quarter glance never trips this, short enough to catch something
// that's been on autopilot for the better part of a year.

export interface StaleSubscription {
  subscription: Subscription;
  daysSinceReviewed: number;
  // Whether daysSinceReviewed is a real "you looked at it N days ago"
  // figure or the createdAt-fallback "never reviewed, added N days ago" —
  // the two need different copy (a stale nudge shouldn't claim "reviewed 400
  // days ago" for a subscription that was never actually reviewed at all).
  everReviewed: boolean;
}

function daysSince(date: Date, now: number): number {
  return Math.max(0, Math.floor((now - date.getTime()) / 86_400_000));
}

// Active subscriptions only — a paused/canceled one isn't costing anything
// to "review." Sorted by longest-neglected first, the same "most actionable
// first" convention savings.ts's own prioritization uses.
export function findStaleSubscriptions(subscriptions: Subscription[], now: number = Date.now()): StaleSubscription[] {
  const stale: StaleSubscription[] = [];
  for (const subscription of subscriptions) {
    if (subscription.status !== "active") continue;
    const everReviewed = subscription.lastReviewedAt !== null;
    const daysSinceReviewed = daysSince(subscription.lastReviewedAt ?? subscription.createdAt, now);
    if (daysSinceReviewed >= STALE_THRESHOLD_DAYS) {
      stale.push({ subscription, daysSinceReviewed, everReviewed });
    }
  }
  return stale.sort((a, b) => b.daysSinceReviewed - a.daysSinceReviewed);
}

export { STALE_THRESHOLD_DAYS };
