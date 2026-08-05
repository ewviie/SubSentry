import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isPlaidConfigured, getPlaidClient } from "@/lib/imports/plaid-client";
import { PLAID_LINK_PRODUCTS, PLAID_LINK_COUNTRY_CODES, LOOKBACK_DAYS } from "@/lib/imports/providers/plaid-provider";
import { logServerError } from "@/lib/observability/log-error";

// Creates the short-lived Link token the client-side Plaid Link SDK needs
// to open its own connect UI — the client never sees PLAID_CLIENT_ID/SECRET
// directly, only this token.
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
      { error: "rate_limited", message: "Too many connection attempts recently. Try again in a bit." },
      { status: 429 },
    );
  }

  try {
    const client = getPlaidClient();
    const response = await client.linkTokenCreate({
      client_name: "SubSentry",
      language: "en",
      country_codes: PLAID_LINK_COUNTRY_CODES,
      products: PLAID_LINK_PRODUCTS,
      transactions: { days_requested: LOOKBACK_DAYS },
      user: { client_user_id: session.user.id },
    });
    return NextResponse.json({ linkToken: response.data.link_token });
  } catch (error) {
    logServerError("imports.plaid.link-token", error, { userId: session.user.id });
    return NextResponse.json(
      { error: "plaid_error", message: "Couldn't start the bank connection. Try again." },
      { status: 502 },
    );
  }
}
