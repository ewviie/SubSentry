import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { exchangeCodeForTokens, fetchUserEmail } from "@/lib/imports/gmail-client";
import { createEmailConnection } from "@/lib/imports/email-connections";
import { logServerError } from "@/lib/observability/log-error";

const STATE_COOKIE = "gmail_oauth_state";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const importUrl = new URL("/subscriptions/import", request.url);

  if (url.searchParams.get("error")) {
    importUrl.searchParams.set("gmail_error", "denied");
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
    importUrl.searchParams.set("gmail_error", "invalid_state");
    return NextResponse.redirect(importUrl);
  }

  try {
    const redirectUri = new URL("/api/imports/gmail/callback", request.url).toString();
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const emailAddress = await fetchUserEmail(tokens.accessToken);

    await createEmailConnection({
      userId: session.user.id,
      provider: "gmail",
      emailAddress,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    importUrl.searchParams.set("gmail_connected", "1");
  } catch (error) {
    logServerError("imports.gmail.callback", error, { userId: session.user.id });
    importUrl.searchParams.set("gmail_error", "connect_failed");
  }

  const response = NextResponse.redirect(importUrl);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
