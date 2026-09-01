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
import { buildUnusualChargeCandidate } from "@/lib/notifications/generate";
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
//   medium/low-confidence proposal is simply left for the next manual
//   sync/review, not auto-applied and not specially notified.
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
): Promise<{ priceIncreasesApplied: number; unusualChargesFlagged: number }> {
  let priceIncreasesApplied = 0;
  let unusualChargesFlagged = 0;
  if (detected.length === 0) return { priceIncreasesApplied, unusualChargesFlagged };

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

    // No clean price-change proposal (or not high-confidence enough to
    // auto-apply) but the cluster's own amounts are irregular relative to
    // an existing, already-tracked subscription — a real, distinct signal
    // from "the price cleanly stepped up once." See generate.ts's own
    // buildUnusualChargeCandidate for the exact bar (detection.ts's own
    // variance threshold, not a new one).
    const candidate = buildUnusualChargeCandidate(existing, item);
    if (candidate) {
      await insertNotifications(userId, [candidate]);
      unusualChargesFlagged++;
    }
  }

  return { priceIncreasesApplied, unusualChargesFlagged };
}

export async function runConnectedAccountSyncJob(): Promise<ConnectedAccountSyncResult> {
  const result: ConnectedAccountSyncResult = {
    accountsProcessed: 0,
    accountsSkipped: 0,
    priceIncreasesApplied: 0,
    unusualChargesFlagged: 0,
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
        continue;
      }

      const { priceIncreasesApplied, unusualChargesFlagged } = await processDetectedSubscriptions(
        connection.userId,
        outcome.result.detected,
        existingSubscriptions,
      );
      result.priceIncreasesApplied += priceIncreasesApplied;
      result.unusualChargesFlagged += unusualChargesFlagged;
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
        continue;
      }

      const { priceIncreasesApplied, unusualChargesFlagged } = await processDetectedSubscriptions(
        connection.userId,
        outcome.result.detected,
        existingSubscriptions,
      );
      result.priceIncreasesApplied += priceIncreasesApplied;
      result.unusualChargesFlagged += unusualChargesFlagged;
      result.accountsProcessed++;
      await markEmailConnectionSynced(connection.id);
    } catch (error) {
      result.accountsSkipped++;
      logServerError("imports.sync-job.email-account-failed", error, { userId: connection.userId, connectionId: connection.id, provider: connection.provider });
    }
  }

  return result;
}
