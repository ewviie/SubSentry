import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { exchangeCodeForTokens, fetchAccounts } from "@/lib/imports/truelayer-client";
import { createBankConnection } from "@/lib/imports/bank-connections";
import { logServerError } from "@/lib/observability/log-error";

const STATE_COOKIE = "truelayer_oauth_state";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const importUrl = new URL("/subscriptions/import", request.url);

  if (url.searchParams.get("error")) {
    importUrl.searchParams.set("truelayer_error", "denied");
    return NextResponse.redirect(importUrl);
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookieStore = request.headers.get("cookie") ?? "";
  const expectedState = cookieStore
    .split("; ")
    .find((entry) => entry.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    importUrl.searchParams.set("truelayer_error", "invalid_state");
    return NextResponse.redirect(importUrl);
  }

  try {
    const redirectUri = new URL("/api/imports/truelayer/callback", request.url).toString();
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const accounts = await fetchAccounts(tokens.accessToken);
    // TrueLayer's item-equivalent is really "this OAuth connection" as a
    // whole rather than a single id — the first account's id is a stable
    // enough handle to dedupe a re-link of the same connection against
    // bank_connections' unique index. If the user completed consent but
    // granted access to zero accounts, there's nothing to key a connection
    // on — a random fallback id would create a connection row that looks
    // successful but can never actually fetch anything.
    const primaryAccount = accounts[0];
    if (!primaryAccount) {
      importUrl.searchParams.set("truelayer_error", "no_accounts");
      return NextResponse.redirect(importUrl);
    }

    await createBankConnection({
      userId: session.user.id,
      provider: "truelayer",
      providerItemId: primaryAccount.account_id,
      institutionName: primaryAccount.provider?.display_name ?? null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    importUrl.searchParams.set("truelayer_connected", "1");
  } catch (error) {
    logServerError("imports.truelayer.callback", error, { userId: session.user.id });
    importUrl.searchParams.set("truelayer_error", "connect_failed");
  }

  const response = NextResponse.redirect(importUrl);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
