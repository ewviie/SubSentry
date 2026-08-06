import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkGmailSyncRateLimit } from "@/lib/imports/rate-limit";
import { isGmailConfigured, refreshAccessToken, GoogleApiError } from "@/lib/imports/gmail-client";
import { gmailImportProvider } from "@/lib/imports/providers/gmail-provider";
import {
  getEmailConnection,
  decryptAccessToken,
  decryptRefreshToken,
  updateEmailConnectionTokensIfUnchanged,
  markEmailConnectionSynced,
} from "@/lib/imports/email-connections";
import { analyzeParsedTransactions } from "@/lib/imports/analyze";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { logServerError } from "@/lib/observability/log-error";

// Google's access tokens expire in ~1 hour — refresh proactively whenever
// less than this much runway is left, same reasoning as TrueLayer's
// REFRESH_BUFFER_MS (rather than waiting for a live API call to 401).
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isGmailConfigured()) {
    return NextResponse.json({ error: "source_disabled", message: "Gmail import isn't available yet." }, { status: 400 });
  }

  const rateLimit = checkGmailSyncRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many imports analyzed recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const connection = await getEmailConnection(session.user.id, "gmail");
  if (!connection) {
    return NextResponse.json(
      { error: "not_connected", message: "Connect your Google account first." },
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    accessToken = decryptAccessToken(connection);
  } catch (error) {
    logServerError("imports.gmail.sync.decrypt", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "reconnect_required", message: "Your stored Google connection can no longer be read. Reconnect." },
      { status: 400 },
    );
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (Date.now() > expiresAt - REFRESH_BUFFER_MS) {
    const refreshToken = decryptRefreshToken(connection);
    if (!refreshToken) {
      return NextResponse.json(
        { error: "reconnect_required", message: "Your Google connection expired. Reconnect your account." },
        { status: 400 },
      );
    }

    let refreshed;
    try {
      refreshed = await refreshAccessToken(refreshToken);
    } catch (error) {
      // 400/401 from Google's token endpoint means the refresh token itself
      // is dead (typically invalid_grant — often because the user revoked
      // access from their Google Account settings) — no amount of retrying
      // fixes that, only reconnecting does.
      if (error instanceof GoogleApiError && (error.status === 400 || error.status === 401)) {
        return NextResponse.json(
          { error: "reconnect_required", message: "Your Google connection expired. Reconnect your account." },
          { status: 400 },
        );
      }
      logServerError("imports.gmail.sync.refresh", error, { userId: session.user.id });
      return NextResponse.json(
        { error: "gmail_error", message: "Couldn't refresh your Google connection. Try again." },
        { status: 502 },
      );
    }

    const persisted = await updateEmailConnectionTokensIfUnchanged(connection.id, connection.accessTokenEncrypted, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    accessToken = persisted
      ? refreshed.accessToken
      : decryptAccessToken((await getEmailConnection(session.user.id, "gmail")) ?? connection);
  }

  let parseResult;
  try {
    parseResult = await gmailImportProvider.fetchTransactions!(accessToken);
  } catch (error) {
    logServerError("imports.gmail.sync.fetch", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "gmail_error", message: "Couldn't scan your Gmail for receipts. Try again." },
      { status: 502 },
    );
  }

  const existingSubscriptions = await listSubscriptions(session.user.id);
  const { detected, warnings, skippedRowCount } = analyzeParsedTransactions(parseResult, existingSubscriptions);
  await markEmailConnectionSynced(connection.id);

  return NextResponse.json({ detected, warnings, skippedRowCount });
}
