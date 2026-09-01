import type { BankConnection, EmailConnection, Subscription } from "@/lib/db/schema";
import { isPlaidConfigured } from "./plaid-client";
import { plaidImportProvider } from "./providers/plaid-provider";
import { isTrueLayerConfigured, refreshAccessToken as refreshTrueLayerToken, TrueLayerApiError } from "./truelayer-client";
import { trueLayerImportProvider } from "./providers/truelayer-provider";
import { isGmailConfigured, refreshAccessToken as refreshGoogleToken, GoogleApiError } from "./gmail-client";
import { gmailImportProvider } from "./providers/gmail-provider";
import {
  decryptAccessToken as decryptBankAccessToken,
  decryptRefreshToken as decryptBankRefreshToken,
  updateBankConnectionTokensIfUnchanged,
  getLatestBankConnection,
} from "./bank-connections";
import {
  decryptAccessToken as decryptEmailAccessToken,
  decryptRefreshToken as decryptEmailRefreshToken,
  updateEmailConnectionTokensIfUnchanged,
  getEmailConnection,
} from "./email-connections";
import { analyzeParsedTransactions, type AnalyzeResult } from "./analyze";
import { logServerError } from "@/lib/observability/log-error";

// Watchdog phase: the fetch(-with-refresh)+analyze core each interactive
// sync route (api/imports/{plaid,truelayer,gmail}/sync) used to inline for
// itself, extracted so the new automatic cron
// (connected-account-sync-job.ts) can call the exact same logic instead of
// a parallel reimplementation — "reuse existing provider/sync logic rather
// than creating parallel implementations" was an explicit requirement, not
// just tidiness. Each interactive route below is refactored to call these
// too, so there is now exactly one place this logic lives.
//
// A plain discriminated result, never a thrown error for the "expected"
// failure modes (decrypt failure, dead refresh token, provider API error) —
// the cron needs to distinguish these to decide "skip and log" vs "skip
// silently, this account just isn't reachable right now" without a
// try/catch around a thrown-error taxonomy it would have to duplicate from
// each route's own switch on error type.
export type SyncOutcome =
  | { ok: true; result: AnalyzeResult }
  | { ok: false; reason: "reconnect_required" | "provider_error" | "decrypt_error" };

export async function syncPlaidTransactions(
  connection: BankConnection,
  existingSubscriptions: Subscription[],
): Promise<SyncOutcome> {
  if (!isPlaidConfigured()) return { ok: false, reason: "provider_error" };

  let accessToken: string;
  try {
    accessToken = decryptBankAccessToken(connection);
  } catch (error) {
    logServerError("imports.plaid.sync.decrypt", error, { userId: connection.userId, connectionId: connection.id });
    return { ok: false, reason: "decrypt_error" };
  }

  try {
    const parseResult = await plaidImportProvider.fetchTransactions!(accessToken);
    const result = analyzeParsedTransactions(parseResult, existingSubscriptions);
    return { ok: true, result };
  } catch (error) {
    logServerError("imports.plaid.sync.fetch", error, { userId: connection.userId, connectionId: connection.id });
    return { ok: false, reason: "provider_error" };
  }
}

// ~90 min TrueLayer access-token lifetime — same buffer/reasoning the
// interactive route's own comment gave before this was extracted.
const TRUELAYER_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function syncTrueLayerTransactions(
  connection: BankConnection,
  existingSubscriptions: Subscription[],
): Promise<SyncOutcome> {
  if (!isTrueLayerConfigured()) return { ok: false, reason: "provider_error" };

  let accessToken: string;
  try {
    accessToken = decryptBankAccessToken(connection);
  } catch (error) {
    logServerError("imports.truelayer.sync.decrypt", error, { userId: connection.userId, connectionId: connection.id });
    return { ok: false, reason: "decrypt_error" };
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (Date.now() > expiresAt - TRUELAYER_REFRESH_BUFFER_MS) {
    const refreshToken = decryptBankRefreshToken(connection);
    if (!refreshToken) return { ok: false, reason: "reconnect_required" };

    let refreshed;
    try {
      refreshed = await refreshTrueLayerToken(refreshToken);
    } catch (error) {
      if (error instanceof TrueLayerApiError && (error.status === 400 || error.status === 401)) {
        return { ok: false, reason: "reconnect_required" };
      }
      logServerError("imports.truelayer.sync.refresh", error, { userId: connection.userId, connectionId: connection.id });
      return { ok: false, reason: "provider_error" };
    }

    const persisted = await updateBankConnectionTokensIfUnchanged(connection.id, connection.accessTokenEncrypted, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    // Lost the race to a concurrent sync (interactive or another cron
    // invocation) that refreshed this same connection first — same
    // "use whichever token pair actually got persisted" reasoning the
    // interactive route's own comment gave.
    accessToken = persisted
      ? refreshed.accessToken
      : decryptBankAccessToken((await getLatestBankConnection(connection.userId, "truelayer")) ?? connection);
  }

  try {
    const parseResult = await trueLayerImportProvider.fetchTransactions!(accessToken);
    const result = analyzeParsedTransactions(parseResult, existingSubscriptions);
    return { ok: true, result };
  } catch (error) {
    logServerError("imports.truelayer.sync.fetch", error, { userId: connection.userId, connectionId: connection.id });
    return { ok: false, reason: "provider_error" };
  }
}

// ~1hr Google access-token lifetime — same buffer/reasoning as TrueLayer's.
const GOOGLE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function syncGmailTransactions(
  connection: EmailConnection,
  existingSubscriptions: Subscription[],
): Promise<SyncOutcome> {
  if (!isGmailConfigured()) return { ok: false, reason: "provider_error" };

  let accessToken: string;
  try {
    accessToken = decryptEmailAccessToken(connection);
  } catch (error) {
    logServerError("imports.gmail.sync.decrypt", error, { userId: connection.userId, connectionId: connection.id });
    return { ok: false, reason: "decrypt_error" };
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (Date.now() > expiresAt - GOOGLE_REFRESH_BUFFER_MS) {
    const refreshToken = decryptEmailRefreshToken(connection);
    if (!refreshToken) return { ok: false, reason: "reconnect_required" };

    let refreshed;
    try {
      refreshed = await refreshGoogleToken(refreshToken);
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 400 || error.status === 401)) {
        return { ok: false, reason: "reconnect_required" };
      }
      logServerError("imports.gmail.sync.refresh", error, { userId: connection.userId, connectionId: connection.id });
      return { ok: false, reason: "provider_error" };
    }

    const persisted = await updateEmailConnectionTokensIfUnchanged(connection.id, connection.accessTokenEncrypted, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    accessToken = persisted
      ? refreshed.accessToken
      : decryptEmailAccessToken((await getEmailConnection(connection.userId, "gmail")) ?? connection);
  }

  try {
    const parseResult = await gmailImportProvider.fetchTransactions!(accessToken);
    const result = analyzeParsedTransactions(parseResult, existingSubscriptions);
    return { ok: true, result };
  } catch (error) {
    logServerError("imports.gmail.sync.fetch", error, { userId: connection.userId, connectionId: connection.id });
    return { ok: false, reason: "provider_error" };
  }
}
