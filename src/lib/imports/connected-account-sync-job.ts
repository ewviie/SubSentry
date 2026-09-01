import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type Subscription } from "@/lib/db/schema";
import type { DetectedSubscription } from "./types";
import { listBankConnectionsForSync, markBankConnectionSynced } from "./bank-connections";
import { listEmailConnectionsForSync, markEmailConnectionSynced } from "./email-connections";
import { syncPlaidTransactions, syncTrueLayerTransactions, syncGmailTransactions } from "./sync-transactions";
import { listSubscriptions, updateSubscription } from "@/lib/subscriptions/queries";
import { centsToAmountString } from "@/lib/subscriptions/money";
import { sendPriceIncreaseEmail } from "@/lib/subscriptions/notification-emails";
import { insertNotifications } from "@/lib/notifications/queries";
import {
  buildUnusualChargeCandidate,
  buildPriceChangeReviewCandidate,
  buildConnectionIssueCandidate,
  type ConnectionProvider,
} from "@/lib/notifications/generate";
import type { SyncOutcome } from "./sync-transactions";
import { logServerError } from "@/lib/observability/log-error";

// The Watchdog phase's central job: DATA -> DETECTION -> NOTIFICATION,
// running automatically instead of waiting for a user to click "sync." See
// this module's own scope boundaries, stated plainly rather than left
// implicit:
//
// - Never creates a new subscription. A brand-new merchant detected during
//   an automatic sync is left exactly where it is today: visible only if
//   the user opens the Import Center and pulls a fresh analyze themselves.
//   Creating a subscription is a judgment call (right category? really
//   recurring, not a one-off?) this app has always required a human to
//   confirm — see api/imports/confirm/route.ts's own design (imports are
//   never written at analyze time). Extending that trust boundary to
//   unattended writes is exactly the "excessive complexity /
//   misleading financial claims" risk this phase was told to stop and
//   report on rather than force through.
// - DOES auto-apply a price change, but only to an EXISTING subscription,
//   and only at confidence: "high" — stricter than the interactive Import
//   Center's own bar (confidence !== "low", i.e. high OR medium — see
//   detection.ts's priceChangeProposal gating), because there is no human
//   in the loop here to catch a medium-confidence false match. A
//   medium-confidence proposal is never auto-applied — but (council-review
//   fix) it IS preserved as its own reviewable price_change_review
//   notification (see processDetectedSubscriptions below and
//   generate.ts's buildPriceChangeReviewCandidate) rather than silently
//   discarded, which is what happened before this fix: the proposal was
//   computed, fell through to the unusual-charge check, didn't clear that
//   bar either (a clean medium-confidence step has low amount variance by
//   construction), and vanished with no record at all.
// - A connection that fails to sync with reconnect_required or
//   decrypt_error (council-review fix) is surfaced as a real, actionable
//   connection_issue notification — see flagConnectionIssueIfActionable
//   below. Before this fix, a broken connection was logged server-side and
//   never reached the user in any form; automatic protection could
//   silently stop working with no signal anywhere in the product.
// - The write path is the exact same updateSubscription (queries.ts) the
//   interactive "Update price" button already calls (see review-table.tsx's
//   own comment) — same price-history materiality gate, same
//   priceHistorySource: "import_update" tag, same idempotency (an
//   unchanged price writes nothing new). Running this job twice over
//   identical bank data is a no-op the second time, by construction.
export interface ConnectedAccountSyncResult {
  accountsProcessed: number;
  accountsSkipped: number;
  priceIncreasesApplied: number;
  unusualChargesFlagged: number;
  // Council-review fix, silent-failure path #2: a real proposal detected,
  // preserved as a notification, never auto-applied — see
  // buildPriceChangeReviewCandidate's own comment.
  priceChangesForReview: number;
  // Council-review fix, silent-failure path #1: a broken connection
  // actually surfaced to the user — see buildConnectionIssueCandidate's
  // own comment.
  connectionIssuesFlagged: number;
}

// Shared by both the bank and email loops below — reconnect_required and
// decrypt_error are genuinely actionable ("go reconnect this"); provider_error
// is a transient failure the next scheduled run retries on its own, and
// surfacing it as "reconnect your account" would be misleading (there's
// nothing to reconnect). Returns whether a notification was actually
// inserted, purely so the caller can count it — insertNotifications' own
// onConflictDoNothing already makes a repeat call within the same
// CONNECTION_ISSUE_REBUCKET_DAYS window a harmless no-op either way.
async function flagConnectionIssueIfActionable(
  userId: string,
  connectionId: string,
  provider: ConnectionProvider,
  outcome: Extract<SyncOutcome, { ok: false }>,
): Promise<boolean> {
  if (outcome.reason !== "reconnect_required" && outcome.reason !== "decrypt_error") return false;
  const candidate = buildConnectionIssueCandidate({ connectionId, provider, reason: outcome.reason });
  await insertNotifications(userId, [candidate]);
  return true;
}

interface UserSyncPrefs {
  plan: "free" | "pro";
  email: string;
  emailVerified: boolean;
  priceAlertEmailsEnabled: boolean;
}

async function getUserSyncPrefs(userId: string): Promise<UserSyncPrefs | null> {
  const [row] = await db
    .select({
      plan: users.plan,
      email: users.email,
      emailVerified: users.emailVerified,
      priceAlertEmailsEnabled: users.priceAlertEmailsEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

// Everything a real, automatic sync does with one detected batch, shared by
// every provider (bank or email) — the provider-specific fetch/refresh
// logic lives in sync-transactions.ts; this is what happens once that
// fetch has already produced a DetectedSubscription[] for one user.
async function processDetectedSubscriptions(
  userId: string,
  detected: DetectedSubscription[],
  existingSubscriptions: Subscription[],
): Promise<{ priceIncreasesApplied: number; unusualChargesFlagged: number; priceChangesForReview: number }> {
  let priceIncreasesApplied = 0;
  let unusualChargesFlagged = 0;
  let priceChangesForReview = 0;
  if (detected.length === 0) return { priceIncreasesApplied, unusualChargesFlagged, priceChangesForReview };

  const existingById = new Map(existingSubscriptions.map((s) => [s.id, s]));
  let prefs: UserSyncPrefs | null | undefined; // lazy, only fetched if actually needed this run

  for (const item of detected) {
    if (!item.isDuplicateOfExistingId) continue; // brand-new merchant — left for manual review, see this file's own header comment
    const existing = existingById.get(item.isDuplicateOfExistingId);
    if (!existing || existing.status !== "active") continue;

    if (item.priceChangeProposal && item.confidence === "high") {
      if (prefs === undefined) prefs = await getUserSyncPrefs(userId);
      if (!prefs) continue;

      const result = await updateSubscription(userId, item.isDuplicateOfExistingId, prefs.plan, {
        amount: centsToAmountString(item.priceChangeProposal.detectedAmountCents),
        billingCycle: item.priceChangeProposal.detectedBillingCycle,
        priceHistorySource: "import_update",
      });

      if (result.kind === "updated" && result.priceChange && result.priceChange.percentChange > 0) {
        priceIncreasesApplied++;
        // The price_increase notification itself is generated lazily by
        // notifications/generate.ts the next time this user's dashboard
        // loads (it reads subscriptionPriceHistory fresh, no separate
        // write needed here) — this only handles the one side effect that
        // genuinely can't wait for a page load: the email.
        if (prefs.priceAlertEmailsEnabled && prefs.emailVerified) {
          try {
            await sendPriceIncreaseEmail({
              to: prefs.email,
              subscriptionId: existing.id,
              name: existing.name,
              fromCents: result.priceChange.fromCents,
              toCents: result.priceChange.toCents,
              currency: result.priceChange.currency,
              change: result.priceChange,
            });
          } catch (error) {
            logServerError("imports.sync-job.price-increase-email", error, { userId, subscriptionId: existing.id });
          }
        }
      }
      continue;
    }

    // Council-review fix, silent-failure path #2: a real proposal exists
    // (detection.ts already gates priceChangeProposal to confidence !==
    // "low", so reaching here with one set means confidence is exactly
    // "medium") but doesn't clear the stricter auto-apply bar above. Before
    // this fix, execution fell straight through to the unusual_charge check
    // below — which a clean medium-confidence price step will essentially
    // never satisfy, since a clean step has LOW amount variance by
    // construction. That silently discarded a real, computed finding every
    // single day. Now it's preserved as its own reviewable notification
    // instead — never written to subscriptions/subscriptionPriceHistory,
    // see buildPriceChangeReviewCandidate's own comment.
    if (item.priceChangeProposal) {
      const candidate = buildPriceChangeReviewCandidate(existing, item.priceChangeProposal);
      await insertNotifications(userId, [candidate]);
      priceChangesForReview++;
      continue;
    }

    // No price-change proposal at all, but the cluster's own amounts are
    // irregular relative to an existing, already-tracked subscription — a
    // real, distinct signal from "the price cleanly stepped up once." See
    // generate.ts's own buildUnusualChargeCandidate for the exact bar
    // (detection.ts's own variance threshold, not a new one).
    const candidate = buildUnusualChargeCandidate(existing, item);
    if (candidate) {
      await insertNotifications(userId, [candidate]);
      unusualChargesFlagged++;
    }
  }

  return { priceIncreasesApplied, unusualChargesFlagged, priceChangesForReview };
}

export async function runConnectedAccountSyncJob(): Promise<ConnectedAccountSyncResult> {
  const result: ConnectedAccountSyncResult = {
    accountsProcessed: 0,
    accountsSkipped: 0,
    priceIncreasesApplied: 0,
    unusualChargesFlagged: 0,
    priceChangesForReview: 0,
    connectionIssuesFlagged: 0,
  };

  const [bankConnections, emailConnections] = await Promise.all([
    listBankConnectionsForSync(),
    listEmailConnectionsForSync(),
  ]);

  for (const connection of bankConnections) {
    // Per-account failure isolation: one connection's decrypt/refresh/fetch
    // failure must never abort the run for every other account — each
    // sync*Transactions call already returns a typed outcome instead of
    // throwing (see sync-transactions.ts), but this still wraps the whole
    // per-account body in case processDetectedSubscriptions itself throws
    // (a DB error mid-write), so one bad account can never take down the
    // rest of the loop either way.
    try {
      const existingSubscriptions = await listSubscriptions(connection.userId);
      const outcome =
        connection.provider === "plaid"
          ? await syncPlaidTransactions(connection, existingSubscriptions)
          : await syncTrueLayerTransactions(connection, existingSubscriptions);

      if (!outcome.ok) {
        result.accountsSkipped++;
        // reconnect_required/decrypt_error/provider_error are already
        // logged with real detail (never a token or credential) inside
        // sync-transactions.ts itself — nothing more to log here, just
        // count it and move on. lastSyncedAt is intentionally NOT bumped
        // on failure, so a persistently broken connection doesn't drift to
        // the back of the fair-rotation queue just for being broken.
        //
        // Council-review fix, silent-failure path #1: before this, that
        // was the entire handling — the failure was invisible to the user
        // forever. Now an actionable reason surfaces as a real
        // notification (see flagConnectionIssueIfActionable's own comment
        // for why provider_error is deliberately excluded).
        if (await flagConnectionIssueIfActionable(connection.userId, connection.id, connection.provider, outcome)) {
          result.connectionIssuesFlagged++;
        }
        continue;
      }

      const { priceIncreasesApplied, unusualChargesFlagged, priceChangesForReview } = await processDetectedSubscriptions(
        connection.userId,
        outcome.result.detected,
        existingSubscriptions,
      );
      result.priceIncreasesApplied += priceIncreasesApplied;
      result.unusualChargesFlagged += unusualChargesFlagged;
      result.priceChangesForReview += priceChangesForReview;
      result.accountsProcessed++;
      await markBankConnectionSynced(connection.id);
    } catch (error) {
      result.accountsSkipped++;
      logServerError("imports.sync-job.bank-account-failed", error, { userId: connection.userId, connectionId: connection.id, provider: connection.provider });
    }
  }

  for (const connection of emailConnections) {
    try {
      const existingSubscriptions = await listSubscriptions(connection.userId);
      const outcome = await syncGmailTransactions(connection, existingSubscriptions);

      if (!outcome.ok) {
        result.accountsSkipped++;
        if (await flagConnectionIssueIfActionable(connection.userId, connection.id, connection.provider, outcome)) {
          result.connectionIssuesFlagged++;
        }
        continue;
      }

      const { priceIncreasesApplied, unusualChargesFlagged, priceChangesForReview } = await processDetectedSubscriptions(
        connection.userId,
        outcome.result.detected,
        existingSubscriptions,
      );
      result.priceIncreasesApplied += priceIncreasesApplied;
      result.unusualChargesFlagged += unusualChargesFlagged;
      result.priceChangesForReview += priceChangesForReview;
      result.accountsProcessed++;
      await markEmailConnectionSynced(connection.id);
    } catch (error) {
      result.accountsSkipped++;
      logServerError("imports.sync-job.email-account-failed", error, { userId: connection.userId, connectionId: connection.id, provider: connection.provider });
    }
  }

  return result;
}
