import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { listSubscriptions, getAllPriceHistoryForUser } from "./queries";
import { computeSavingsRecommendations } from "./savings";
import { getDismissedRecommendationIds } from "./dismissed-recommendations";
import { computeWeeklyDigestSummary, isDigestWorthSending } from "./digest";
import { sendWeeklyDigestEmail } from "./notification-emails";
import { syncNotifications, listNotificationsSince } from "@/lib/notifications/queries";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { logServerError } from "@/lib/observability/log-error";

// The weekly-digest cron job — see users.lastDigestSentAt's own schema
// comment for why this is a single-column claim rather than a
// renewal_reminders-style event table. Deliberately simpler concurrency
// story than renewal-reminders.ts's claim/reclaim mechanism: this fires on
// a weekly cadence from one external scheduler (see vercel.json), not a
// daily one with a stale-claim recovery path, so the realistic overlap risk
// is low enough that a plain "update lastDigestSentAt only after a
// successful send" is proportionate — a run that crashes mid-batch simply
// leaves its not-yet-sent candidates eligible again on the very next
// scheduled run, the same "next run picks up stragglers" posture
// findReminderCandidates' own MAX_CANDIDATES_PER_RUN comment already
// documents for that job.
const MAX_CANDIDATES_PER_RUN = 200;
const MIN_DAYS_BETWEEN_DIGESTS = 6; // a hair under 7 so a scheduler that

// fires slightly early one week never skips a user entirely.

export interface DigestCandidate {
  userId: string;
  email: string;
  plan: "free" | "pro";
  // Watchdog phase: the digest's own "since I last heard from you" boundary
  // — see digest.ts's own header comment for why the digest is now built
  // from real notifications created since this timestamp, not re-derived
  // independently. Null on a user's first-ever digest.
  lastDigestSentAt: Date | null;
}

export async function findDigestCandidates(now: Date = new Date()): Promise<DigestCandidate[]> {
  const staleThreshold = new Date(now.getTime() - MIN_DAYS_BETWEEN_DIGESTS * 86_400_000);
  const rows = await db
    .select({ userId: users.id, email: users.email, plan: users.plan, lastDigestSentAt: users.lastDigestSentAt })
    .from(users)
    .where(
      and(
        eq(users.weeklyDigestEnabled, true),
        eq(users.emailVerified, true),
        or(isNull(users.lastDigestSentAt), lt(users.lastDigestSentAt, staleThreshold)),
      ),
    )
    // Never-sent-yet users first (nulls first), then longest-since-sent —
    // a fair rotation if this ever runs behind MAX_CANDIDATES_PER_RUN,
    // rather than the same alphabetically-first users always winning.
    .orderBy(sql`${users.lastDigestSentAt} asc nulls first`, asc(users.id))
    .limit(MAX_CANDIDATES_PER_RUN);
  return rows;
}

export interface WeeklyDigestJobResult {
  candidates: number;
  sent: number;
  skippedEmpty: number;
  failed: number;
}

// A user's very first digest looks back this far (there is no
// lastDigestSentAt yet to anchor to) — the same 7-day window
// isDigestWorthSending's predecessor used, kept as a sane bound rather than
// scanning a new account's entire notification history.
const FIRST_DIGEST_LOOKBACK_DAYS = 7;

export async function runWeeklyDigestJob(now: Date = new Date()): Promise<WeeklyDigestJobResult> {
  const candidates = await findDigestCandidates(now);
  const result: WeeklyDigestJobResult = { candidates: candidates.length, sent: 0, skippedEmpty: 0, failed: 0 };

  for (const candidate of candidates) {
    try {
      const [subscriptions, priceHistoryBySubscriptionId, dismissedRecommendationIds] = await Promise.all([
        listSubscriptions(candidate.userId),
        getAllPriceHistoryForUser(candidate.userId),
        getDismissedRecommendationIds(candidate.userId),
      ]);
      const isPremium = await resolveHasPaidAccess(candidate.plan);

      // Guarantees this user's notifications are up to date before the
      // digest reads them, regardless of whether they've opened the app
      // (the only other place syncNotifications normally runs) — the exact
      // "detection should happen without the user remembering to click
      // anything" requirement this whole phase is about. Reuses the same
      // function and inputs the dashboard/notifications pages already use;
      // nothing here recomputes detection a second way.
      const savingsRecommendations = computeSavingsRecommendations(subscriptions);
      await syncNotifications(candidate.userId, {
        subscriptions,
        priceHistoryBySubscriptionId,
        savingsRecommendations,
        isPremium,
        dismissedRecommendationIds,
      });

      const since = candidate.lastDigestSentAt ?? new Date(now.getTime() - FIRST_DIGEST_LOOKBACK_DAYS * 86_400_000);
      const newNotifications = await listNotificationsSince(candidate.userId, since);
      const summary = computeWeeklyDigestSummary(subscriptions, priceHistoryBySubscriptionId, newNotifications, now);

      if (!isDigestWorthSending(summary)) {
        result.skippedEmpty++;
        // Still records the attempt (see below) — an account with nothing
        // to report this week shouldn't be re-checked again tomorrow, only
        // next week, same cadence as everyone else.
        await db.update(users).set({ lastDigestSentAt: now }).where(eq(users.id, candidate.userId));
        continue;
      }

      await sendWeeklyDigestEmail(candidate.email, summary);
      await db.update(users).set({ lastDigestSentAt: now }).where(eq(users.id, candidate.userId));
      result.sent++;
    } catch (error) {
      result.failed++;
      logServerError("subscriptions.weekly-digest.send-failed", error, { userId: candidate.userId });
      // lastDigestSentAt is NOT updated on failure — this candidate stays
      // eligible and is retried on the next scheduled run, same "a failed
      // send must not silently disappear" posture renewal-reminders.ts's
      // own job loop documents.
    }
  }

  return result;
}
