import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isPlaidConfigured } from "@/lib/imports/plaid-client";
import { plaidImportProvider } from "@/lib/imports/providers/plaid-provider";
import { getLatestBankConnection, decryptAccessToken } from "@/lib/imports/bank-connections";
import { analyzeParsedTransactions } from "@/lib/imports/analyze";
import { listSubscriptions } from "@/lib/subscriptions/queries";

// The live-API counterpart to /api/imports/analyze: no file upload, just
// "fetch this user's already-linked bank transactions and run the same
// detection pipeline over them." Returns the exact same
// { detected, warnings, skippedRowCount } shape the wizard's review step
// already knows how to render, regardless of which route produced it.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isPlaidConfigured()) {
    return NextResponse.json(
      { error: "source_disabled", message: "Plaid import isn't available yet." },
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

  const connection = await getLatestBankConnection(session.user.id, "plaid");
  if (!connection) {
    return NextResponse.json(
      { error: "not_connected", message: "Connect a bank account with Plaid first." },
      { status: 400 },
    );
  }

  // Split from the fetch below: a decryption failure (e.g. TOKEN_ENCRYPTION_KEY
  // rotated since this row was written) can never be fixed by retrying, so it
  // gets its own "reconnect" response rather than the generic "try again"
  // fetchTransactions failures get.
  let accessToken: string;
  try {
    accessToken = decryptAccessToken(connection);
  } catch {
    return NextResponse.json(
      { error: "reconnect_required", message: "Your stored bank connection can no longer be read. Reconnect your bank." },
      { status: 400 },
    );
  }

  let parseResult;
  try {
    parseResult = await plaidImportProvider.fetchTransactions!(accessToken);
  } catch {
    return NextResponse.json(
      { error: "plaid_error", message: "Couldn't fetch transactions from Plaid. Try again." },
      { status: 502 },
    );
  }

  const existingSubscriptions = await listSubscriptions(session.user.id);
  const { detected, warnings, skippedRowCount } = analyzeParsedTransactions(parseResult, existingSubscriptions);

  return NextResponse.json({ detected, warnings, skippedRowCount });
}
