import type { Notification } from "@/lib/db/schema";

// Derived from the schema's own column type (single source of truth) rather
// than a second, hand-maintained union — schema.ts's own notifications.type
// column is the real definition; duplicating it here as a literal union was
// exactly the kind of two-copies-that-could-drift risk this codebase's own
// namesLikelyMatch extraction comment (insights.ts) warns about elsewhere,
// caught while adding "renewal_lapsed" in the watchdog phase.
export type NotificationType = Notification["type"];
export type NotificationSeverity = Notification["severity"];

// The shape generate.ts produces before it ever touches the DB — a plain
// data object, not a Drizzle insert type, so every generator function stays
// unit-testable without a database. dedupeKey is what queries.ts's
// insertNotifications relies on for idempotent, spam-free generation (see
// schema.ts's own comment on the notifications table for the full "never
// fabricate, never duplicate" reasoning).
export interface NotificationCandidate {
  type: NotificationType;
  title: string;
  body: string;
  severity: NotificationSeverity;
  impactCents: number | null;
  currency: string | null;
  subscriptionId: string | null;
  actionHref: string | null;
  dedupeKey: string;
  // Watchdog phase: set (non-null) only when the candidate represents
  // something the user has, by construction, already effectively seen —
  // e.g. a price increase whose subscription's lastReviewedAt is after the
  // change itself (see generate.ts's priceIncreaseCandidates). Lets a
  // notification exist as a truthful record (still visible in the full
  // /notifications history) without ever counting toward the unread badge
  // or the dashboard's "needs your attention" panel — "don't nag about
  // something they've already reviewed," without a second suppression
  // mechanism alongside readAt.
  readAt?: Date | null;
}
