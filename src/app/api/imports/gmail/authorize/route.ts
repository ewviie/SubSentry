import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isGmailConfigured, buildAuthorizationUrl } from "@/lib/imports/gmail-client";

const STATE_COOKIE = "gmail_oauth_state";

// A browser-navigated redirect (GET, not a fetch() call) — Google's consent
// screen is a real page the user's browser has to land on, same shape as
// TrueLayer's OAuth flow (see truelayer/authorize/route.ts). The wizard's
// "Connect Google" button is a plain <a href="/api/imports/gmail/authorize">.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  if (!isGmailConfigured()) {
    return NextResponse.redirect(new URL("/subscriptions/import?gmail_error=disabled", request.url));
  }

  const rateLimit = checkBankConnectRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.redirect(new URL("/subscriptions/import?gmail_error=rate_limited", request.url));
  }

  // Same CSRF-on-redirect-flow protection as TrueLayer's identical state
  // cookie — a random, short-lived value the callback must echo back
  // unchanged, since this endpoint's redirect could otherwise be triggered
  // from any origin.
  const state = randomBytes(24).toString("base64url");
  const redirectUri = new URL("/api/imports/gmail/callback", request.url).toString();
  const authorizationUrl = buildAuthorizationUrl(redirectUri, state);

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
