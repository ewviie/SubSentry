import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isTrueLayerConfigured, refreshAccessToken, TrueLayerApiError } from "@/lib/imports/truelayer-client";
import { trueLayerImportProvider } from "@/lib/imports/providers/truelayer-provider";
import {
  getLatestBankConnection,
  decryptAccessToken,
  decryptRefreshToken,
  updateBankConnectionTokensIfUnchanged,
} from "@/lib/imports/bank-connections";
import { analyzeParsedTransactions } from "@/lib/imports/analyze";
import { listSubscriptions } from "@/lib/subscriptions/queries";
import { logServerError } from "@/lib/observability/log-error";

// TrueLayer access tokens expire in ~90 minutes (unlike Plaid's, which don't
// expire the same way) — refresh proactively whenever less than this much
// runway is left, rather than waiting for a live API call to 401.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isTrueLayerConfigured()) {
    return NextResponse.json(
      { error: "source_disabled", message: "TrueLayer import isn't available yet." },
      { status: 400 },
    );
  }

  const rateLimit = checkBankConnectRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many imports analyzed recently. Try again in a bit." },
      { status: 429 },
    );
  }

  const connection = await getLatestBankConnection(session.user.id, "truelayer");
  if (!connection) {
    return NextResponse.json(
      { error: "not_connected", message: "Connect a bank account with TrueLayer first." },
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    accessToken = decryptAccessToken(connection);
  } catch (error) {
    logServerError("imports.truelayer.sync.decrypt", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "reconnect_required", message: "Your stored bank connection can no longer be read. Reconnect your bank." },
      { status: 400 },
    );
  }

  const expiresAt = connection.expiresAt?.getTime() ?? 0;
  if (Date.now() > expiresAt - REFRESH_BUFFER_MS) {
    const refreshToken = decryptRefreshToken(connection);
    if (!refreshToken) {
      return NextResponse.json(
        { error: "reconnect_required", message: "Your TrueLayer connection expired. Reconnect your bank." },
        { status: 400 },
      );
    }

    let refreshed;
    try {
      refreshed = await refreshAccessToken(refreshToken);
    } catch (error) {
      // 400/401 from TrueLayer's token endpoint means the refresh token
      // itself is dead (typically invalid_grant) — no amount of retrying
      // fixes that, only reconnecting does. Anything else (network blip,
      // 5xx) falls through to the generic truelayer_error response below.
      if (error instanceof TrueLayerApiError && (error.status === 400 || error.status === 401)) {
        return NextResponse.json(
          { error: "reconnect_required", message: "Your TrueLayer connection expired. Reconnect your bank." },
          { status: 400 },
        );
      }
      logServerError("imports.truelayer.sync.refresh", error, { userId: session.user.id });
      return NextResponse.json(
        { error: "truelayer_error", message: "Couldn't fetch transactions from TrueLayer. Try again." },
        { status: 502 },
      );
    }

    const persisted = await updateBankConnectionTokensIfUnchanged(connection.id, connection.accessTokenEncrypted, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresAt: refreshed.expiresAt,
    });
    // Lost the race to a concurrent sync that refreshed this same
    // connection first — use whichever token pair actually got persisted
    // rather than our own, which TrueLayer may have already rotated away.
    accessToken = persisted ? refreshed.accessToken : decryptAccessToken(
      (await getLatestBankConnection(session.user.id, "truelayer")) ?? connection,
    );
  }

  let parseResult;
  try {
    parseResult = await trueLayerImportProvider.fetchTransactions!(accessToken);
  } catch (error) {
    logServerError("imports.truelayer.sync.fetch", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "truelayer_error", message: "Couldn't fetch transactions from TrueLayer. Try again." },
      { status: 502 },
    );
  }

  const existingSubscriptions = await listSubscriptions(session.user.id);
  const { detected, warnings, skippedRowCount } = analyzeParsedTransactions(parseResult, existingSubscriptions);

  return NextResponse.json({ detected, warnings, skippedRowCount });
}
