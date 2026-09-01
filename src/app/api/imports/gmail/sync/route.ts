import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkGmailSyncRateLimit } from "@/lib/imports/rate-limit";
import { isGmailConfigured } from "@/lib/imports/gmail-client";
import { getEmailConnection, markEmailConnectionSynced } from "@/lib/imports/email-connections";
import { syncGmailTransactions } from "@/lib/imports/sync-transactions";
import { listSubscriptions } from "@/lib/subscriptions/queries";

// The fetch(-with-refresh)+analyze core lives in sync-transactions.ts
// (syncGmailTransactions) — shared with the automatic sync cron
// (connected-account-sync-job.ts) so there's exactly one implementation of
// "given a Gmail connection, refresh if needed, fetch, and detect."
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

  const existingSubscriptions = await listSubscriptions(session.user.id);
  const outcome = await syncGmailTransactions(connection, existingSubscriptions);

  if (!outcome.ok) {
    if (outcome.reason === "decrypt_error") {
      return NextResponse.json(
        { error: "reconnect_required", message: "Your stored Google connection can no longer be read. Reconnect." },
        { status: 400 },
      );
    }
    if (outcome.reason === "reconnect_required") {
      return NextResponse.json(
        { error: "reconnect_required", message: "Your Google connection expired. Reconnect your account." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "gmail_error", message: "Couldn't scan your Gmail for receipts. Try again." },
      { status: 502 },
    );
  }

  await markEmailConnectionSynced(connection.id);
  return NextResponse.json(outcome.result);
}
