import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, type Notification } from "@/lib/db/schema";
import type { NotificationCandidate } from "./types";
import { generateNotificationCandidates, type GenerateNotificationsInput } from "./generate";
import { comparePriority } from "./ranking";

// Bulk insert with onConflictDoNothing on the (userId, dedupeKey) unique
// index — same idempotent-upsert pattern
// dismissed-recommendations.ts's dismissRecommendation already uses for the
// identical reason: this runs on every relevant page load (see
// syncNotifications below), and re-detecting a finding that already has a
// row here must be a harmless no-op, never a duplicate row or a thrown
// constraint violation.
export async function insertNotifications(userId: string, candidates: NotificationCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  await db
    .insert(notifications)
    .values(candidates.map((c) => ({ userId, ...c })))
    .onConflictDoNothing();
}

// The one function pages call: generate this user's current candidates from
// already-loaded data (see generate.ts's own comment on why nothing here is
// recomputed) and persist any genuinely new ones. Safe to call on every
// dashboard/notifications page load — onConflictDoNothing above means a
// finding that already has a row is simply skipped, not re-inserted or
// re-dated, so a notification's createdAt/readAt state is never disturbed
// by later syncs that re-detect the same still-true fact.
export async function syncNotifications(userId: string, input: GenerateNotificationsInput): Promise<void> {
  const candidates = generateNotificationCandidates(input);
  await insertNotifications(userId, candidates);
}

// Monetization pass: Free sees the most recent FREE_NOTIFICATION_HISTORY
// notifications; Pro sees everything. Every notification a Free account
// would ever see is real and immediate (nothing here is a paywalled
// *kind* of alert — see this module's own README-style header comment) —
// only how far back the list scrolls is gated, the same "confirmed stays
// free, depth is the Pro dimension" posture savings.ts's
// splitSavingsRecommendationsByPlan already established. `limit` is null
// for a premium caller (no cap at all), never a very-large-but-technically-
// finite number standing in for "unlimited".
export const FREE_NOTIFICATION_HISTORY_LIMIT = 20;

export async function listNotifications(userId: string, options: { isPremium: boolean }): Promise<Notification[]> {
  const query = db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt));
  if (options.isPremium) return query;
  return query.limit(FREE_NOTIFICATION_HISTORY_LIMIT);
}

// Unread count is never plan-gated, even for a Free account whose list view
// is capped above — the badge's whole job is telling someone something
// needs attention; capping the count itself would understate how much is
// actually waiting for them.
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.value ?? 0;
}

export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.id, id), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

// Product-value pass: the dashboard's "Needs your attention" panel — the
// unified ranked list across every notification type (price increases,
// stale subscriptions, duplicates, savings opportunities), not just the
// savings-only figure BiggestOpportunityCard gave. Unread only: once a user
// has actually looked at something (via the bell, /notifications, or by
// clicking through from here), it drops off this panel — it stays visible
// in the full history, just stops competing for "needs attention" space.
// Bounded read (100) then sorted in application code, same "small real
// result set, sort in JS" posture savings.ts's own prioritization already
// uses — this table only ever holds one row per real, deduped finding, so
// a single user's unread count in practice is nowhere near this cap.
const ATTENTION_SCAN_LIMIT = 100;

export async function getAttentionItems(userId: string, limit = 5): Promise<Notification[]> {
  const unread = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(ATTENTION_SCAN_LIMIT);

  // Same severity + impact-cents priority order as ranking.ts's
  // comparePriority (now the one shared definition — see its own comment on
  // why this used to be a second, independently-drifting copy of
  // digest.ts's identical rule); createdAt is this function's own extra
  // tiebreak on top of it, not part of the shared rule, since nothing else
  // that reuses comparePriority needs "most recent first" as a third level.
  return unread
    .sort((a, b) => comparePriority(a, b) || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export interface RecentActivitySummary {
  totalCount: number;
  countByType: Partial<Record<Notification["type"], number>>;
}

const ACTIVITY_WINDOW_DAYS = 30;

// "What changed since last month" — a real count of every notification
// generated (not just unread ones) in the last 30 days, grouped by type.
// Answers the brief's own Q9 directly from data this table already has;
// no new detection, just a different read of it.
export async function getRecentActivitySummary(userId: string): Promise<RecentActivitySummary> {
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000);
  const rows = await db
    .select({ type: notifications.type, value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, since)))
    .groupBy(notifications.type);

  const countByType: RecentActivitySummary["countByType"] = {};
  let totalCount = 0;
  for (const row of rows) {
    countByType[row.type] = row.value;
    totalCount += row.value;
  }
  return { totalCount, countByType };
}

// Watchdog phase: the weekly digest's own "what's genuinely new since I
// last heard from you" read — every notification created since `since`
// (the caller's own users.lastDigestSentAt, or a 7-day fallback on a
// user's first-ever digest), regardless of read state. Deliberately reuses
// this table (the same persisted, deduped record the bell/notification
// center already show) rather than re-deriving "what's new" independently
// in digest.ts — the two surfaces can never disagree about what counts as
// a real finding this way, and a notification's own dedupeKey already
// guarantees "the same thing you already saw" can't appear here twice
// across two digests either.
export async function listNotificationsSince(userId: string, since: Date): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, since)))
    .orderBy(desc(notifications.createdAt));
}
