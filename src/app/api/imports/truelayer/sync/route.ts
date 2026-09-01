import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isTrueLayerConfigured } from "@/lib/imports/truelayer-client";
import { getLatestBankConnection } from "@/lib/imports/bank-connections";
import { syncTrueLayerTransactions } from "@/lib/imports/sync-transactions";
import { listSubscriptions } from "@/lib/subscriptions/queries";

// The fetch(-with-refresh)+analyze core lives in sync-transactions.ts
// (syncTrueLayerTransactions) — shared with the automatic sync cron
// (connected-account-sync-job.ts) so there's exactly one implementation of
// "given a TrueLayer connection, refresh if needed, fetch, and detect."
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

  const existingSubscriptions = await listSubscriptions(session.user.id);
  const outcome = await syncTrueLayerTransactions(connection, existingSubscriptions);

  if (!outcome.ok) {
    if (outcome.reason === "decrypt_error") {
      return NextResponse.json(
        { error: "reconnect_required", message: "Your stored bank connection can no longer be read. Reconnect your bank." },
        { status: 400 },
      );
    }
    if (outcome.reason === "reconnect_required") {
      return NextResponse.json(
        { error: "reconnect_required", message: "Your TrueLayer connection expired. Reconnect your bank." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "truelayer_error", message: "Couldn't fetch transactions from TrueLayer. Try again." },
      { status: 502 },
    );
  }

  return NextResponse.json(outcome.result);
}
