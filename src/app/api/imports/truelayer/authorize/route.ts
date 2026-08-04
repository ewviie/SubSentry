import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { checkBankConnectRateLimit } from "@/lib/imports/rate-limit";
import { isTrueLayerConfigured, buildAuthorizationUrl } from "@/lib/imports/truelayer-client";

const STATE_COOKIE = "truelayer_oauth_state";

// A browser-navigated redirect (GET, not a fetch() call) — TrueLayer's
// consent screen is a real page the user's browser has to land on, unlike
// Plaid Link's in-page JS modal. The wizard's "Connect" button is a plain
// <a href="/api/imports/truelayer/authorize">, not a fetch().
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  if (!isTrueLayerConfigured()) {
    return NextResponse.redirect(new URL("/subscriptions/import?truelayer_error=disabled", request.url));
  }

  const rateLimit = checkBankConnectRateLimit(session.user.id);
  if (!rateLimit.allowed) {
    return NextResponse.redirect(new URL("/subscriptions/import?truelayer_error=rate_limited", request.url));
  }

  // A random, short-lived, cookie-carried value the callback must echo back
  // unchanged — the same CSRF-on-redirect-flow protection Stripe's Payment
  // Link confirmation and every standard OAuth authorization-code flow
  // relies on, since this endpoint's redirect could otherwise be triggered
  // from any origin.
  const state = randomBytes(24).toString("base64url");
  const redirectUri = new URL("/api/imports/truelayer/callback", request.url).toString();
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
