import { createHmac, timingSafeEqual } from "crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { appBaseUrl } from "@/lib/auth/email";
import { listSubscriptions, getAllPriceHistoryForUser, getRealizedSavings } from "./queries";
import { computeSavingsRecommendations } from "./savings";
import { getDismissedRecommendationIds } from "./dismissed-recommendations";
import { computeWeeklyDigestSummary, computeMonthlyTotal, isDigestWorthSending } from "./digest";
import { sendWeeklyDigestEmail } from "./notification-emails";
import { syncNotifications, listNotificationsSince, insertNotifications } from "@/lib/notifications/queries";
import { buildSpendIncreasedCandidate } from "@/lib/notifications/generate";
import { resolveHasPaidAccess } from "@/lib/dev/plan-preview";
import { logServerError } from "@/lib/observability/log-error";

// ── Digest unsubscribe token (stateless, HMAC-signed) ───────────────────
//
// Same shape as renewal-reminders.ts's own unsubscribe token, deliberately
// not shared with it (see that file's own comment on why verifyCronAuth and
// verifyUnsubscribeToken stay separate helpers despite the similar shape):
// a distinct purpose label ("weekly-digest-unsubscribe" vs "unsubscribe")
// means the two tokens are cryptographically independent — a leaked digest
// link can't be replayed against the renewal-reminders endpoint or vice
// versa. Needed now that weeklyDigestEnabled defaults to true for new
// signups (see schema.ts's own comment): a default-on email needs the same
// "obvious/easy way to disable, no login required" floor renewal reminders
// already have, not just the Settings toggle.
function deriveDigestKey(purpose: string): Buffer | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(purpose).digest();
}

export function buildDigestUnsubscribeToken(userId: string): string | null {
  const key = deriveDigestKey("weekly-digest-unsubscribe");
  if (!key) return null;
  return createHmac("sha256", key).update(userId).digest("hex");
}

export function verifyDigestUnsubscribeToken(userId: string, token: string): boolean {
  const expected = buildDigestUnsubscribeToken(userId);
  if (!expected) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(token, "hex");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function buildDigestUnsubscribeUrl(userId: string): string | null {
  const token = buildDigestUnsubscribeToken(userId);
  if (!token) return null;
  const url = new URL("/api/notifications/digest/unsubscribe", appBaseUrl());
  url.searchParams.set("u", userId);
  url.searchParams.set("t", token);
  return url.toString();
}

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
  // Retention pass: the portfolio total as of the last digest — see
  // users.lastDigestMonthlyCents's own schema comment. Both null on a
  // user's first-ever digest (nothing to compare against yet).
  lastDigestMonthlyCents: number | null;
  lastDigestCurrency: string | null;
}

export async function findDigestCandidates(now: Date = new Date()): Promise<DigestCandidate[]> {
  const staleThreshold = new Date(now.getTime() - MIN_DAYS_BETWEEN_DIGESTS * 86_400_000);
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      plan: users.plan,
      lastDigestSentAt: users.lastDigestSentAt,
      lastDigestMonthlyCents: users.lastDigestMonthlyCents,
      lastDigestCurrency: users.lastDigestCurrency,
    })
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
      const [subscriptions, priceHistoryBySubscriptionId, dismissedRecommendationIds, realizedSavingsRecords] = await Promise.all([
        listSubscriptions(candidate.userId),
        getAllPriceHistoryForUser(candidate.userId),
        getDismissedRecommendationIds(candidate.userId),
        // User Value Journey Audit, opportunity #1 revised: the same
        // permanent ledger /savings reads from — fetched here so
        // computeWeeklyDigestSummary can state it below, independent of
        // whether anything else changed this week.
        getRealizedSavings(candidate.userId),
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

      // Retention pass: "your spend went up since last time" — the one
      // comparison that needs an anchor from a PREVIOUS digest, so it's
      // computed and (if it clears the bar) inserted here rather than inside
      // generateNotificationCandidates above, the same "job-specific
      // detection lives in its one owning job" posture buildUnusualChargeCandidate/
      // buildConnectionIssueCandidate already follow in connected-account-sync-job.ts.
      // Inserted BEFORE listNotificationsSince below so a fresh candidate
      // this run is actually picked up by this same digest, not deferred to
      // the next one.
      const currentTotal = computeMonthlyTotal(subscriptions);
      if (candidate.lastDigestMonthlyCents !== null && candidate.lastDigestCurrency !== null) {
        const spendIncreasedCandidate = buildSpendIncreasedCandidate({
          previousCents: candidate.lastDigestMonthlyCents,
          previousCurrency: candidate.lastDigestCurrency,
          currentCents: currentTotal.cents,
          currentCurrency: currentTotal.currency ?? candidate.lastDigestCurrency,
        });
        if (spendIncreasedCandidate) {
          await insertNotifications(candidate.userId, [spendIncreasedCandidate]);
        }
      }

      const since = candidate.lastDigestSentAt ?? new Date(now.getTime() - FIRST_DIGEST_LOOKBACK_DAYS * 86_400_000);
      const newNotifications = await listNotificationsSince(candidate.userId, since);
      const previousTotal =
        candidate.lastDigestMonthlyCents !== null && candidate.lastDigestCurrency !== null
          ? { monthlyCents: candidate.lastDigestMonthlyCents, currency: candidate.lastDigestCurrency }
          : null;
      const summary = computeWeeklyDigestSummary(
        subscriptions,
        priceHistoryBySubscriptionId,
        newNotifications,
        savingsRecommendations,
        previousTotal,
        now,
        realizedSavingsRecords,
      );

      // Same snapshot update either way (worth-sending or not) — this
      // user's portfolio total was genuinely observed this run, so next
      // run's comparison should anchor to it regardless of whether this run
      // also happened to send an email. Never updated on a run that threw
      // before reaching here (see the catch block below).
      const snapshotUpdate = { lastDigestMonthlyCents: currentTotal.cents, lastDigestCurrency: currentTotal.currency };

      if (!isDigestWorthSending(summary)) {
        result.skippedEmpty++;
        // Still records the attempt (see below) — an account with nothing
        // to report this week shouldn't be re-checked again tomorrow, only
        // next week, same cadence as everyone else.
        await db.update(users).set({ lastDigestSentAt: now, ...snapshotUpdate }).where(eq(users.id, candidate.userId));
        continue;
      }

      const unsubscribeUrl = buildDigestUnsubscribeUrl(candidate.userId);
      await sendWeeklyDigestEmail(candidate.email, summary, unsubscribeUrl);
      await db.update(users).set({ lastDigestSentAt: now, ...snapshotUpdate }).where(eq(users.id, candidate.userId));
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
