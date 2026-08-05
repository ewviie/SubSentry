import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { logSecurityEvent } from "@/lib/observability/log-security-event";

// Every top-level segment under the (app) route group — found by
// independently re-checking this list against the app's actual routes
// (analytics/page.tsx and savings/page.tsx were both missing here despite
// calling requireUser() themselves; not an auth bypass since requireUser()
// still redirects, but it meant those two pages always paid a DB round
// trip to discover "no session" instead of the cheap cookie-presence
// check every other protected page gets here).
const PROTECTED_PREFIXES = ["/dashboard", "/subscriptions", "/settings", "/analytics", "/savings"];
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Exported for direct unit testing (proxy.test.ts) — CSP correctness is
// security-sensitive and easy to silently regress (e.g. a future edit that
// drops the Turnstile origin would break signup's bot protection with no
// visible error, just a browser console CSP violation nobody's watching).
export function buildCsp(nonce: string): string {
  // No custom inline scripts anywhere in this app — Next.js applies this
  // nonce to its own framework-injected scripts automatically once it sees
  // the nonce on both the request header (below) and this response header.
  // 'strict-dynamic' lets those nonced scripts load their own chunks
  // without every chunk needing its own nonce.
  // style-src keeps 'unsafe-inline': next/font emits inline @font-face
  // <style> tags per build that aren't nonce-able the same way, and inline
  // style injection is a materially lower-severity XSS vector than script.
  // 'unsafe-eval' is added in dev only — React's dev-mode debugging
  // (component stack reconstruction) calls eval() and is hard-blocked
  // without it; React itself guarantees it "will never use eval() in
  // production mode", so prod stays strict.
  const isDev = process.env.NODE_ENV !== "production";
  // Cloudflare Turnstile (bot protection on signup/resend-verification —
  // see src/lib/security/captcha.ts) requires loading its script and
  // rendering its challenge iframe from this exact, dedicated domain —
  // there's no first-party/self-hosted alternative, so this is the
  // standard, documented trade-off every Turnstile integration makes, not
  // a broad relaxation: 'self' remains the default for every other
  // directive, and this widens script-src/frame-src/connect-src to one
  // narrowly-scoped Cloudflare subdomain, never a wildcard.
  const turnstileOrigin = "https://challenges.cloudflare.com";
  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' ${turnstileOrigin}`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstileOrigin}`;

  return [
    "default-src 'self'",
    scriptSrc,
    `frame-src ${turnstileOrigin}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    isDev ? `connect-src 'self' ws: ${turnstileOrigin}` : `connect-src 'self' ${turnstileOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// Defense-in-depth beyond SameSite=Lax cookies: reject cross-origin
// state-changing requests that carry our session cookie. Scoped to
// requests that actually have the cookie (rather than all of /api/*) so
// this can never interfere with server-to-server calls that don't carry
// it — the Stripe webhook, in particular, is authenticated entirely by its
// HMAC signature and never sends this cookie, so it's naturally exempt
// without needing an explicit path exclusion.
//
// Compares against the request's own `Host` header, NOT `request.nextUrl.origin`.
// This used to compare against nextUrl.origin on the (incorrect) assumption
// that it reflects the incoming Host header — verified empirically (via a
// real browser hitting `next start` on 127.0.0.1) that it does not: nextUrl
// resolved to "localhost" while the actual Host header, matching what the
// browser really sent as Origin, was "127.0.0.1". That mismatch 403'd every
// legitimate same-origin mutation — including logout — the moment a user
// wasn't on literally "localhost". Host header is (like nextUrl) still
// forwarded-proxy-dependent (see the reverse-proxy caveat below), but it's
// what the browser's same-origin fetch actually targeted, which is the
// correct thing to compare Origin/Referer against.
function isCrossOriginMutation(request: NextRequest): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method)) return false;
  if (!request.cookies.has(SESSION_COOKIE)) return false;

  const sourceOrigin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!sourceOrigin) return false; // nothing to compare — let SameSite carry the defense alone

  const host = request.headers.get("host");
  if (!host) return true; // no Host header at all is itself suspicious

  // nextUrl.protocol is unaffected by the hostname bug above (empirically
  // still correct — only the host/authority portion of nextUrl resolved
  // wrong), so it's kept for the protocol half of the comparison; only the
  // host half is rebuilt from the raw Host header.
  const expectedOrigin = `${request.nextUrl.protocol}//${host}`;

  try {
    // Behind a reverse proxy that doesn't forward/preserve the original
    // public Host (nginx, Caddy, Cloudflare, and Vercel all do this
    // correctly by default), this comparison could mismatch on entirely
    // legitimate same-origin traffic. If same-origin requests ever start
    // getting 403'd in production, check the proxy's Host-forwarding config
    // before suspecting this logic — this is the standard, accepted tradeoff
    // of Origin-based CSRF checks (the same one Rails' and Django's built-in
    // CSRF protection make), not unique to this implementation.
    return new URL(sourceOrigin).origin !== expectedOrigin;
  } catch {
    return true; // unparseable Origin/Referer is itself suspicious
  }
}

export function proxy(request: NextRequest) {
  if (isCrossOriginMutation(request)) {
    logSecurityEvent("csrf_rejected", {
      path: request.nextUrl.pathname,
      method: request.method,
      origin: request.headers.get("origin") ?? request.headers.get("referer") ?? undefined,
    });
    return NextResponse.json({ error: "cross_origin_forbidden" }, { status: 403 });
  }

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  // Cheap cookie-presence redirect only — no DB round trip here. The
  // authoritative check lives in requireUser() (lib/auth/session.ts), called
  // by every protected page/route.
  //
  // Deliberately does NOT redirect authenticated-looking users away from
  // /login or /signup here: a stale/expired cookie (DB reset, natural
  // expiry) is still "present" from middleware's point of view, which would
  // bounce the user straight back to /dashboard — which itself redirects to
  // /login via requireUser() once it discovers the session doesn't validate,
  // producing an infinite redirect loop with no way to reach the login form.
  // That authenticated-redirect is instead handled by the (auth) route
  // group's layout using the authoritative getSession() check, which can
  // tell "present but invalid" apart from "actually logged in".
  if (isProtected && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // btoa, not Buffer — middleware can run on the Edge runtime, which doesn't
  // provide Node's Buffer. A UUID is plain ASCII, so btoa (a standard Web
  // API, available on both Edge and Node) encodes it safely.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  // Correlates a single request across logServerError/logSecurityEvent
  // calls made by whatever route ends up handling it, and is returned to
  // the client too — useful to ask a user reporting an issue for the id
  // straight off their network tab. Preserves an inbound id from a real
  // upstream load balancer/reverse proxy if one is already set, rather
  // than always minting a fresh one that would disagree with the proxy's.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
